import { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2, Check, X, UserRound } from 'lucide-react';
import { action } from '../lib/api';
import { formatDate } from '../lib/format';
import { PROVIDERS } from '../lib/constants';
import { IconButton } from './IconButton';

const CATEGORY = {
  stack: 'Stack',
  architecture: 'Arquitetura',
  workflow: 'Fluxo de trabalho',
  testing: 'Testes',
  tools: 'Ferramentas',
  style: 'Estilo',
  habits: 'Hábitos',
  preferences: 'Preferências',
};
const originOf = (o) =>
  !o
    ? 'Aprendida pelo servidor de memória'
    : o.provider === 'user'
      ? 'Escrita por você'
      : (PROVIDERS[o.provider]?.name || o.provider) + (o.chatTitle ? ' · conversa "' + o.chatTitle + '"' : '');

// Preferences the AIs learned (profile/ of the AI Memory): they travel to every project and every AI.
export function ProfileList({ call, connected }) {
  const [entries, setEntries] = useState(null),
    [error, setError] = useState(''),
    [editing, setEditing] = useState(null),
    [draft, setDraft] = useState('');
  const load = useCallback(async () => {
    try {
      setEntries(await call('profileList'));
      setError('');
    } catch (e) {
      setError(e.message);
      setEntries([]);
    }
  }, [call]);
  useEffect(() => {
    if (connected !== false) load();
    else setEntries([]);
  }, [connected, load]);
  if (entries === null) return <p className="muted">Carregando as preferências aprendidas…</p>;
  return (
    <div className="profile-list" data-testid="profile-list">
      {error && <p className="inline-error">{error}</p>}
      {!entries.length && !error && (
        <p className="profile-empty">
          <UserRound size={15} />
          <span>
            <strong>Nada aprendido ainda.</strong> Quando você disser como gosta de trabalhar ("prefiro respostas
            curtas", "sempre em português"), as IAs registram aqui, e todas passam a seguir.
          </span>
        </p>
      )}
      {entries.map((e) => (
        <article className="memory-card profile-card" key={e.path} data-testid="profile-entry">
          <div className="memory-card-label">
            <span>
              <UserRound size={13} /> {(CATEGORY[e.category] || e.category || 'PERFIL').toUpperCase()}
            </span>
            <span className="profile-actions">
              {editing === e.path ? (
                <>
                  <IconButton
                    icon={Check}
                    label="Salvar"
                    onClick={action(async () => {
                      await call('saveProfile', { path: e.path, statement: draft, subject: e.path.split('/').pop() });
                      setEditing(null);
                      await load();
                    })}
                  />
                  <IconButton icon={X} label="Cancelar" onClick={() => setEditing(null)} />
                </>
              ) : (
                <>
                  <IconButton
                    icon={Pencil}
                    label="Editar"
                    onClick={() => {
                      setEditing(e.path);
                      setDraft(e.statement);
                    }}
                  />
                  <IconButton
                    icon={Trash2}
                    label="Apagar"
                    onClick={action(async () => {
                      await call('deleteProfile', { path: e.path });
                      await load();
                    })}
                  />
                </>
              )}
            </span>
          </div>
          {editing === e.path ? (
            <textarea value={draft} onChange={(ev) => setDraft(ev.target.value)} rows={3} autoFocus />
          ) : (
            <h3>{e.statement}</h3>
          )}
          <div className="memory-card-footer">
            <span>{originOf(e.origin)}</span>
            <span>{e.origin?.at ? formatDate(e.origin.at) : e.path}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
