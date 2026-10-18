import { useCallback, useEffect, useState } from 'react';
import { Smartphone, QrCode, Trash2, Pencil, Check, X, ShieldAlert, Globe, Copy, Wifi } from 'lucide-react';
import { SettingToggle } from './SettingToggle';
import { action } from '../lib/api';
import { useNow } from '../hooks/useNow';

const BINDS = [
  ['tailscale', 'Somente Tailscale', 'Só aparelhos da sua conta Tailscale chegam ao VeSTA. Recomendado.'],
  ['localhost', 'Somente este computador', 'Ninguém de fora chega ao VeSTA. Serve para testes.'],
];
const when = (t) => (t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function Device({ device, call, refresh }) {
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(device.name),
    [confirm, setConfirm] = useState(false);
  return (
    <li className="remote-device" data-device={device.id}>
      <Smartphone size={18} />
      <div>
        {editing ? (
          <input
            value={name}
            maxLength={40}
            autoFocus
            aria-label="Nome do aparelho"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.nextSibling?.click()}
          />
        ) : (
          <strong>{device.name}</strong>
        )}
        <small>
          Pareado em {when(device.createdAt)} · último acesso {when(device.lastSeenAt)}
          {device.expired && ' · expirado: precisa parear de novo'}
        </small>
      </div>
      {editing ? (
        <>
          <button
            className="remote-icon"
            aria-label="Salvar nome"
            onClick={action(async () => {
              await call('remoteRenameDevice', { id: device.id, name });
              setEditing(false);
              refresh();
            })}
          >
            <Check size={15} />
          </button>
          <button className="remote-icon" aria-label="Cancelar" onClick={() => setEditing(false)}>
            <X size={15} />
          </button>
        </>
      ) : confirm ? (
        <button
          className="danger-button filled"
          onClick={action(async () => {
            await call('remoteRevokeDevice', { id: device.id });
            refresh();
          })}
        >
          Confirmar revogação
        </button>
      ) : (
        <>
          <button className="remote-icon" aria-label="Renomear" onClick={() => setEditing(true)}>
            <Pencil size={15} />
          </button>
          <button className="remote-icon" aria-label="Revogar acesso" onClick={() => setConfirm(true)}>
            <Trash2 size={15} />
          </button>
        </>
      )}
    </li>
  );
}

// Why Tailscale, and how to get the phone talking to this computer (the only way: there is no plain-HTTP mode).
function TailscaleGuide({ ts, openLink }) {
  return (
    <div className="remote-guide" data-testid="tailscale-guide">
      <strong>Para usar o celular é preciso o Tailscale</strong>
      <p>
        O Tailscale é gratuito e cria uma rede privada e criptografada entre o seu computador e o seu celular. Sem ele o
        controle remoto só funciona neste computador.
      </p>
      <ol>
        <li>Instale o Tailscale no computador e no celular e entre na mesma conta nos dois.</li>
        <li>Volte aqui, escolha &quot;Somente Tailscale&quot; e ligue o controle remoto.</li>
        <li>
          Clique em &quot;Parear novo aparelho&quot;, escaneie o QR code com o celular e autorize no diálogo do desktop.
        </li>
      </ol>
      <div className="remote-row">
        <button className="secondary-button" onClick={action(() => openLink('https://tailscale.com/download'))}>
          <Globe size={14} /> Baixar o Tailscale
        </button>
        <small className="fine-print">
          {!ts.installed
            ? 'Tailscale não encontrado neste computador.'
            : ts.running
              ? 'Tailscale conectado.'
              : 'Tailscale instalado, mas desconectado.'}
        </small>
      </div>
    </div>
  );
}

