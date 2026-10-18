import { Brain, ChevronRight, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { IconButton } from './IconButton';
export function MainHeader({ page, chat, data, memoryStatus, inspector, setInspector }) {
  return (
    <header className="main-header">
      <div className="breadcrumb">
        <span>Seu espaço</span>
        <ChevronRight size={13} />
        <strong>
          {page === 'chat'
            ? chat?.title || 'Visão geral'
            : page === 'memory'
              ? 'Memória compartilhada'
              : page === 'usage'
                ? 'Uso'
                : page === 'connections'
                  ? 'Conexões'
                  : 'Preferências'}
        </strong>
      </div>
      <div className="header-actions">
        {data.settings.memoryEnabled && (
          <span className="memory-badge">
            <span className={'status-dot ' + (memoryStatus?.connected ? '' : 'offline')} />
            <Brain size={13} />
            Memória {memoryStatus?.connected ? 'conectada' : 'local'}
          </span>
        )}
        {page === 'chat' && (
          <IconButton
            icon={inspector ? PanelRightClose : PanelRightOpen}
            label="Alternar painel de contexto"
            onClick={() => setInspector(!inspector)}
          />
        )}
      </div>
    </header>
  );
}
