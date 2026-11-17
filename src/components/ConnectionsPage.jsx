import { action } from '../lib/api';
import { ArrowUpRight, Brain, Check, Terminal, RefreshCw, ShieldCheck, AlertCircle } from 'lucide-react';
import { PROVIDERS } from '../lib/constants';
import { ProviderIcon } from './ProviderIcon';
import { Chapter } from './Chapter';
// What the card says about each AI: whether the program is here and whether its login works (null = not checked).
function statusOf(i) {
  if (!i?.installed) return { ok: false, label: 'Não encontrado', hint: 'Instale o programa para conectar' };
  if (i.authenticated === false)
    return { ok: false, label: 'Login necessário', hint: 'Clique em Abrir terminal e entre com sua conta' };
  return { ok: true, label: i.authenticated ? 'Conectado' : 'Instalado', hint: i.version || '' };
}
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
        {Object.entries(PROVIDERS).map(([id, p]) => {
          const status = statusOf(integrations[id]);
          return (
            <div className="connection-card" key={id} data-connection={id}>
              <div className="connection-main">
                <ProviderIcon id={id} />
                <div>
                  <h2>
                    {p.name}
                    <span>{p.engine}</span>
                  </h2>
                  <p>{p.description}</p>
                </div>
                <span className={'connection-status ' + (status.ok ? 'connected' : '')}>
                  {status.ok ? <Check size={13} /> : <AlertCircle size={13} />} {status.label}
                </span>
              </div>
              <div className="connection-details">
                <span>
                  <Terminal size={13} />
                  {status.hint}
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
          );
        })}
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
