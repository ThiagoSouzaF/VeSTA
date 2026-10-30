import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { SettingRow } from '../SettingRow';
import { action } from '../../../lib/api';
import { formatDateTime, formatBytes } from '../../../lib/format';

// Button that loads the backups kept in Google Drive and, once loaded, lists them with a Restaurar button each.
// `restore` (useRestore) asks for the password of a protected backup.
export function DriveRestoreList({ call, restore }) {
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
        <SettingRow
          key={f.id}
          title={formatDateTime(f.createdAt)}
          description={
            <>
              {formatBytes(f.size)}
              {f.computer ? ' · ' + f.computer : ''}
            </>
          }
        >
          <button
            className="secondary-button"
            disabled={loading}
            onClick={action(async () => {
              setLoading(true);
              try {
                await restore.restore('driveRestore', { id: f.id });
              } finally {
                setLoading(false);
              }
            })}
          >
            <RotateCcw size={15} />
            Restaurar
          </button>
        </SettingRow>
      ))}
    </div>
  );
}
