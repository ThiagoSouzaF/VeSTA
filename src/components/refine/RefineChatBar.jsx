// The bar over a refinement chat: what it refines and, once the AI proposed, the proposal with Aplicar / Descartar.
import { Sparkles } from 'lucide-react';
import { refineTargetOf } from '../../lib/refine';
import { ProposalView } from './ProposalView';

export function RefineChatBar({ chat, data, call, setData, notify }) {
  const r = refineTargetOf(chat, data);
  if (!r) return null;
  return (
    <div className="refine-chat-bar" data-refine={r.kind}>
      <div className="refine-chat-title">
        <Sparkles size={14} />
        <span>
          Refinando <b>{r.label}</b>
        </span>
        <small>
          {!r.target
            ? r.kind === 'skill'
              ? 'A skill foi removida.'
              : 'O agent foi removido.'
            : r.target.proposal
              ? 'Proposta pronta: confira e aplique.'
              : 'A IA propõe aqui; nada muda sem o seu sim.'}
        </small>
      </div>
      {r.target?.proposal && (
        <ProposalView kind={r.kind} target={r.target} call={call} setData={setData} notify={notify} compact />
      )}
    </div>
  );
}
