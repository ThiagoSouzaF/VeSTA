// Conectar uma VPS: name, address and port, then the steps (shared/places.cjs connectPlan) with the command each one
// stands for. Before: the plan. After: what happened in each, and why it stopped if it did.
import { useState } from 'react';
import shared from '../../../electron/shared/places.cjs';

const { connectPlan } = shared;
const MARK = { ok: '✓', warn: '!', error: '✕' };

export function ConnectForm({ act, busy, setBusy, onClose, onConnected }) {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [result, setResult] = useState(null);
  const plan = connectPlan({ host, port });
  const run = async () => {
    setBusy(true);
    setResult(null);
    const r = await act('placeConnect', { name, host, port: Number(port) || 22 });
    setBusy(false);
    if (!r) return;
    setResult(r);
  };
  const steps = result
    ? plan.map(([label, cmd], i) => {
        const s = result.steps.find((x) => x.label === label);
        return { label, cmd: s?.cmd || cmd, status: s?.status || 'skip', detail: s?.detail || '' };
      })
    : plan.map(([label, cmd]) => ({ label, cmd, status: busy ? 'doing' : 'plan' }));

  return (
    <>
      <div className="pc-form">
        <label className="pc-field">
          <span>NOME</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="vps-hetzner"
            maxLength={40}
            disabled={busy}
          />
        </label>
        <div className="pc-row">
          <label className="pc-field">
            <span>USUÁRIO@SERVIDOR</span>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value.trim())}
              placeholder="thiago@203.0.113.10"
              spellCheck={false}
              disabled={busy}
              autoFocus
            />
          </label>
          <label className="pc-field port">
            <span>PORTA</span>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
              inputMode="numeric"
              disabled={busy}
            />
          </label>
        </div>
        <p className="pd-note">
          Use o que funciona no seu terminal com <code>ssh</code>, também um nome do <code>~/.ssh/config</code>. A chave
          precisa entrar sem senha (ssh-agent); o VeSTA nunca pergunta nem guarda senha.
        </p>
      </div>
      <ol className="pi-steps pc-steps">
        {steps.map((s, i) => (
          <li key={s.label} className={s.status} data-step={s.label}>
            <span>{MARK[s.status] || (s.status === 'doing' && i === 0 ? '›' : i + 1)}</span>
            <div>
              {s.label}
              <code>{s.cmd}</code>
              {s.detail && <small>{s.detail}</small>}
            </div>
          </li>
        ))}
      </ol>
      <p className="pd-note">
        Na VPS fica uma pasta <code>~/.vesta-agents</code> com o executor; cada agent instalado leva o pedido, as lições
        aprovadas e as skills dele. Precisa do Node 18 ou mais lá, e de cada IA instalada e com login.
      </p>
      <div className="pd-foot">
        <button className="secondary-button" onClick={onClose} disabled={busy}>
          {result?.ok ? 'Fechar' : 'Cancelar'}
        </button>
        {result?.ok ? (
          <button className="primary-button" onClick={() => onConnected(result.placeId)}>
            Ver o lugar
          </button>
        ) : (
          <button className="primary-button" onClick={run} disabled={busy || !host}>
            {busy ? 'Testando…' : result ? 'Tentar de novo' : 'Testar e conectar'}
          </button>
        )}
      </div>
    </>
  );
}
