import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { ActivityRow } from './ActivityRow';
export function Activities({ activities }) {
  if (!activities?.length) return null;
  const last = activities.at(-1);
  return (
    <details className="activities">
      <summary>
        <SlidersHorizontal size={12} />
        {last.label}
        <span className="activity-count">{activities.length}</span>
        <ChevronDown size={12} />
      </summary>
      <div className="activity-list">
        {activities.map((a, i) => (
          <ActivityRow a={a} key={a.id || i} />
        ))}
      </div>
    </details>
  );
}
