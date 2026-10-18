import { useState } from 'react';
import { Link2, LoaderCircle } from 'lucide-react';
import { Mascot } from '../components/ui';
import { pair } from '../lib/client';

const guessName = () => {
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Celular Android';
  return 'Meu aparelho';
};
// First access: the QR code opens this page with the one-time code already filled in.
export function PairScreen({ initialCode, onPaired, notice = '' }) {
  const [code, setCode] = useState(initialCode),
    [name, setName] = useState(guessName()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await pair(code.trim(), name.trim() || guessName());
      onPaired(r.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="pair">
      <Mascot mood={error ? 'error' : busy ? 'thinking' : 'idle'} size={120} />
      <h1>VeSTA</h1>
      <p>Controle o VeSTA do seu computador por aqui.</p>
      <form onSubmit={submit}>
        <label>
          Nome deste aparelho
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" />
        </label>
        <label>
          Código de pareamento
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Escaneie o QR code do desktop"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck="false"
            aria-label="Código de pareamento"
          />
        </label>
        {notice && !error && <p className="notice">{notice}</p>}
        {error && <p className="form-error">{error}</p>}
        {busy && <p className="notice">Aguardando você autorizar este aparelho no desktop (até 2 minutos)…</p>}
        <button className="btn primary big" disabled={busy || code.trim().length < 16}>
          {busy ? <LoaderCircle size={18} className="spin" /> : <Link2 size={18} />} Parear
        </button>
      </form>
      <small>
        No desktop: Preferências, Controle remoto, Parear novo aparelho. O código vale por 5 minutos e só funciona uma
        vez; o desktop pede a sua confirmação.
      </small>
    </main>
  );
}
