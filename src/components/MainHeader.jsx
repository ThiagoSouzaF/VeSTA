import { ArrowLeft, ArrowRight, Brain, ChevronRight, Orbit } from 'lucide-react';
import { IconButton } from './IconButton';
export function MainHeader({
  page,
  chat,
  data,
  memoryStatus,
  inspector,
  setInspector,
  canBack = false,
  canForward = false,
  onBack,
  onForward,
}) {
  return (
    <header className="main-header">
      <div className="nav-buttons" role="group" aria-label="Navegação">
        <IconButton
          icon={ArrowLeft}
          label="Voltar (Alt+←)"
          onClick={onBack}
          disabled={!canBack}
          data-action="nav-back"
        />
        <IconButton
          icon={ArrowRight}
          label="Avançar (Alt+→)"
          onClick={onForward}
          disabled={!canForward}
          data-action="nav-forward"
        />
      </div>
      <div className="breadcrumb">
        <span>Seu espaço</span>
        <ChevronRight size={13} />
        <strong>
          {page === 'home'
            ? 'Início'
            : page === 'chat'
              ? chat?.title || 'Nova conversa'
              : page === 'activity'
                ? 'Atividade'
                : page === 'quests'
                  ? 'Quests'
                  : page === 'memory'
                    ? 'Memória compartilhada'
                    : page === 'skills'
                      ? 'Skills'
                      : page === 'agents'
                        ? 'Agent Mode'
                        : page === 'teams'
                          ? 'Equipes'
                          : page === 'usage'
                            ? 'Uso'
                            : page === 'connections'
                              ? 'Conexões'
                              : page === 'about'
                                ? 'Sobre a VeSTA'
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
          <button
            className={'context-toggle' + (inspector ? ' active' : '')}
            aria-expanded={inspector}
            aria-label="Alternar painel de contexto"
            onClick={() => setInspector(!inspector)}
          >
            <Orbit size={13} />
            Contexto
          </button>
        )}
      </div>
    </header>
  );
}
