import { memo, useMemo, useState } from 'react';
import { ChevronUp, CornerDownRight, LoaderCircle, Square } from 'lucide-react';
import { chatGroup, dockTasks, canStopTask } from '../lib/activity';
import { Elapsed, StatusIcon } from './TaskTree';
import { TabInk } from './TabInk';

const TABS = [
  { id: 'running', label: 'Rodando' },
  { id: 'done', label: 'Concluídos' },
  { id: 'failed', label: 'Falharam' },
];
const KIND_TAG = { background: 'segundo plano', monitor: 'monitor', command: 'comando' };

// Bring the message that launched a task into view and mark it for a moment.
function showMessage(messageId) {
  const el = document.getElementById('msg-' + messageId);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('dock-flash');
  void el.offsetWidth;
  el.classList.add('dock-flash');
}

function DockRow({ item, onStopTask }) {
  const t = item.task,
    detached = !!t.stats?.detached,
    running = t.status === 'running' && !detached;
  const now = item.step
    ? item.step.label + (item.step.detail ? ' · ' + item.step.detail : '')
    : t.kind !== 'subagent'
      ? t.detail
      : '';
  return (
    <div className={'dock-row ' + t.status} data-kind={t.kind} data-status={t.status}>
      <StatusIcon status={t.status} detached={detached} />
      <div className="dock-row-main">
        <div className="dock-row-title">
          <strong>{t.label}</strong>
          <small>
            {t.kind === 'subagent' ? t.detail || 'subagente' : KIND_TAG[t.kind]}
            {t.kind === 'subagent' && t.stats?.background ? ' · segundo plano' : ''}
            {detached ? ' · sem acompanhamento' : ''}
          </small>
        </div>
        {now && <code className="dock-row-now">{now}</code>}
      </div>
      <Elapsed start={t.startedAt} end={t.endedAt} running={running} />
      <button className="dock-action" title="Ir à mensagem que disparou" onClick={() => showMessage(t.messageId)}>
        <CornerDownRight size={12} />
        <span>ver no chat</span>
      </button>
      {canStopTask(t, item.live) && (
        <button
          className="dock-action stop"
          title="Interromper esta tarefa"
          aria-label={'Interromper ' + t.label}
          onClick={() => onStopTask(t)}
        >
          <Square size={10} />
        </button>
      )}
    </div>
  );
}

// Fixed under the conversation, above the composer: what the chat runs in parallel, so nobody has to scroll up to
// find out. Collapsed it is one line (running chips + totals); open it lists running, finished and failed work.
export const TaskDock = memo(function TaskDock({ chat, running, following, call }) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState('running');
  const lists = useMemo(() => dockTasks(chatGroup(chat, running, following)), [chat, running, following]);
  const total = lists.running.length + lists.done.length + lists.failed.length;
  if (!total) return null;
  const onStopTask = (t) => call('stopTask', { chatId: t.chatId, taskId: t.taskId }).catch(() => {});
  // The tab follows what exists: an empty "Rodando" opens on what finished.
  const shown = lists[tab].length ? tab : TABS.find((x) => lists[x.id].length).id;
  return (
    <div className={'task-dock' + (open ? ' open' : '')} data-testid="task-dock">
      {open && (
        <div className="task-dock-panel">
          <div className="task-dock-tabs tab-ink-host" role="tablist">
            {TABS.map((x) => (
              <button
                key={x.id}
                role="tab"
                aria-selected={shown === x.id}
                disabled={!lists[x.id].length}
                onClick={() => setTab(x.id)}
              >
                {x.label} · {lists[x.id].length}
              </button>
            ))}
            <TabInk active="[aria-selected='true']" value={shown} />
          </div>
          <div className="task-dock-list">
            {lists[shown].map((item) => (
              <DockRow key={item.task.id} item={item} onStopTask={onStopTask} />
            ))}
          </div>
        </div>
      )}
      <button className="task-dock-bar" aria-expanded={open} onClick={() => setOpen(!open)}>
        {lists.running.length > 0 ? (
          <span className="task-dock-badge">
            <LoaderCircle size={11} className="spin" />
            {lists.running.length} em paralelo
          </span>
        ) : (
          <span className="task-dock-badge idle">Nada rodando</span>
        )}
        <span className="task-dock-chips">
          {lists.running.map(({ task: t }) => (
            <span className="task-dock-chip" key={t.id}>
              <strong>{t.label}</strong>
              <Elapsed start={t.startedAt} end={t.endedAt} running />
            </span>
          ))}
        </span>
        <span className="task-dock-totals">
          {lists.done.length} {lists.done.length === 1 ? 'concluído' : 'concluídos'}
          {lists.failed.length > 0 &&
            ' · ' + lists.failed.length + (lists.failed.length === 1 ? ' falhou' : ' falharam')}
        </span>
        <ChevronUp size={14} className="task-dock-chev" />
      </button>
    </div>
  );
});
