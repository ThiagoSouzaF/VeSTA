import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { action } from '../../lib/api';

// Restoring a backup (from a file or from Google Drive). A protected one comes back as { needsPassword, ref }: the
// prompt below asks for the password and tries again with the same ref; the main process keeps the file meanwhile.
export function useRestore(call, notify) {
  const [asking, setAsking] = useState(null); // { ref, wrong }
  const settle = (r) => {
    if (r?.needsPassword) return setAsking({ ref: r.ref, wrong: r.wrong });
    setAsking(null);
    if (r === true) notify('Restaurando: o VeSTA vai reiniciar.');
  };
  return {
    asking,
    restore: async (method, args) => settle(await call(method, args)),
    retry: async (password) => settle(await call('backupRestorePassword', { ref: asking.ref, password })),
    cancel: () => setAsking(null),
  };
}

export function RestorePrompt({ restore }) {
  const [password, setPassword] = useState('');
  if (!restore.asking) return null;
  const submit = action(async () => {
    await restore.retry(password);
    setPassword('');
  });
  return (
    <div className="restore-password" data-restore-password>
      <p className="backup-note">
        <KeyRound size={13} />{' '}
        {restore.asking.wrong ? 'Senha incorreta. Tente de novo.' : 'Este backup está protegido por senha.'}
      </p>
      <div className="row backup-actions">
        <input
          type="password"
          aria-label="Senha do backup"
          placeholder="Senha do backup"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && password && submit()}
        />
        <button className="primary-button" disabled={!password} onClick={submit}>
          Restaurar
        </button>
        <button className="secondary-button" onClick={restore.cancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
