import { AlertCircle } from 'lucide-react';
// `state` is "closing" while it leaves (usePresence), so motion.css can play the exit.
export function Toast({ toast, state }) {
  return (
    <div className="toast" data-state={state} role="status">
      <AlertCircle size={16} />
      <span key={toast} className="t-swap">
        {toast}
      </span>
    </div>
  );
}
