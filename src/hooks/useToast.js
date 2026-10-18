import { useState, useCallback } from 'react';
export function useToast() {
  const [toast, setToast] = useState('');
  const notify = useCallback((message) => {
    setToast(message);
    setTimeout(() => setToast(''), 4500);
  }, []);
  return { toast, notify };
}
