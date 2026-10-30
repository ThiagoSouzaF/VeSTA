import { useCallback, useEffect, useState } from 'react';
import { Archive, Folder, FolderOpen, Cloud, RotateCcw, Loader2 } from 'lucide-react';
import { action } from '../lib/api';

const AUTO = [
  ['off', 'Desligado'],
  ['daily', 'Todo dia'],
  ['weekly', 'Toda semana'],
];
const when = (t) => (t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const DRIVE_DOWNLOAD = 'https://www.google.com/drive/download/';

// Preferências → Backup: one .zip with the conversations, memories and preferences (readable as Markdown anywhere)
// that also restores the app. Google Drive is reached through its desktop app: the folder it syncs.
export function BackupSettings({ call, notify }) {
  const [status, setStatus] = useState(null),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(() => call('backupStatus').then(setStatus), [call]);
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);
  if (!status) return null;
  const drive = status.googleDrive || [];
  const onDrive = drive.includes(status.folder);
  const save = (patch) => action(async () => setStatus(await call('backupSettings', patch)))();
  const backupNow = action(async () => {
    setBusy(true);
    try {
      const s = await call('backupNow');
      setStatus(s);
      notify(s.lastWarning ? 'Backup salvo, mas sem a memória: ' + s.lastWarning : 'Backup salvo: ' + s.lastFile);
    } finally {
      setBusy(false);
    }
  });
  return (
    <section className="settings-section" data-section="backup">
      <div className="settings-label">
        <Archive size={19} />
        <div>
          <h3>Backup</h3>
          <p>
            Um arquivo .zip com suas conversas, memórias e preferências em Markdown, que abre em qualquer editor sem o
            VeSTA, e com o necessário para restaurar tudo aqui.
          </p>
        </div>
      </div>
      <div className="setting-row">
        <div>
          <strong>Pasta dos backups</strong>
          <p className="backup-folder" title={status.folder}>
            {onDrive && <Cloud size={13} />} {status.folder}
          </p>
        </div>
        <button className="secondary-button" onClick={action(async () => setStatus(await call('backupChooseFolder')))}>
          <Folder size={15} />
          Escolher pasta
        </button>
      </div>
      {drive.length > 0 && !onDrive && (
        <div className="setting-row">
          <div>
            <strong>Google Drive encontrado</strong>
            <p>Os backups salvos em {drive[0]} sobem para o seu Drive sozinhos.</p>
          </div>
          <button
            className="secondary-button"
            onClick={action(async () => setStatus(await call('backupChooseFolder', { target: drive[0] })))}
          >
            <Cloud size={15} />
            Usar o Google Drive
          </button>
        </div>
      )}
      {!drive.length && (
        <p className="backup-note">
          Para guardar no Google Drive, instale o{' '}
          <a
            href={DRIVE_DOWNLOAD}
            onClick={(e) => {
              e.preventDefault();
              call('openLink', { url: DRIVE_DOWNLOAD });
            }}
          >
            Google Drive para computador
          </a>
          , entre com sua conta e volte aqui: o VeSTA encontra a pasta “Meu Drive” e passa a enviar os backups para lá.
        </p>
      )}
      <div className="setting-row">
        <div>
          <strong>Backup automático</strong>
          <p>Feito em segundo plano com o VeSTA aberto. Os mais antigos são apagados, ficam só os últimos.</p>
        </div>
        <div className="row">
          <select
            aria-label="Frequência do backup automático"
            value={status.auto}
            onChange={(e) => save({ auto: e.target.value })}
          >
            {AUTO.map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Quantos backups manter"
            value={status.keep}
            onChange={(e) => save({ keep: Number(e.target.value) })}
          >
            {[3, 5, 10, 20, 30].map((n) => (
              <option value={n} key={n}>
                manter {n}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="backup-note" data-backup-last>
        {status.lastAt
          ? 'Último backup: ' + when(status.lastAt) + (status.lastSize ? ' · ' + size(status.lastSize) : '')
          : 'Nenhum backup feito ainda.'}
        {status.lastWarning && ' · sem a memória (' + status.lastWarning + ')'}
        {status.lastError && status.lastErrorAt > (status.lastAt || 0) && (
          <>
            <br />A última tentativa falhou ({when(status.lastErrorAt)}): {status.lastError}
          </>
        )}
        {status.lastRestore && (
          <>
            <br />
            Restaurado em {when(status.lastRestore.at)} a partir do backup de {when(status.lastRestore.createdAt)}
            {status.lastRestore.errors?.length ? ' · problemas: ' + status.lastRestore.errors.join('; ') : ''}.
          </>
        )}
      </p>
      <div className="row backup-actions">
        <button className="primary-button" disabled={busy} onClick={backupNow}>
          {busy ? <Loader2 size={15} className="spin" /> : <Archive size={15} />}
          {busy ? 'Fazendo backup…' : 'Fazer backup agora'}
        </button>
        <button className="secondary-button" onClick={action(() => call('backupOpenFolder'))}>
          <FolderOpen size={15} />
          Abrir pasta
        </button>
        <button className="secondary-button" onClick={action(() => call('backupRestore'))}>
          <RotateCcw size={15} />
          Restaurar de um backup
        </button>
      </div>
    </section>
  );
}