function Pairing({ pairing, onClose, notify }) {
  const now = useNow(true, 1000);
  const left = Math.max(0, Math.round((pairing.expiresAt - now) / 1000));
  return (
    <div className="remote-pairing" data-testid="pairing">
      {left > 0 ? (
        <img src={pairing.qr} width={220} height={220} alt="QR code de pareamento" />
      ) : (
        <p className="fine-print">Este código expirou. Gere outro.</p>
      )}
      <div>
        <p>
          Escaneie com a câmera do celular. O código vale por {Math.floor(left / 60)}:
          {String(left % 60).padStart(2, '0')} e só funciona uma vez.
        </p>
        <code className="remote-code">{pairing.code}</code>
        {!pairing.secure && (
          <p className="fine-print">Esta conexão é HTTP: dentro do Tailscale ela já é criptografada pela VPN.</p>
        )}
        <div className="remote-row">
          <button
            className="secondary-button"
            onClick={action(async () => {
              await navigator.clipboard.writeText(pairing.url);
              notify('Link copiado');
            })}
          >
            <Copy size={14} /> Copiar link
          </button>
          <button className="secondary-button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

export function RemoteSettings({ call, notify }) {
  const [status, setStatus] = useState(null),
    [port, setPort] = useState(''),
    [pairing, setPairing] = useState(null),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const s = await call('remoteStatus');
      setStatus(s);
      setPort((p) => (p === '' ? String(s.port) : p));
    } catch {}
  }, [call]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);
  const run = (fn) =>
    action(async () => {
      setBusy(true);
      try {
        const r = await fn();
        if (r) setStatus(r);
      } finally {
        setBusy(false);
      }
    });
  if (!status) return null;
  const ts = status.tailscale;
  const bindAvailable = { tailscale: !!status.addresses.tailscale, localhost: true };
  const choose = (bind) => run(() => call('remoteConfigure', { bind }))();
  return (
    <section className="settings-section" data-section="remote">
      <div className="settings-label">
        <Smartphone size={19} />
        <div>
          <h3>Controle remoto</h3>
          <p>Use o VeSTA pelo celular: conversas, atividade, quests, uso e pedidos de permissão.</p>
        </div>
      </div>
      <div className="remote-warning" role="note">
        <ShieldAlert size={16} />
        <span>
          Quem estiver pareado controla as IAs deste computador, que podem ler e alterar arquivos e rodar comandos.
          Pareie apenas aparelhos seus e revogue os que não usa mais.
        </span>
      </div>
      {status.notice && (
        <div className="remote-warning strong" role="alert" data-testid="remote-notice">
          <ShieldAlert size={16} />
          <span>{status.notice}</span>
        </div>
      )}
      <TailscaleGuide ts={ts} openLink={(url) => call('openLink', { url })} />
      <SettingToggle
        title="Ativar controle remoto"
        description="Desligado por padrão. Ao ligar, o VeSTA aceita aparelhos pareados na interface escolhida abaixo."
        checked={status.enabled}
        onChange={run(() => call('remoteConfigure', { enabled: !status.enabled }))}
      />
      <div className="remote-binds" role="radiogroup" aria-label="Interface de rede">
        {BINDS.map(([id, name, hint]) => (
          <button
            key={id}
            role="radio"
            aria-checked={status.bind === id}
            className={'remote-bind' + (status.bind === id ? ' chosen' : '')}
            disabled={busy || !bindAvailable[id]}
            onClick={() => choose(id)}
          >
            <strong>{name}</strong>
            <span>
              {bindAvailable[id] ? hint : id === 'tailscale' ? 'Tailscale não detectado neste computador.' : ''}
            </span>
            {id === 'tailscale' && status.addresses.tailscale && <code>{status.addresses.tailscale}</code>}
          </button>
        ))}
      </div>
      <div className="remote-row">
        <label className="remote-port">
          Porta
          <input
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            aria-label="Porta"
          />
        </label>
        <button
          className="secondary-button"
          disabled={busy || Number(port) === status.port}
          onClick={run(() => call('remoteConfigure', { port: Number(port) }))}
        >
          Aplicar porta
        </button>
      </div>
      <div className={'remote-status ' + (status.running ? 'on' : status.error ? 'err' : '')} role="status">
        <Wifi size={15} />
        {status.running ? (
          <span>
            Ligado em {status.listening.join(' e ')} · {status.clients} {status.clients === 1 ? 'cliente' : 'clientes'}{' '}
            conectado{status.clients === 1 ? '' : 's'}
          </span>
        ) : status.error ? (
          <span>{status.error}</span>
        ) : (
          <span>Desligado</span>
        )}
      </div>
      <div className="remote-row">
        <button
          className="primary-button"
          disabled={busy || !status.running}
          onClick={run(async () => {
            setPairing(await call('remotePairing'));
          })}
        >
          <QrCode size={15} /> Parear novo aparelho
        </button>
      </div>
      {pairing && <Pairing pairing={pairing} notify={notify} onClose={() => setPairing(null)} />}
      <h4 className="remote-subtitle">Aparelhos pareados</h4>
      {status.devices.length ? (
        <ul className="remote-devices">
          {status.devices.map((d) => (
            <Device key={d.id} device={d} call={call} refresh={refresh} />
          ))}
        </ul>
      ) : (
        <p className="fine-print">Nenhum aparelho pareado ainda.</p>
      )}
      <h4 className="remote-subtitle">HTTPS pelo Tailscale</h4>
      {!ts.installed ? (
        <p className="fine-print">
          Tailscale não encontrado. Instale em tailscale.com/download, entre na sua conta e ative o MagicDNS e o HTTPS
          no painel do Tailscale. Depois volte aqui para publicar o VeSTA com HTTPS (necessário para instalar o app e
          receber avisos no celular).
        </p>
      ) : !ts.running ? (
        <p className="fine-print">O Tailscale está instalado, mas desconectado. Entre na sua conta para continuar.</p>
      ) : (
        <>
          <p className="fine-print">
            {ts.serveState === 'foreign'
              ? 'A porta 443 do seu Tailscale já está em uso por outra publicação ("tailscale serve"). O VeSTA não vai alterá-la.'
              : ts.serving
                ? 'Publicado em ' +
                  ts.httpsUrl +
                  ' (visível só para a sua conta Tailscale).' +
                  (ts.serveOwned ? ' O VeSTA desfaz a publicação ao fechar.' : '')
                : 'Usa "tailscale serve" para expor a porta do VeSTA com HTTPS só dentro da sua tailnet.'}
          </p>
          <div className="remote-row">
            {ts.serveState === 'foreign' ? null : ts.serving ? (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={run(() => call('remoteHttps', { enable: false }))}
              >
                <Globe size={14} /> Desfazer publicação HTTPS
              </button>
            ) : (
              <button
                className="secondary-button"
                disabled={busy || !status.running}
                onClick={run(() => call('remoteHttps', { enable: true }))}
              >
                <Globe size={14} /> Publicar com HTTPS no seu Tailscale
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
