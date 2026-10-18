import { useState } from 'react';
export function useToast() {
  const [toast, setToast] = useState('');
  const notify = (message) => {
    setToast(message);
    setTimeout(() => setToast(''), 4500);
  };
  return { toast, notify };
}
