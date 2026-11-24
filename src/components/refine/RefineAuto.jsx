// Refino automático (Skills and Agents screens, the same settings): what has signals of trouble now, the last review,
// "Revisar agora", and, opened, the AI that reviews, when and how many per pass. Every change is saved at once
// (refine/auto.cjs).
import { useMemo, useState } from 'react';
import { Wand2, Settings2 } from 'lucide-react';
import { PROVIDERS } from '../../lib/constants';
import { agoLabel, whenLabel } from '../../lib/agents';
import { action } from '../../lib/api';
import { candidates } from '../../lib/refine';
import { AiPicker, ScheduleFields } from '../ScheduleFields';
import { Switch } from '../skills/SkillBits';

const PER_RUN = [1, 2, 3, 5];
const DEFAULT = {
  enabled: false,
  provider: 'claude',
  model: '',
  schedule: { kind: 'daily', time: '04:00' },
  perRun: 3,
};
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export function RefineAuto({ data, integrations = {}, call, setData }) {
  const c = { ...DEFAULT, runs: [], ...(data.refineAuto || {}) };
  const [open, setOpen] = useState(false);
  const now = useMemo(
    () => candidates({ skills: data.skills?.list || [], agents: data.agents || [], chats: data.chats }),
    [data.skills?.list, data.agents, data.chats]
  );
  const waiting =
    (data.skills?.list || []).filter((s) => s.proposal).length + (data.agents || []).filter((a) => a.proposal).length;
  const last = c.runs[0];
  const running = last?.status === 'running';
  const save = (patch) => action(async () => setData((await call('refineAutoConfigure', patch)).state))();
  const lastText = !last
    ? 'Ainda não revisou.'
    : running
      ? 'Revisando com ' + PROVIDERS[last.provider]?.name + '…'
      : last.status === 'error'
        ? 'Falhou ' + agoLabel(last.endedAt || last.at) + ': ' + last.error
        : 'Última: ' +
          agoLabel(last.endedAt || last.at) +
          ' · ' +
          plural(last.reviewed, 'revisada', 'revisadas') +
          ', ' +
          plural(last.proposed, 'proposta', 'propostas') +
          '.';
  return (
    <section className="memory-consolidation refine-auto" aria-label="Refino automático">
      <div className="consolidation-head">
        <span className="summary-icon">
          <Wand2 size={20} />
        </span>
        <div className="consolidation-text">
          <span className="consolidation-kicker">REFINO AUTOMÁTICO</span>
          <strong data-candidates={now.length}>
            {now.length
              ? plural(now.length, 'com sinal de problema', 'com sinais de problema')
              : 'Nada com sinal de problema'}
            {now.length > 0 && (
              <small>
                {' '}
                ·{' '}
                {now
                  .slice(0, 4)
                  .map((x) => x.label)
                  .join(', ')}
              </small>
            )}
            {waiting > 0 && <small> · {plural(waiting, 'proposta esperando você', 'propostas esperando você')}</small>}
          </strong>
          <span className={'consolidation-last' + (last?.status === 'error' ? ' error' : '')} aria-live="polite">
            {lastText}
            {c.enabled && c.nextRunAt && !running ? ' Próxima: ' + whenLabel(c.nextRunAt) + '.' : ''}
          </span>
        </div>
        <Switch
          on={c.enabled}
          label={c.enabled ? 'Desligar o refino automático' : 'Ligar o refino automático'}
          onChange={(on) => save({ enabled: on })}
        />
        <button
          className="secondary-button"
          aria-pressed={open}
          aria-label="Configurar o refino automático"
          onClick={() => setOpen(!open)}
        >
          <Settings2 size={15} />
        </button>
        <button
          className="primary-button"
          disabled={running || !now.length}
          title={
            now.length
              ? 'Revisa agora o que tem sinal de problema e deixa propostas esperando o seu sim'
              : 'Entra aqui o que foi corrigido, falhou ou tem lições esperando desde a última revisão'
          }
          onClick={action(async () => setData((await call('refineAutoRun')).state))}
        >
          <Wand2 size={15} />
          {running ? 'Revisando…' : 'Revisar agora'}
        </button>
      </div>
      {open && (
        <>
          <div className="consolidation-controls">
            <div className="consolidation-field">
              <span className="agent-label">QUEM REVISA</span>
              <AiPicker
                label="IA que revisa"
                provider={c.provider}
                model={c.model}
                integrations={integrations}
                onChange={save}
              />
            </div>
            <div className="consolidation-field">
              <span className="agent-label">QUANDO</span>
              <ScheduleFields
                label="Quando revisar"
                schedule={c.schedule}
                defaultTime="04:00"
                onChange={(p) => save({ schedule: { ...c.schedule, ...p } })}
              />
              <label className="agent-inline">
                Até
                <select
                  aria-label="Quantas por vez"
                  value={c.perRun}
                  onChange={(e) => save({ perRun: Number(e.target.value) })}
                >
                  {PER_RUN.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                por vez, as mais urgentes primeiro
              </label>
            </div>
          </div>
          <p className="consolidation-privacy">
            Sem IA, o VeSTA conta o que aconteceu com cada skill e agent desde a última revisão: usos, correções suas,
            erros, execuções que falharam e lições esperando. Os que têm sinal de problema vão para a IA escolhida, que
            lê a evidência (com a sua assinatura dela) e, se houver motivo claro, deixa uma proposta na gaveta, com as
            diferenças. Nada muda sem o seu sim.
          </p>
        </>
      )}
    </section>
  );
}
