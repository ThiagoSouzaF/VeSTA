import { LoaderCircle } from 'lucide-react';
import { ChatPage } from './ChatPage';
import { ActivityPage } from './ActivityPage';
import { QuestsPage } from './QuestsPage';
import { MemoryPage } from './MemoryPage';
import { UsagePage } from './UsagePage';
import { ConnectionsPage } from './ConnectionsPage';
import { AboutPage } from './AboutPage';
import { SettingsPage } from './SettingsPage';

// Picks the screen for `page`; `props` holds the props of each one, keyed by page. Preferências is the fallback.
export function PageRouter({ page, loading, props }) {
  if (loading)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        <p>Acendendo a chama…</p>
      </div>
    );
  switch (page) {
    case 'chat':
      return <ChatPage {...props.chat} />;
    case 'activity':
      return <ActivityPage {...props.activity} />;
    case 'quests':
      return <QuestsPage {...props.quests} />;
    case 'memory':
      return <MemoryPage {...props.memory} />;
    case 'usage':
      return <UsagePage {...props.usage} />;
    case 'connections':
      return <ConnectionsPage {...props.connections} />;
    case 'about':
      return <AboutPage {...props.about} />;
    default:
      return <SettingsPage {...props.settings} />;
  }
}
