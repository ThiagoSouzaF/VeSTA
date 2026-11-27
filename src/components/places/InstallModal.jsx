// "Instalar agents aqui": a big window with every agent as a square, like the Agents screen. Several can be chosen at
// once; the side shows what goes along, what is checked first and what VeSTA will do. Installing calls the main
// process once and marks each step with its result.
import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { PROVIDERS } from '../../lib/constants';
import { MODES } from '../../lib/modes';
import { ProviderIcon } from '../ProviderIcon';
import { describeSchedule } from '../../lib/agents';
import { INSTALL_TABS, installStatus, installTiles } from '../../lib/places';

export function InstallModal({ place, agents, call, onDone, onClose }) {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState([]);
  const [focus, setFocus] = useState(null);
  const [steps, setSteps] = useState(null);
  const [result, setResult] = useState(null);
  const tiles = installTiles(agents, place, { tab, query });
  const counts = useMemo(() => {
    const all = agents.map((a) => installStatus(a, place).kind);
    return {
      all: all.length,
      ready: 0,
      need: 0,
      here: 0,
      ...Object.fromEntries(['ready', 'need', 'here'].map((k) => [k, all.filter((x) => x === k).length])),
    };
  }, [agents, place]);
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && !steps && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [steps, onClose]);
  const shownAgent = agents.find((a) => a.id === focus);
  const toggle = (a, kind) => {
    setFocus(a.id);
    if (kind !== 'ready' || steps) return;
    setPicked((p) => (p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id]));
  };
  const install = async () => {
    const names = picked.map((id) => agents.find((a) => a.id === id)?.name);
    setSteps(names.map((name) => ({ name, status: 'doing' })));
    try {
      const r = await call('placeInstall', { agentIds: picked });
      const results = r.results || [];
      const ok = results.filter((x) => !x.error).length;
      setResult({ r, ok });
      setSteps(
        names.map((name, i) => ({
          name,
          status: results[i]?.error ? 'err' : 'ok',
          detail: results[i]?.error || results[i]?.task || 'sem tarefa: roda quando você pedir',
        }))
      );
      // Everything went in: the window closes by itself after showing the ticks.
      if (ok === results.length) setTimeout(() => onDone(r, ok), 900);
    } catch (e) {
      setResult({ r: null, ok: 0 });
      setSteps(names.map((name) => ({ name, status: 'err', detail: e.message })));
    }
  };

  return (
    <div
      className="modal-backdrop place-install-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !steps && onClose()}
    >
      <div className="place-install" role="dialog" aria-modal="true" aria-label={'Instalar agents em ' + place.name}>
        <header className="pi-head">
          <div>
            <h3>Instalar agents em {place.name}</h3>
            <p>
              {place.kind} · pasta <code>{place.home}</code> · cada um leva o pedido, a agenda, as lições aprovadas e as
              skills dele.
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Fechar"
            onClick={() => (result ? onDone(result.r, result.ok) : onClose())}
            disabled={!!steps && !result}
          >
            <X size={16} />
          </button>
        </header>
        <div className="pi-bar">
          <div className="pi-tabs" role="tablist">
            {INSTALL_TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                {label} {counts[id]}
              </button>
            ))}
          </div>
          <label className="skills-search">
            <Search size={15} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar pelo nome ou pelo pedido"
              aria-label="Buscar agent para instalar"
            />
          </label>
        </div>
        <div className="pi-main">
          <div className="pi-tiles">
            {tiles.map(({ agent: a, status }) => {
              const sel = picked.includes(a.id);
              return (
                <button
                  key={a.id}
                  className={
                    'pi-tile' +
                    (status.kind !== 'ready' ? ' dis' : '') +
                    (sel ? ' sel' : '') +
                    (focus === a.id ? ' focus' : '')
                  }
                  data-tile={a.name}
                  aria-pressed={sel}
                  aria-disabled={status.kind !== 'ready' || undefined}
                  onClick={() => toggle(a, status.kind)}
                  onMouseEnter={() => setFocus(a.id)}
                >
                  <span className="pi-check">{sel ? '✓' : ''}</span>
                  <b>{a.name}</b>
                  <span className="pi-sched">
                    <ProviderIcon id={a.provider} small />
                    {describeSchedule(a.schedule)} · {MODES[a.mode]?.label}
                  </span>
                  <span className="pi-prompt">{a.prompt}</span>
                  <span className="pi-foot">
                    {(a.skillNames || []).length
                      ? a.skillNames.length + ' skill' + (a.skillNames.length > 1 ? 's' : '')
                      : 'sem skills próprias'}
                  </span>
                  {status.kind === 'need' && <span className="pi-need">✕ {status.text}</span>}
                  {status.kind === 'here' && <span className="pi-here">✓ já está neste lugar</span>}
                  {status.kind === 'ready' && status.warn.length > 0 && (
                    <span className="pi-need soft">! {status.warn.join(' · ')}</span>
                  )}
                </button>
              );
            })}
            {!tiles.length && <p className="pi-none">Nenhum agent com esse filtro.</p>}
          </div>
          <aside className="pi-side">
            {steps ? (
              <>
                <div className="pi-label">INSTALANDO EM {place.name.toUpperCase()}</div>
                <ol className="pi-steps">
                  {steps.map((s) => (
                    <li key={s.name} className={s.status}>
                      <span>{s.status === 'ok' ? '✓' : s.status === 'err' ? '✕' : '›'}</span>
                      <div>
                        {s.name}
                        {s.detail && <code>{s.detail}</code>}
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            ) : shownAgent ? (
              <Detail agent={shownAgent} place={place} />
            ) : (
              <p className="pi-hint">
                Passe o mouse ou clique num quadrado para ver o que vai junto e o que o VeSTA vai fazer.
              </p>
            )}
          </aside>
        </div>
        <footer className="pi-foot-bar">
          <div className="pi-picked">
            {picked.length ? (
              <>
                <b>
                  {picked.length} escolhido{picked.length > 1 ? 's' : ''}:
                </b>
                {picked.map((id) => (
                  <span key={id}>{agents.find((a) => a.id === id)?.name}</span>
                ))}
              </>
            ) : (
              'Clique nos quadrados para escolher (dá para escolher vários).'
            )}
          </div>
          {result ? (
            <button className="primary-button" onClick={() => onDone(result.r, result.ok)}>
              Fechar
            </button>
          ) : (
            <>
              <button className="secondary-button" onClick={onClose} disabled={!!steps}>
                Cancelar
              </button>
              <button className="primary-button" disabled={!picked.length || !!steps} onClick={install}>
                {picked.length > 1 ? 'Instalar ' + picked.length + ' agents' : 'Instalar'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function Detail({ agent: a, place }) {
  const s = installStatus(a, place);
  const ai = place.ais?.[a.provider];
  const checks = [
    [true, 'Executor e pasta padrão (' + (place.runner.installed ? 'já estão lá' : 'entram agora') + ')'],
    [
      !!ai?.installed,
      (PROVIDERS[a.provider]?.name || a.provider) +
        (ai?.installed
          ? ' instalado' + (ai.authenticated === false ? ', mas sem login' : '')
          : ' não está instalado aqui'),
    ],
    ...(a.memory ? [[null, 'Usa a memória do VeSTA: fora dele roda sem ela.']] : []),
    ...(a.mode === 'ask' ? [[null, '"Pedir permissão" roda como "Só consulta": ninguém aprova passos.']] : []),
  ];
  const windows = place.scheduler === 'windows';
  return (
    <>
      <div className="pi-label">{a.name.toUpperCase()}</div>
      <dl className="pi-goes">
        <dt>pedido</dt>
        <dd>{a.prompt}</dd>
        <dt>agenda</dt>
        <dd>{describeSchedule(a.schedule)}</dd>
        <dt>skills</dt>
        <dd>
          {(a.skillNames || []).length ? a.skillNames.join(', ') : <span className="muted">nenhuma própria</span>}
        </dd>
        <dt>lições</dt>
        <dd>{(a.lessons || []).filter((l) => l.status === 'kept').length} aprovada(s)</dd>
        <dt>não vai</dt>
        <dd className="muted">suas chaves, a memória, as conversas</dd>
      </dl>
      <div className="pi-label">ANTES DE INSTALAR</div>
      <ul className="pi-checks">
        {checks.map(([ok, text]) => (
          <li key={text} className={ok === false ? 'bad' : ''}>
            <span>{ok === false ? '✕' : ok === null ? '!' : '✓'}</span>
            {text}
          </li>
        ))}
      </ul>
      {s.kind !== 'here' && (
        <>
          <div className="pi-label">O QUE O VESTA VAI FAZER</div>
          <ol className="pi-steps plan">
            <li>
              <span>1</span>
              <div>
                Escrever o agent na pasta padrão<code>{place.home}</code>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                {windows && a.schedule?.kind !== 'manual'
                  ? 'Criar a tarefa no Agendador do Windows'
                  : 'Sem tarefa agendada: roda quando você pedir'}
                {windows && a.schedule?.kind !== 'manual' && <code>\VeSTA\vesta-agent-…</code>}
              </div>
            </li>
            <li>
              <span>3</span>
              <div>Parar de rodá-lo pelo relógio do VeSTA (agora quem roda é este lugar)</div>
            </li>
          </ol>
        </>
      )}
    </>
  );
}
