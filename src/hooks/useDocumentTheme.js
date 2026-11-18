import { useEffect } from 'react';
import { LOOKS } from '../lib/constants';

// The CSS themes, their look (ink or soft) and accents hang off data attributes of <html>.
export function useDocumentTheme(theme, accent) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.look = LOOKS[theme] || 'soft';
    document.documentElement.dataset.accent = accent;
  }, [theme, accent]);
}
