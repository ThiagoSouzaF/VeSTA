import { memo, useState } from 'react';
import { ChevronDown, ListTree, LoaderCircle } from 'lucide-react';
import tasks from '../../electron/tasks.cjs';
import { messageActivity } from '../lib/activity';
import { TaskNode } from './TaskTree';

// "3 subagentes · 5 comandos · 1 em segundo plano": one line per assistant message that expands the task tree.
export const TaskSummary = memo(function TaskSummary({ chat, m, live, onStopTask }) {
  const [open, setOpen] = useState(false);
  const act = messageActivity(chat, m, live),
    { counts } = act;
  if (!counts.total) return null;
  const line = tasks.summaryLine(counts);
  return (
    <div className={'task-summary' + (open ? ' open' : '')}>
      <button className="task-summary-line" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ListTree size={12} />
        <span>{line}</span>
        {counts.running > 0 && (
          <span className="task-summary-running">
            <LoaderCircle size={11} className="spin" />
            {counts.running} rodando
          </span>
        )}
        <ChevronDown size={12} className="task-summary-chev" />
      </button>
      {open && (
        <div className="task-tree">
          {act.root.children.map((k) => (
            <TaskNode key={k.task.id} node={k} depth={0} live={live} onStopTask={onStopTask} defaultOpen={false} />
          ))}
          {act.root.task.stats?.omitted > 0 && (
            <div className="task-omitted">+{act.root.task.stats.omitted} anteriores</div>
          )}
        </div>
      )}
    </div>
  );
});
