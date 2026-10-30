import { useState } from 'react';
import { Cloud, CloudOff, FileJson, LogIn, Loader2, RotateCcw, ChevronDown } from 'lucide-react';
import { SettingToggle } from './SettingToggle';
import { action } from '../lib/api';

const when = (t) => (t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const LINKS = {
  project: 'https://console.cloud.google.com/projectcreate',
  api: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
  auth: 'https://console.cloud.google.com/auth/overview',
  audience: 'https://console.cloud.google.com/auth/audience',
  clients: 'https://console.cloud.google.com/auth/clients',
};

function Link({ call, href, children }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        call('openLink', { url: href });
      }}
    >
      {children}
    </a>
  );
}

// The OAuth client is the person's own (a free Google Cloud project): VeSTA has no server and keeps no keys of its own.
function Setup({ call, setStatus }) {
  const [id, setId] = useState(''),
    [secret, setSecret] = useState('');
  return (
    <div className="drive-setup">
      <p className="backup-note">
        O VeSTA envia os backups direto para o seu Google Drive, numa pasta “VeSTA backups”, e só enxerga os arquivos
        que ele mesmo criou. Para isso, crie uma vez (uns 5 minutos) a sua chave de acesso no Google Cloud, de graça:
      </p>
      <ol className="drive-steps">
        <li>
          <Link call={call} href={LINKS.project}>
            Crie um projeto
          </Link>{' '}
          chamado VeSTA.
        </li>
        <li>
          <Link call={call} href={LINKS.api}>
            Ative a Google Drive API
          </Link>{' '}
          nesse projeto.
        </li>
        <li>
          Em{' '}
          <Link call={call} href={LINKS.auth}>
            Google Auth Platform
          </Link>
          , clique em Começar: nome do app “VeSTA”, seu e-mail, público <strong>Externo</strong>. Depois, em{' '}
          <Link call={call} href={LINKS.audience}>
            Público-alvo
          </Link>
          , clique em <strong>Publicar app</strong> (em teste, o acesso expira a cada 7 dias).
        </li>
        <li>
          Em{' '}
          <Link call={call} href={LINKS.clients}>
            Clientes
          </Link>
          , crie um cliente do tipo <strong>App para computador</strong> e baixe o JSON.
        </li>
        <li>Escolha esse JSON aqui e clique em Conectar.</li>
      </ol>
      <div className="row backup-actions">
        <button className="primary-button" onClick={action(async () => setStatus(await call('driveSetClient')))}>
          <FileJson size={15} />
          Escolher o JSON do cliente
        </button>
      </div>
      <details className="drive-paste">
        <summary>
          <ChevronDown size={13} /> Ou cole o ID e a chave secreta
        </summary>
        <div className="drive-paste-fields">
          <input
            aria-label="ID do cliente"
            placeholder="ID do cliente (…apps.googleusercontent.com)"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
          <input
            aria-label="Chave secreta do cliente"
            placeholder="Chave secreta (GOCSPX-…)"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <button
            className="secondary-button"
            disabled={!id || !secret}
            onClick={action(async () => {
              setStatus(await call('driveSetClient', { clientId: id, clientSecret: secret }));
              setSecret('');
            })}
          >
            Salvar
          </button>
        </div>
      </details>
      <p className="backup-note">
        Em outro computador, use o mesmo JSON e a mesma conta do Google para ver e restaurar estes backups.
      </p>
    </div>
  );
}

function Remote({ call, notify }) {
  const [list, setList] = useState(null),
    [loading, setLoading] = useState(false);
  const load = action(async () => {
    setLoading(true);
    try {
      setList(await call('driveBackups'));
    } finally {
      setLoading(false);
    }
  });
  if (!list)
    return (
      <button className="secondary-button" disabled={loading} onClick={load}>
        {loading ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />}
        Restaurar do Google Drive
      </button>
    );
  return (
    <div className="drive-list" data-drive-list>
      {!list.length && <p className="backup-note">Nenhum backup no Google Drive ainda.</p>}
      {list.map((f) => (
        <div className="setting-row" key={f.id}>
          <div>
            <strong>{when(f.createdAt)}</strong>
            <p>
              {size(f.size)}
              {f.computer ? ' · ' + f.computer : ''}
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={loading}
            onClick={action(async () => {
              setLoading(true);
              try {
                const restarting = await call('driveRestore', { id: f.id });
                if (restarting) notify('Restaurando: o VeSTA vai reiniciar.');
              } finally {
                setLoading(false);
              }
            })}
          >
            <RotateCcw size={15} />
            Restaurar
          </button>
        </div>
      ))}
    </div>
  );
}

// Google Drive part of Preferências → Backup. `status` is backupStatus() (status.cloud = the Drive side).
export function DriveBackup({ status, setStatus, call, notify }) {
  const cloud = status.cloud;
  const [busy, setBusy] = useState(false);
  if (!cloud) return null;
  const connect = action(async () => {
    setBusy(true);
    try {
      setStatus(await call('driveConnect'));
      notify('Google Drive conectado.');
    } finally {
      setBusy(false);
      call('backupStatus').then(setStatus);
    }
  });
  return (
    <div
      className="drive-backup"
      data-drive={cloud.connected ? 'connected' : cloud.configured ? 'configured' : 'setup'}
    >
      <div className="settings-label drive-head">
        {cloud.connected ? <Cloud size={17} /> : <CloudOff size={17} />}
        <div>
          <strong>Google Drive</strong>
          <p>
            {cloud.connected
              ? 'Conectado como ' + (cloud.email || 'sua conta') + ' · pasta “' + cloud.folder + '”'
              : cloud.configured
                ? 'Chave de acesso salva. Falta entrar com sua conta do Google.'
                : 'Não configurado.'}
          </p>
        </div>
      </div>
      {cloud.error && <p className="backup-note backup-error">{cloud.error}</p>}
      {!cloud.configured && <Setup call={call} setStatus={setStatus} />}
      {cloud.configured && !cloud.connected && (
        <div className="row backup-actions">
          <button className="primary-button" disabled={busy} onClick={connect}>
            {busy ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />}
            {busy ? 'Aguardando o login no navegador…' : 'Conectar com o Google'}
          </button>
          <button className="secondary-button" onClick={action(async () => setStatus(await call('driveSetClient')))}>
            <FileJson size={15} />
            Trocar o JSON do cliente
          </button>
        </div>
      )}
      {cloud.connected && (
        <>
          <SettingToggle
            title="Enviar cada backup ao Google Drive"
            description="O .zip vai para a pasta “VeSTA backups” do seu Drive logo depois de ser feito; lá também ficam só os últimos (os mais antigos vão para a lixeira do Drive)."
            checked={status.drive}
            onChange={action(async () => setStatus(await call('backupSettings', { drive: !status.drive })))}
          />
          <p className="backup-note" data-drive-last>
            {status.driveAt
              ? 'Último envio: ' + when(status.driveAt) + ' · ' + status.driveFile
              : 'Nenhum envio ainda.'}
            {status.driveError && status.driveErrorAt > (status.driveAt || 0) && (
              <>
                <br />O último envio falhou ({when(status.driveErrorAt)}): {status.driveError}
              </>
            )}
          </p>
          <div className="row backup-actions">
            <Remote call={call} notify={notify} />
            <button className="secondary-button" onClick={action(async () => setStatus(await call('driveDisconnect')))}>
              <CloudOff size={15} />
              Desconectar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
