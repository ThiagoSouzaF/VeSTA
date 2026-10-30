import { useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { SettingRow } from './SettingRow';
import { action } from '../../lib/api';

const MIN = 8;

// "Proteger com senha": the next backups leave encrypted (.vesta). The password stays sealed on this computer by the
// system keychain, so automatic backups keep working; on another computer it is asked when restoring.
export function BackupPassword({ status, setStatus, call, notify }) {
  const [editing, setEditing] = useState(false),
    [password, setPassword] = useState(''),
    [again, setAgain] = useState('');
  const close = () => {
    setEditing(false);
    setPassword('');
    setAgain('');
  };
  const problem =
    password.length < MIN ? 'Use pelo menos ' + MIN + ' caracteres.' : password !== again ? 'As senhas não batem.' : '';
  const save = action(async () => {
    setStatus(await call('backupSetPassword', { password }));
    close();
    notify('Os próximos backups sairão protegidos por senha.');
  });
  return (
    <div className="backup-password" data-backup-protected={status.protected ? 'yes' : 'no'}>
      <SettingRow
        title="Proteger com senha"
        description={
          status.protected
            ? 'Ligado: os backups saem criptografados (.vesta) e só abrem com a senha, no VeSTA. Guarde a senha: sem ela não dá para restaurar em outro computador.'
            : 'Criptografa o backup inteiro (AES-256) antes de ele ir para a pasta ou para o Google Drive. Sem senha, o .zip abre em qualquer computador.'
        }
      >
        {status.protected ? (
          <button
            className="secondary-button"
            onClick={action(async () => {
              setStatus(await call('backupSetPassword', { password: '' }));
              notify('Os próximos backups sairão sem senha.');
            })}
          >
            <LockOpen size={15} />
            Remover senha
          </button>
        ) : (
          !editing && (
            <button className="secondary-button" disabled={!status.canProtect} onClick={() => setEditing(true)}>
              <Lock size={15} />
              Definir senha
            </button>
          )
        )}
      </SettingRow>
      {editing && (
        <div className="row backup-actions">
          <input
            type="password"
            aria-label="Nova senha do backup"
            placeholder="Senha (mínimo 8 caracteres)"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            type="password"
            aria-label="Repita a senha do backup"
            placeholder="Repita a senha"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
          <button className="primary-button" disabled={!!problem} onClick={save}>
            Salvar senha
          </button>
          <button className="secondary-button" onClick={close}>
            Cancelar
          </button>
          {password && problem && <p className="backup-note">{problem}</p>}
        </div>
      )}
    </div>
  );
}
