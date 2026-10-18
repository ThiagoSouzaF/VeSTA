import { AlertCircle } from 'lucide-react';
export function Toast({ toast }) {
  return (
    <div className="toast">
      <AlertCircle size={16} />
      {toast}
    </div>
  );
}
