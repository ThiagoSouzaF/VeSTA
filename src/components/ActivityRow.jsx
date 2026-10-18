import {
  Search,
  MessageSquare,
  Brain,
  Check,
  Terminal,
  FileText,
  LoaderCircle,
  AlertCircle,
  Globe,
  Plug,
  ListChecks,
  Wrench,
} from 'lucide-react';
const ACTIVITY_ICONS = {
  command: Terminal,
  file: FileText,
  mcp: Plug,
  search: Search,
  web: Globe,
  todo: ListChecks,
  memory: Brain,
  text: MessageSquare,
  tool: Wrench,
};
export function ActivityRow({ a }) {
  const Icon = ACTIVITY_ICONS[a.kind] || Wrench;
  return (
    <div className={'activity-row ' + (a.kind || 'tool') + ' ' + (a.status || 'done')}>
      <span className="activity-icon">
        <Icon size={12} />
      </span>
      <div>
        <strong>{a.label}</strong>
        {a.detail && <code>{a.detail}</code>}
      </div>
      {a.status === 'running' ? (
        <LoaderCircle size={12} className="spin activity-state" />
      ) : a.status === 'error' ? (
        <AlertCircle size={12} className="activity-state err" />
      ) : (
        <Check size={12} className="activity-state ok" />
      )}
    </div>
  );
}
