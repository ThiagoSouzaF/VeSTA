import { useEffect } from 'react';

// The CSS themes and accents hang off data attributes of <html>.
export function useDocumentTheme(theme, accent) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = accent;
  }, [theme, accent]);
}
