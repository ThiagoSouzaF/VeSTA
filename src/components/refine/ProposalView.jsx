// A proposal from a refinement chat, waiting for the person: what changed (the AI's words), how much, the line diff
// against the text in use, and Aplicar / Descartar. Used in the skill and agent drawers and in the refinement chat.
import { useEffect, useMemo, useState } from 'react';
import { Check, X, GitCompare } from 'lucide-react';
import { PROVIDERS } from '../../lib/constants';
import { lineDiff, diffStats, diffHunks } from '../../lib/refine';

const when = (t) => (t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export function DiffView({ before, after }) {
  const lines = useMemo(() => diffHunks(lineDiff(before, after)), [before, after]);
  return (
    <pre className="refine-diff" aria-label="Diferenças">
      {lines.map((l, i) => (
        <span key={i} className={'refine-line' + ({ '+': ' add', '-': ' del', '…': ' gap' }[l.op] || '')}>
          <i aria-hidden="true">{l.op === '…' ? '' : l.op}</i>
          {l.text || ' '}
        </span>
      ))}
    </pre>
  );
}

// target: the skill (meta from the library list) or the agent. Agents carry their proposal; a skill's text is read.
export function ProposalView({ kind, target, call, setData, notify, compact = false }) {
  const key = kind === 'skill' ? { kind, name: target.name } : { kind, id: target.id };
  const meta = target.proposal;
  const [doc, setDoc] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (kind !== 'skill' || !meta) return setDoc(null);
    let live = true;
    call('refineProposal', key)
      .then((d) => live && setDoc(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [kind, target.name, meta?.at]);
  if (!meta) return null;
  const before = kind === 'skill' ? doc?.current : target.prompt;
  const after = kind === 'skill' ? doc?.text : meta.prompt;
  const stats = before != null && after != null ? diffStats(lineDiff(before, after)) : null;
  const act = async (method, message) => {
    setBusy(true);
    try {
      const r = await call(method, key);
      setData(r.state);
      notify(message);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const label = kind === 'skill' ? '/' + target.name : target.name;
  return (
    <div className={'refine-proposal' + (compact ? ' compact' : '')} data-proposal={kind}>
      <div className="refine-proposal-head">
        <b>Proposta de refino</b>
        <span>
          {PROVIDERS[meta.provider]?.name || 'IA'} · {when(meta.at)}
          {stats && (
            <>
              {' · '}
              <em className="add">+{stats.added}</em> <em className="del">−{stats.removed}</em> linhas
            </>
          )}
        </span>
      </div>
      {meta.changes?.length > 0 && (
        <ul className="refine-changes">
          {meta.changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
      {kind === 'agent' && meta.lessons && (
        <p className="refine-lessons-note">
          Lições aprovadas passam a ser {meta.lessons.length}
          {meta.lessons.length ? ': ' + meta.lessons.join(' · ') : ''}.
        </p>
      )}
      {open && before != null && after != null && <DiffView before={before} after={after} />}
      <div className="refine-proposal-actions">
        <button className="secondary-button" aria-pressed={open} onClick={() => setOpen(!open)}>
          <GitCompare size={14} />
          {open ? 'Esconder diferenças' : 'Ver diferenças'}
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => act('refineDiscard', 'Proposta descartada')}
        >
          <X size={14} />
          Descartar
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => act('refineApply', label + ' refinado. A versão anterior ficou em Versões.')}
        >
          <Check size={14} />
          Aplicar
        </button>
      </div>
    </div>
  );
}
