import { memo, useState } from 'react';
import {
  Ban,
  Bot,
  Check,
  ChevronRight,
  CircleDashed,
  Cog,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  LoaderCircle,
  MessageSquare,
  Plug,
  Search,
  Square,
  Terminal,
  Wrench,
  AlertCircle,
} from 'lucide-react';
import { useNow } from '../hooks/useNow';
import { fmtTokens, formatElapsed } from '../lib/format';
import { canStopTask } from '../lib/activity';

const KIND_ICONS = {
  turn: MessageSquare,
  subagent: Bot,
  command: Terminal,
  background: Cog,
  monitor: Eye,
  tool: Wrench,
  mcp: Plug,
  file: FileText,
  search: Search,
  web: Globe,
};
const STATUS_TEXT = { running: 'Rodando', done: 'Concluído', error: 'Falhou', stopped: 'Parado' };
const DETAIL_LABEL = {
  file: 'ARQUIVO',
  subagent: 'TIPO',
  command: 'COMANDO',
  background: 'COMANDO',
  monitor: 'COMANDO',
};
const clock = (ms) =>
  ms ? new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

// Elapsed time. Only this tiny component re-renders every second, and only while the task runs.
export const Elapsed = memo(function Elapsed({ start, end, running }) {
  const now = useNow(running);
  return <time className="task-time">{formatElapsed((end || now) - (start || now))}</time>;
});

export function StatusIcon({ status, detached }) {
  if (status === 'running' && detached) return <CircleDashed size={13} className="task-state detached" />;
  if (status === 'running') return <LoaderCircle size={13} className="spin task-state running" />;
  if (status === 'error') return <AlertCircle size={13} className="task-state err" />;
  if (status === 'stopped') return <Ban size={13} className="task-state stopped" />;
  return <Check size={13} className="task-state ok" />;
}

function Detail({ t }) {
  const s = t.stats || {},
    x = t.extra || {};
  return (
    <div className="task-detail">
      <dl>
        <dt>Início</dt>
        <dd>{clock(t.startedAt)}</dd>
        <dt>Fim</dt>
        <dd>{t.endedAt ? clock(t.endedAt) : t.status === 'running' ? 'em andamento' : '—'}</dd>
        {s.toolUses > 0 && (
          <>
            <dt>Ferramentas</dt>
            <dd>{s.toolUses}</dd>
          </>
        )}
        {s.tokens > 0 && (
          <>
            <dt>Tokens</dt>
            <dd>{fmtTokens(s.tokens)}</dd>
          </>
        )}
        {s.lastTool && t.status === 'running' && (
          <>
            <dt>Agora</dt>
            <dd>{s.lastTool}</dd>
          </>
        )}
      </dl>
      {s.detached && (
        <p className="task-note">
          Este comando continua em segundo plano, mas o VeSTA não recebe mais o aviso de quando ele termina.
        </p>
      )}
      {t.detail && t.kind !== 'turn' && (
        <>
          <div className="task-detail-label">{DETAIL_LABEL[t.kind] || 'DETALHE'}</div>
          <pre>{t.detail}</pre>
        </>
      )}
      {x.prompt && (
        <>
          <div className="task-detail-label">PROMPT</div>
          <pre>{x.prompt}</pre>
        </>
      )}
      {x.result && (
        <>
          <div className="task-detail-label">RESULTADO</div>
          <pre>{x.result}</pre>
        </>
      )}
    </div>
  );
}

// One task and, recursively, what it launched. `node` keeps its identity while nothing under it changes.
export const TaskNode = memo(function TaskNode({ node, depth = 0, live, onStopTask, onOpen, defaultOpen = true }) {
  const t = node.task,
    Icon = KIND_ICONS[t.kind] || Wrench,
    detached = !!t.stats?.detached,
    [open, setOpen] = useState(defaultOpen),
    [info, setInfo] = useState(false),
    kids = node.children,
    omitted = t.stats?.omitted || 0;
  const stop = canStopTask(t, live);
  return (
    <div className={'task-node ' + t.kind + ' ' + t.status} data-kind={t.kind} data-status={t.status}>
      <div className="task-row" style={{ paddingLeft: depth * 16 }}>
        <button
          className={'task-chev' + (open ? ' open' : '')}
          onClick={() => setOpen(!open)}
          disabled={!kids.length}
          aria-label={open ? 'Recolher' : 'Expandir'}
        >
          {kids.length > 0 && <ChevronRight size={12} />}
        </button>
        <button className="task-main" onClick={() => setInfo(!info)} aria-expanded={info}>
          <span className="task-icon">
            <Icon size={12} />
          </span>
          <span className="task-text">
            <strong>{t.label}</strong>
            {t.detail && t.kind !== 'subagent' && <code>{t.detail}</code>}
          </span>
        </button>
        {t.kind === 'subagent' && t.stats?.background && <span className="task-tag">segundo plano</span>}
        {t.kind === 'subagent' && t.detail && <span className="task-tag muted">{t.detail}</span>}
        {detached && <span className="task-tag muted">sem acompanhamento</span>}
        <StatusIcon status={t.status} detached={detached} />
        <Elapsed start={t.startedAt} end={t.endedAt} running={t.status === 'running' && !detached} />
        {stop && (
          <button
            className="task-stop"
            title="Interromper esta tarefa"
            aria-label={'Interromper ' + t.label}
            onClick={() => onStopTask?.(t)}
          >
            <Square size={10} />
          </button>
        )}
        {t.kind === 'turn' && onOpen && (
          <button
            className="task-open"
            title="Ir à mensagem"
            aria-label="Ir à mensagem"
            onClick={() => onOpen(t.chatId, t.messageId)}
          >
            <ExternalLink size={12} />
          </button>
        )}
      </div>
      {info && <Detail t={t} />}
      {open && (
        <>
          {omitted > 0 && (
            <div className="task-omitted" style={{ paddingLeft: depth * 16 + 34 }}>
              +{omitted} anteriores
            </div>
          )}
          {kids.map((k) => (
            <TaskNode
              key={k.task.id}
              node={k}
              depth={depth + 1}
              live={live}
              onStopTask={onStopTask}
              onOpen={onOpen}
              defaultOpen={k.task.status === 'running'}
            />
          ))}
        </>
      )}
      <span className="sr-only">{STATUS_TEXT[t.status]}</span>
    </div>
  );
});
