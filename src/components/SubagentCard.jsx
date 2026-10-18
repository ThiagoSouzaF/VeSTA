import { useNow } from '../hooks/useNow';
import { ChevronDown, Check, LoaderCircle, AlertCircle, Bot } from 'lucide-react';
import { fmtTokens, formatElapsed } from '../lib/format';
import { ActivityRow } from './ActivityRow';
const SUBAGENT_STATUS = { running: 'Rodando', done: 'Concluído', error: 'Falhou' };
export function SubagentCard({ s }) {
  const running = s.status === 'running',
    now = useNow(running),
    elapsed = (s.endedAt || now) - (s.startedAt || now);
  return (
    <details className={'subagent-card ' + s.status}>
      <summary>
        <span className="subagent-icon">
          <Bot size={15} />
        </span>
        <div className="subagent-title">
          <span className="subagent-type">
            {s.subagentType || 'agent'}
            {s.background ? ' · segundo plano' : ''}
            {s.stats?.toolUses
              ? ' · ' + s.stats.toolUses + (s.stats.toolUses === 1 ? ' ferramenta' : ' ferramentas')
              : ''}
            {s.stats?.tokens ? ' · ' + fmtTokens(s.stats.tokens) + ' tokens' : ''}
          </span>
          <strong>{s.label || 'Subagente'}</strong>
          {running && s.steps?.length > 0 && (
            <span className="subagent-now">
              {s.steps.at(-1).label}
              {s.steps.at(-1).detail ? ' · ' + s.steps.at(-1).detail : ''}
            </span>
          )}
        </div>
        <span className="subagent-status">
          {running ? (
            <LoaderCircle size={12} className="spin" />
          ) : s.status === 'error' ? (
            <AlertCircle size={12} />
          ) : (
            <Check size={12} />
          )}
          {SUBAGENT_STATUS[s.status] || s.status}
          <time>{formatElapsed(elapsed)}</time>
        </span>
        <ChevronDown size={13} className="subagent-chevron" />
      </summary>
      <div className="subagent-body">
        {s.steps?.length > 0 && (
          <>
            <div className="subagent-label">O QUE ESTÁ FAZENDO</div>
            <div className="activity-list subagent-steps">
              {s.steps.map((a) => (
                <ActivityRow a={a} key={a.id} />
              ))}
            </div>
          </>
        )}
        {s.prompt && (
          <>
            <div className="subagent-label">PROMPT</div>
            <pre>{s.prompt}</pre>
          </>
        )}
        {s.result ? (
          <>
            <div className="subagent-label">RESULTADO</div>
            <pre>{s.result}</pre>
          </>
        ) : (
          running && <p className="subagent-wait">Aguardando o retorno do subagente…</p>
        )}
      </div>
    </details>
  );
}
