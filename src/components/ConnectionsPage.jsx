import { action } from '../lib/api';
import { ArrowUpRight, Brain, Check, Terminal, RefreshCw, ShieldCheck, AlertCircle } from 'lucide-react';
import { PROVIDERS } from '../lib/constants';
import { ProviderIcon } from './ProviderIcon';
import { Chapter } from './Chapter';
export function ConnectionsPage({
  setBusy,
  setIntegrations,
  call,
  notify,
  busy,
  integrations,
  memoryStatus,
  setMemoryStatus,
}) {
  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <Chapter n={6} title="CONEXÕES" />
          <div className="eyebrow">INTELIGÊNCIAS, REUNIDAS</div>
          <h1>Cada IA, do seu jeito.</h1>
          <p>Os logins e as configurações que você já usa, em um só lugar.</p>
        </div>
        <button
          className="secondary-button"
          onClick={action(async () => {
            setBusy(true);
            try {
              setIntegrations(await call('refreshConnections'));
              notify('Conexões verificadas');
            } finally {
              setBusy(false);
            }
          })}
        >
          <RefreshCw size={15} className={busy ? 'spin' : ''} />
          Verificar
        </button>
      </div>
      <div className="connection-list">
        {Object.entries(PROVIDERS).map(([id, p]) => (
          <div className="connection-card" key={id}>
            <div className="connection-main">
              <ProviderIcon id={id} />
              <div>
                <h2>
                  {p.name}
                  <span>{p.engine}</span>
                </h2>
                <p>{p.description}</p>
              </div>
              <span className={'connection-status ' + (integrations[id]?.installed ? 'connected' : '')}>
                {integrations[id]?.installed ? <Check size={13} /> : <AlertCircle size={13} />}{' '}
                {integrations[id]?.installed
                  ? integrations[id]?.authenticated === false
                    ? 'Login necessário'
                    : 'Detectado'
                  : 'Não encontrado'}
              </span>
            </div>
            <div className="connection-details">
              <span>
                <Terminal size={13} />
                {integrations[id]?.version || 'Instale o programa para conectar'}
              </span>
              <button
                className="text-button"
                disabled={!integrations[id]?.installed}
                onClick={action(() => call('openTerminal', { provider: id }))}
              >
                Abrir terminal
                <ArrowUpRight size={13} />
              </button>
            </div>
            {id === 'opencode' && integrations[id]?.models?.length > 0 && (
              <div className="detected-models">
                <span>MODELOS CONFIGURADOS</span>
                <div>
                  {integrations[id].models.map((m) => (
                    <code key={m}>{m}</code>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="info-card">
        <ShieldCheck size={22} />
        <div>
          <h3>Seu chat continua sendo seu.</h3>
          <p>
            O VeSTA executa Codex, Claude Code, Drael e OpenCode na pasta do projeto. Cada programa usa suas
            configurações e instruções nativas. ChatGPT usa o login do Codex; seus chats anteriores do site não são
            importados. Drael reutiliza o login nativo ou a chave já configurada no OpenCode.
          </p>
        </div>
      </div>
      <div className="connection-card memory-connection">
        <div className="connection-main">
          <span className="provider-icon violet">
            <Brain size={24} />
          </span>
          <div>
            <h2>
              AI Memory<span>3.0.0 · MCP</span>
            </h2>
            <p>Memória local compartilhada, com busca textual e arquivos Markdown.</p>
          </div>
          <span className={'connection-status ' + (memoryStatus?.connected ? 'connected' : '')}>
            {memoryStatus?.connected ? <Check size={13} /> : <AlertCircle size={13} />}{' '}
            {memoryStatus?.connected ? 'Conectado' : 'Indisponível'}
          </span>
        </div>
        <div className="connection-details">
          <span>Motor nativo para Windows · experimental</span>
          <button className="text-button" onClick={action(async () => setMemoryStatus(await call('memoryStatus')))}>
            Reconectar
            <RefreshCw size={13} />
          </button>
        </div>
        {memoryStatus?.error && <p className="inline-error">{memoryStatus.error}</p>}
      </div>
    </div>
  );
}
