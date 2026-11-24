// Consolidar (tela Memória): the conversations waiting, the last run, a button to run it now, the AI that does it and
// when it runs on its own. Every change is saved at once (memory/consolidator.cjs).
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { PROVIDERS } from '../lib/constants';
import { modelLabel } from '../lib/format';
import { DAY, INTERVALS, agoLabel, describeSchedule, whenLabel } from '../lib/agents';
import { action } from '../lib/api';
import { ProviderIcon } from './ProviderIcon';

const ORDER = ['claude', 'codex', 'opencode', 'drael'];
const KINDS = [
  ['manual', 'Só quando eu mandar'],
  ['interval', 'A cada X horas'],
  ['daily', 'Todo dia'],
  ['weekdays', 'Dias úteis'],
  ['weekly', 'Dias da semana'],
];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export function MemoryConsolidation({ data, integrations = {}, openSessions = 0, call, setData }) {
  const c = data.consolidation || { provider: 'claude', model: '', schedule: { kind: 'manual' }, runs: [] };
  const waiting = (data.memoryToConsolidate || []).length;
  // Memories that came from conversations: what a run may merge (notes and preferences you wrote are never touched).
  const fromTalks = (data.memories || []).filter((m) => m.kind === 'insight' || m.kind === 'session').length;
  const canRun = waiting > 0 || fromTalks >= 2;
  const last = c.runs?.[0];
  const running = last?.status === 'running';
  const [time, setTime] = useState(c.schedule.time || '03:00');
  useEffect(() => setTime(c.schedule.time || '03:00'), [c.schedule.time]);
  const save = (patch) => action(async () => setData(await call('consolidationSet', patch)))();
  const sch = (patch) => save({ schedule: { ...c.schedule, ...patch } });
  const models = integrations[c.provider]?.models || [];

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
          <div className="consolidation-ais" role="radiogroup" aria-label="IA que consolida">
            {ORDER.map((id) => {
              const installed = !!integrations[id]?.installed;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={c.provider === id}
                  data-ai={id}
                  disabled={!installed && c.provider !== id}
                  title={installed ? undefined : 'Não instalada (tela Conexões)'}
                  onClick={() => c.provider !== id && save({ provider: id })}
                >
                  <ProviderIcon id={id} small />
                  <span>{PROVIDERS[id].name}</span>
                </button>
              );
            })}
          </div>
          {models.length > 0 && (
            <select aria-label="Modelo" value={c.model} onChange={(e) => save({ model: e.target.value })}>
              <option value="">Modelo padrão da IA</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {modelLabel(m)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="consolidation-field">
          <span className="agent-label">QUANDO</span>
          <div className="consolidation-when">
            <select
              aria-label="Quando consolidar"
              value={c.schedule.kind}
              onChange={(e) => sch({ kind: e.target.value, days: c.schedule.days?.length ? c.schedule.days : [1] })}
            >
              {KINDS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {c.schedule.kind === 'interval' && (
              <select
                aria-label="Intervalo"
                value={c.schedule.hours}
                onChange={(e) => sch({ hours: Number(e.target.value) })}
              >
                {INTERVALS.map((h) => (
                  <option key={h} value={h}>
                    {h === 1 ? '1 hora' : h + ' horas'}
                  </option>
                ))}
              </select>
            )}
            {['daily', 'weekdays', 'weekly'].includes(c.schedule.kind) && (
              <label className="agent-inline">
                às
                <input
                  type="time"
                  aria-label="Hora"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  onBlur={() => time && time !== c.schedule.time && sch({ time })}
                />
              </label>
            )}
          </div>
          {c.schedule.kind === 'weekly' && (
            <div className="agent-days" role="group" aria-label="Dias da semana">
              {WEEK.map((d) => {
                const on = c.schedule.days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    disabled={on && c.schedule.days.length === 1}
                    onClick={() =>
                      sch({ days: on ? c.schedule.days.filter((x) => x !== d) : [...c.schedule.days, d].sort() })
                    }
                  >
                    {DAY[d]}
                  </button>
                );
              })}
            </div>
          )}
          <span className="consolidation-note">
            {describeSchedule(c.schedule)}. Só roda com o VeSTA aberto; uma hora perdida roda ao abrir.
          </span>
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
