import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../../src/styles/tokens.css';
import '../../src/styles/markdown.css';
import '../../src/styles/utilities.css';
import '../../src/styles/tasks.css';
import '../../src/styles/usage.css';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
// Installable and fast to reopen; the service worker only exists in secure contexts (HTTPS or localhost).
if ('serviceWorker' in navigator && window.isSecureContext && import.meta.env.PROD)
  navigator.serviceWorker.register('./sw.js').catch(() => {});
