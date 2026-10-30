import { useState } from 'react';
import { Cloud, CloudOff, FileJson, LogIn, Loader2 } from 'lucide-react';
import { SettingToggle } from '../SettingToggle';
import { DriveSetup } from './DriveSetup';
import { DriveRestoreList } from './DriveRestoreList';
import { action } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';

// State 2: the key is saved but there is no Google login yet.
function DriveConnect({ setStatus, call, notify }) {
  const [busy, setBusy] = useState(false);
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
  );
}

// State 3: connected.
function DriveConnected({ status, setStatus, call, notify, restore }) {
  return (
    <>
      <SettingToggle
        title="Enviar cada backup ao Google Drive"
        description="O .zip vai para a pasta “VeSTA backups” do seu Drive logo depois de ser feito; lá também ficam só os últimos (os mais antigos vão para a lixeira do Drive)."
        checked={status.drive}
        onChange={action(async () => setStatus(await call('backupSettings', { drive: !status.drive })))}
      />
      <p className="backup-note" data-drive-last>
        {status.driveAt
          ? 'Último envio: ' + formatDateTime(status.driveAt) + ' · ' + status.driveFile
          : 'Nenhum envio ainda.'}
        {status.driveError && status.driveErrorAt > (status.driveAt || 0) && (
          <>
            <br />O último envio falhou ({formatDateTime(status.driveErrorAt)}): {status.driveError}
          </>
        )}
      </p>
      <div className="row backup-actions">
        <DriveRestoreList call={call} restore={restore} />
        <button className="secondary-button" onClick={action(async () => setStatus(await call('driveDisconnect')))}>
          <CloudOff size={15} />
          Desconectar
        </button>
      </div>
    </>
  );
}

// Google Drive part of Preferências → Backup. `status` is backupStatus() (status.cloud = the Drive side).
export function DriveBackup({ status, setStatus, call, notify, restore }) {
  const cloud = status.cloud;
  if (!cloud) return null;
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
      {!cloud.configured && <DriveSetup call={call} setStatus={setStatus} />}
      {cloud.configured && !cloud.connected && <DriveConnect call={call} setStatus={setStatus} notify={notify} />}
      {cloud.connected && (
        <DriveConnected status={status} setStatus={setStatus} call={call} notify={notify} restore={restore} />
      )}
    </div>
  );
}
