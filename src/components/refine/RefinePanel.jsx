// "Refinar" in the skill and agent drawers: the proposal waiting for a yes, or a chat with an AI that reads the text,
// the recent uses (or runs), the lessons and the memory, talks with the person and proposes a new version. Below,
// the versions kept before each change, each one can come back.
import { useState } from 'react';
import { Sparkles, MessageSquare, History, RotateCcw, Eye } from 'lucide-react';
import { PROVIDERS } from '../../lib/constants';
import { ProviderIcon } from '../ProviderIcon';
import { modelLabel } from '../../lib/format';
import { refineChatOf } from '../../lib/refine';
import { ProposalView } from './ProposalView';

const ORDER = ['claude', 'codex', 'opencode', 'drael'];
const when = (t) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function Versions({ kind, target, call, setData, notify }) {
  const list = target.versions || [];
  const [shown, setShown] = useState(null); // { n, text }
  const [confirm, setConfirm] = useState(null);
  const key = kind === 'skill' ? { kind, name: target.name } : { kind, id: target.id };
  if (!list.length) return null;
  const show = async (v) => {
    if (shown?.n === v.n) return setShown(null);
    if (kind === 'agent')
      return setShown({
        n: v.n,
        text:
          v.prompt + (v.lessons?.length ? '\n\nLições aprovadas:\n' + v.lessons.map((l) => '- ' + l).join('\n') : ''),
      });
    try {
      setShown({ n: v.n, text: (await call('refineVersion', { name: target.name, n: v.n })).text });
    } catch {}
  };
  const restore = async (n) => {
    try {
      const r = await call('refineRestore', { ...key, n });
      setData(r.state);
      setConfirm(null);
      setShown(null);
      notify('Voltou à versão ' + n + '. A que estava em uso também ficou guardada.');
    } catch {}
  };
  return (
    <details className="refine-versions">
      <summary>
        <History size={14} />
        Versões anteriores <span>{list.length}</span>
      </summary>
      <ol>
        {list.map((v) => (
          <li key={v.n} data-version={v.n}>
            <div className="refine-version-meta">
              <b>v{v.n}</b>
              <span>{when(v.at)}</span>
              <span className="refine-version-note">{v.note}</span>
            </div>
            <div className="refine-version-actions">
              <button className="text-link" aria-pressed={shown?.n === v.n} onClick={() => show(v)}>
                <Eye size={13} />
                Ver
              </button>
              {confirm === v.n ? (
                <button className="text-link danger" onClick={() => restore(v.n)}>
                  <RotateCcw size={13} />
                  Confirmar volta
                </button>
              ) : (
                <button className="text-link" onClick={() => setConfirm(v.n)}>
                  <RotateCcw size={13} />
                  Voltar a esta
                </button>
              )}
            </div>
            {shown?.n === v.n && <pre className="refine-version-text">{shown.text}</pre>}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function RefinePanel({ kind, target, data, integrations, call, setData, notify, onOpenRefine }) {
  const chat = refineChatOf(data.chats, kind, target);
  const preferred = kind === 'agent' ? target.provider : 'claude';
  const first = [preferred, ...ORDER].find((id) => integrations?.[id]?.installed) || preferred;
  const [provider, setProvider] = useState(first);
  const [model, setModel] = useState(kind === 'agent' && first === target.provider ? target.model || '' : '');
  const models = integrations?.[provider]?.models || [];
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const key = kind === 'skill' ? { kind, name: target.name } : { kind, id: target.id };
  const start = async () => {
    setBusy(true);
    try {
      const r = await call('refineStart', { ...key, provider, model, goal });
      setGoal('');
      onOpenRefine(r.state, r.result.chatId);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="refine-panel" aria-label="Refinar">
      <h3>
        <Sparkles size={14} />
        REFINAR
      </h3>
      {target.proposal ? (
        <ProposalView kind={kind} target={target} call={call} setData={setData} notify={notify} />
      ) : (
        <p className="refine-intro">
          Uma IA lê {kind === 'skill' ? 'o texto, os usos recentes' : 'a tarefa, as execuções, as lições'} e a memória,
          conversa com você e propõe uma versão nova. Nada muda sem o seu sim.
        </p>
      )}
      {!chat && (
        <div className="consolidation-ais refine-ais" role="radiogroup" aria-label="IA que refina">
          {ORDER.map((id) => {
            const installed = !!integrations?.[id]?.installed;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={provider === id}
                data-ai={id}
                disabled={!installed}
                title={installed ? undefined : 'Não instalada (tela Conexões)'}
                onClick={() => {
                  setProvider(id);
                  setModel('');
                }}
              >
                <ProviderIcon id={id} small />
                <span>{PROVIDERS[id].name}</span>
              </button>
            );
          })}
        </div>
      )}
      {!chat && models.length > 0 && (
        <select
          className="refine-model"
          aria-label="Modelo do refino"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">Modelo padrão da IA</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {modelLabel(m)}
            </option>
          ))}
        </select>
      )}
      <div className="refine-start">
        <input
          className="refine-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && start()}
          placeholder={chat ? 'Diga mais (opcional)' : 'O que melhorar? (opcional)'}
          aria-label="O que melhorar"
          maxLength={2000}
        />
        <button className="secondary-button" disabled={busy} onClick={start}>
          {chat ? <MessageSquare size={14} /> : <Sparkles size={14} />}
          {chat ? 'Continuar o refino' : 'Refinar com IA'}
        </button>
      </div>
      <Versions kind={kind} target={target} call={call} setData={setData} notify={notify} />
    </section>
  );
}
