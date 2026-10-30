import { useCallback, useEffect, useState } from 'react';
import { Archive, Folder, FolderOpen, RotateCcw, Loader2 } from 'lucide-react';
import { DriveBackup } from './drive/DriveBackup';
import { SettingsSection } from './SettingsSection';
import { SettingRow } from './SettingRow';
import { BackupPassword } from './BackupPassword';
import { useRestore, RestorePrompt } from './RestorePrompt';
import { action } from '../../lib/api';
import { formatDateTime, formatBytes } from '../../lib/format';

const AUTO = [
  ['off', 'Desligado'],
  ['daily', 'Todo dia'],
  ['weekly', 'Toda semana'],
];

// Preferências → Backup: one .zip with the conversations, memories and preferences (readable as Markdown anywhere)
// that also restores the app, plus its copy in Google Drive (DriveBackup).
export function BackupSettings({ call, notify }) {
  const [status, setStatus] = useState(null),
    [busy, setBusy] = useState(false);
  const restore = useRestore(call, notify);
  const refresh = useCallback(() => call('backupStatus').then(setStatus), [call]);
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);
  if (!status) return null;
  const save = (patch) => action(async () => setStatus(await call('backupSettings', patch)))();
  const backupNow = action(async () => {
    setBusy(true);
    try {
      const s = await call('backupNow');
      setStatus(s);
      const cloud =
        s.cloud?.connected && s.drive
          ? s.driveErrorAt >= s.lastAt
            ? ' O envio ao Google Drive falhou: ' + s.driveError
            : ' Enviado ao Google Drive.'
          : '';
      notify(
        (s.lastWarning ? 'Backup salvo, mas sem a memória: ' + s.lastWarning : 'Backup salvo: ' + s.lastFile) +
          '.' +
          cloud
      );
    } finally {
      setBusy(false);
    }
  });
  return (
    <SettingsSection
      id="backup"
      icon={Archive}
      title="Backup"
      description="Um arquivo .zip com suas conversas, memórias e preferências em Markdown, que abre em qualquer editor sem o VeSTA, e com o necessário para restaurar tudo aqui."
    >
      <div className="setting-row">
        <div>
          <strong>Pasta dos backups</strong>
          <p className="backup-folder" title={status.folder}>
            {status.folder}
          </p>
        </div>
        <button className="secondary-button" onClick={action(async () => setStatus(await call('backupChooseFolder')))}>
          <Folder size={15} />
          Escolher pasta
        </button>
      </div>
      <SettingRow
        title="Backup automático"
        description="Feito em segundo plano com o VeSTA aberto. Os mais antigos são apagados, ficam só os últimos."
      >
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
      </SettingRow>
      <BackupPassword status={status} setStatus={setStatus} call={call} notify={notify} />
      <p className="backup-note" data-backup-last>
        {status.lastAt
          ? 'Último backup: ' +
            formatDateTime(status.lastAt) +
            (status.lastSize ? ' · ' + formatBytes(status.lastSize) : '')
          : 'Nenhum backup feito ainda.'}
        {status.lastWarning && ' · sem a memória (' + status.lastWarning + ')'}
        {status.lastError && status.lastErrorAt > (status.lastAt || 0) && (
          <>
            <br />A última tentativa falhou ({formatDateTime(status.lastErrorAt)}): {status.lastError}
          </>
        )}
        {status.lastRestore && (
          <>
            <br />
            Restaurado em {formatDateTime(status.lastRestore.at)} a partir do backup de{' '}
            {formatDateTime(status.lastRestore.createdAt)}
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
        <button className="secondary-button" onClick={action(() => restore.restore('backupRestore'))}>
          <RotateCcw size={15} />
          Restaurar de um arquivo
        </button>
      </div>
      <RestorePrompt restore={restore} />
      <DriveBackup status={status} setStatus={setStatus} call={call} notify={notify} restore={restore} />
    </SettingsSection>
  );
}
