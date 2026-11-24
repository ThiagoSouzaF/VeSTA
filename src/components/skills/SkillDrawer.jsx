// The detail of one skill, in a drawer over the tiles: on/off, when it is used, which AIs follow it, what it costs,
// who adapted it, and the text (view, edit, the original). Esc or the X closes it.
import { useEffect, useState } from 'react';
import { X, Eye, Pencil, RefreshCw, Trash2, MessageSquarePlus } from 'lucide-react';
import { AIS, aiState, catalogTokens, fmt } from '../../lib/skills';
import { CostBars, ModeSeg, Switch } from './SkillBits';
import { RefinePanel } from '../refine/RefinePanel';

const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('pt-BR') : '');

export function SkillDrawer({
  skill: s,
  state,
  data,
  integrations,
  call,
  setData,
  notify,
  onClose,
  onTry,
  onUpdate,
  onOpenRefine,
}) {
  const [view, setView] = useState(null); // null | 'text' | 'original' | 'edit'
  const [doc, setDoc] = useState(null);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const set = async (patch, message) => {
    try {
      const r = await call('skillsSet', { name: s.name, ...patch });
      setData(r.state);
      if (message) notify(message);
    } catch {}
  };
  const open = async (which) => {
    if (view === which) return setView(null);
    try {
      const d = doc || (await call('skillsRead', { name: s.name }));
      setDoc(d);
      if (which === 'edit') setDraft(d.text);
      setView(which);
    } catch {}
  };
  const saveText = async () => {
    await set({ text: draft }, 'Skill /' + s.name + ' salva');
    setDoc(null);
    setView(null);
  };
  const remove = async () => {
    try {
      const r = await call('skillsRemove', { name: s.name });
      setData(r.state);
      notify('Skill /' + s.name + ' removida');
      onClose();
    } catch {}
  };
  const github = s.source?.kind === 'github' && s.source.url;
  return (
    <>
      <div className="skill-drawer-scrim" data-state={state} onClick={onClose} />
      <aside className="skill-drawer" data-state={state} aria-label={'Skill ' + s.name} data-skill={s.name}>
        <div className="skill-drawer-head">
          <div>
            <div className="skill-origin">
              {s.source?.label || 'Criadas por você'}
              {s.source?.license ? ' · ' + s.source.license : ''}
            </div>
            <h2>/{s.name}</h2>
          </div>
          <Switch
            on={s.enabled}
            label={(s.enabled ? 'Desligar ' : 'Ligar ') + s.name}
            onChange={(on) => set({ enabled: on }, 'Skill /' + s.name + (on ? ' ligada' : ' desligada'))}
          />
          <button className="skill-close" aria-label="Fechar" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="skill-drawer-desc">{s.description || 'Sem descrição.'}</p>
        <dl className="skill-dl">
          <dt>QUANDO</dt>
          <dd>
            <ModeSeg value={s.mode} onChange={(mode) => set({ mode })} />
            <small>
              {s.mode === 'auto'
                ? 'A IA vê o nome e a descrição e carrega a skill quando o pedido combina.'
                : 'Fora da lista da IA: só entra quando você digita /' + s.name + '.'}
            </small>
          </dd>
          <dt>IAS</dt>
          <dd className="skill-ai-list">
            {AIS.map(([id, letter, name]) => {
              const st = aiState(s, id);
              return (
                <span key={id} className="skill-ai-line">
                  <span className={'skill-ai' + (st.ok ? '' : ' off')}>{letter}</span>
                  {name} <small>· {st.ok ? 'funciona' : st.why}</small>
                </span>
              );
            })}
          </dd>
          <dt>CUSTO</dt>
          <dd>
            <span className="skill-cost-line">
              <CostBars skill={s} /> ~{fmt(s.tokens)} tokens quando usada
            </span>
            <small>
              {s.mode === 'auto' && s.enabled
                ? '~' + catalogTokens(s) + ' tokens na lista de cada sessão'
                : 'Fora da lista: não custa nada até você chamar'}
            </small>
          </dd>
          <dt>ORIGEM</dt>
          <dd>
            {s.adaptedBy
              ? 'Adaptada por ' + (AIS.find((a) => a[0] === s.adaptedBy)?.[2] || s.adaptedBy)
              : 'Guardada como veio'}
            {fmtDate(s.updatedAt) && <small>em {fmtDate(s.updatedAt)}</small>}
            {s.changes?.length > 0 && (
              <ul className="skill-changes">
                {s.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </dd>
          <dt>USO</dt>
          <dd>
            {s.uses
              ? s.uses + (s.uses > 1 ? ' vezes' : ' vez') + ', a última em ' + fmtDate(s.lastUsedAt)
              : 'Ainda não usada'}
          </dd>
        </dl>
        <div className="skill-call">
          <span className="mono">/{s.name}</span>
          <button className="text-link" onClick={() => onTry(s.name)} disabled={!s.enabled}>
            <MessageSquarePlus size={14} />
            Testar num chat
          </button>
        </div>
        <RefinePanel
          kind="skill"
          target={s}
          data={data}
          integrations={integrations}
          call={call}
          setData={(st) => {
            setDoc(null);
            setData(st);
          }}
          notify={notify}
          onOpenRefine={onOpenRefine}
        />
        <div className="skill-actions">
          <button className="secondary-button" aria-pressed={view === 'text'} onClick={() => open('text')}>
            <Eye size={14} />
            Ver texto
          </button>
          <button className="secondary-button" aria-pressed={view === 'edit'} onClick={() => open('edit')}>
            <Pencil size={14} />
            Editar
          </button>
          {github && (
            <button className="secondary-button" onClick={() => onUpdate(s.source.url)}>
              <RefreshCw size={14} />
              Atualizar do GitHub
            </button>
          )}
          {confirm ? (
            <button className="secondary-button danger" onClick={remove}>
              <Trash2 size={14} />
              Confirmar remoção
            </button>
          ) : (
            <button className="secondary-button ghost-danger" onClick={() => setConfirm(true)}>
              <Trash2 size={14} />
              Remover
            </button>
          )}
        </div>
        {doc && view === 'text' && (
          <div className="skill-doc">
            <div className="skill-doc-head">
              <b>SKILL.md{s.adaptedBy ? ' (adaptada)' : ''}</b>
              {doc.original && (
                <button className="text-link" onClick={() => setView('original')}>
                  Ver original
                </button>
              )}
            </div>
            <pre>{doc.text}</pre>
            {doc.files.length > 0 && (
              <p className="skill-files">
                Arquivos de apoio: {doc.files.map((f) => f.path + (f.script ? ' (script)' : '')).join(', ')}
              </p>
            )}
          </div>
        )}
        {doc && view === 'original' && (
          <div className="skill-doc">
            <div className="skill-doc-head">
              <b>ORIGINAL</b>
              <button className="text-link" onClick={() => setView('text')}>
                Ver adaptada
              </button>
            </div>
            <pre>{doc.original}</pre>
          </div>
        )}
        {view === 'edit' && (
          <div className="skill-doc">
            <textarea
              className="skill-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Texto da skill"
              spellCheck={false}
            />
            <div className="skill-actions">
              <button className="secondary-button" onClick={() => setView(null)}>
                Cancelar
              </button>
              <button className="primary-button" onClick={saveText} disabled={!draft.trim()}>
                Salvar texto
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
