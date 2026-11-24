// Consolidar (tela Memória): the conversations waiting, the last run, a button to run it now, the AI that does it and
// when it runs on its own. Every change is saved at once (memory/consolidator.cjs).
import { Sparkles } from 'lucide-react';
import { PROVIDERS } from '../lib/constants';
import { agoLabel, whenLabel } from '../lib/agents';
import { action } from '../lib/api';
import { AiPicker, ScheduleFields } from './ScheduleFields';

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export function MemoryConsolidation({ data, integrations = {}, openSessions = 0, call, setData }) {
  const c = data.consolidation || { provider: 'claude', model: '', schedule: { kind: 'manual' }, runs: [] };
  const waiting = (data.memoryToConsolidate || []).length;
  // Memories that came from conversations: what a run may merge (notes and preferences you wrote are never touched).
  const fromTalks = (data.memories || []).filter((m) => m.kind === 'insight' || m.kind === 'session').length;
  const canRun = waiting > 0 || fromTalks >= 2;
  const last = c.runs?.[0];
  const running = last?.status === 'running';
  const save = (patch) => action(async () => setData(await call('consolidationSet', patch)))();
  const sch = (patch) => save({ schedule: { ...c.schedule, ...patch } });

  const lastText = !last
    ? 'Ainda não rodou.'
    : running
      ? 'Consolidando com ' +
        PROVIDERS[last.provider]?.name +
        ': ' +
        plural(last.stretches || 0, 'conversa nova', 'conversas novas') +
        ' e ' +
        plural(last.reviewed || 0, 'memória para revisar', 'memórias para revisar') +
        '…'
      : last.status === 'error'
        ? 'Falhou ' + agoLabel(last.endedAt || last.at) + ': ' + last.error
        : 'Última: ' +
          agoLabel(last.endedAt || last.at) +
          ' · ' +
          plural(last.stretches || 0, 'conversa nova', 'conversas novas') +
          ', ' +
          plural(last.reviewed || 0, 'memória revisada', 'memórias revisadas') +
          ', ' +
          plural(last.pages || 0, 'página escrita', 'páginas escritas') +
          ', ' +
          plural(last.removed || 0, 'juntada ou removida', 'juntadas ou removidas') +
          '.';

  return (
    <section className="memory-consolidation" aria-label="Consolidar a memória">
      <div className="consolidation-head">
        <span className="summary-icon">
          <Sparkles size={20} />
        </span>
        <div className="consolidation-text">
          <span className="consolidation-kicker">CONSOLIDAR</span>
          <strong data-waiting={waiting}>
            {waiting ? plural(waiting, 'conversa esperando', 'conversas esperando') : 'Nada esperando'}
            {openSessions > 0 && <small> · {plural(openSessions, 'em andamento', 'em andamento')}</small>}
            <small> · {plural(fromTalks, 'memória das conversas', 'memórias das conversas')}</small>
          </strong>
          <span className={'consolidation-last' + (last?.status === 'error' ? ' error' : '')} aria-live="polite">
            {lastText}
            {c.nextRunAt && !running ? ' Próxima: ' + whenLabel(c.nextRunAt) + '.' : ''}
          </span>
        </div>
        <button
          className="primary-button"
          disabled={running || !canRun}
          title={
            canRun
              ? 'Consolida as conversas novas e junta as memórias repetidas de todos os projetos'
              : 'As conversas entram aqui quando a sessão fecha (30 min sem mensagens)'
          }
          onClick={action(async () => setData(await call('consolidationRun')))}
        >
          <Sparkles size={15} />
          {running ? 'Consolidando…' : 'Consolidar agora'}
        </button>
      </div>
      <div className="consolidation-controls">
        <div className="consolidation-field">
          <span className="agent-label">QUEM CONSOLIDA</span>
          <AiPicker
            label="IA que consolida"
            provider={c.provider}
            model={c.model}
            integrations={integrations}
            onChange={save}
          />
        </div>
        <div className="consolidation-field">
          <span className="agent-label">QUANDO</span>
          <ScheduleFields label="Quando consolidar" schedule={c.schedule} onChange={sch} />
        </div>
      </div>
      <p className="consolidation-privacy">
        A IA escolhida lê os trechos das conversas novas e as memórias que vieram de conversas (sem senhas e chaves),
        junta o que se repete em páginas curtas e grava regras, armadilhas e decisões, usando a sua assinatura dela. O
        que você escreveu (notas e preferências) nunca é mexido. O botão revisa todos os projetos; a agenda, só os que
        mudaram.
      </p>
    </section>
  );
}
