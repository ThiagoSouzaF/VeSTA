import { createContext, memo, useContext, useEffect, useMemo } from 'react';
import { useMascotState } from '../hooks/useMascotState';
import { MASCOT, preloadMascot } from '../lib/mascotImages';
import { STATES, STATE_LABEL } from '../lib/mascot';

const OFF = { enabled: false, state: 'idle', phrase: '', count: 0, title: '' };
const MascotContext = createContext(OFF);
export const useMascot = () => useContext(MascotContext);

// One provider for the whole app. Switched off by the "Mostrar a mascote" preference.
export function MascotProvider({ data, groups, children }) {
  const enabled = data.settings.mascot !== false;
  const s = useMascotState(data, groups);
  useEffect(() => {
    if (enabled) preloadMascot();
  }, [enabled]);
  const value = useMemo(() => (enabled ? { enabled, ...s } : OFF), [enabled, s]);
  return <MascotContext.Provider value={value}>{children}</MascotContext.Provider>;
}

// Every panel stays mounted (already decoded); the current one fades in over the previous: no flicker on change.
const Stack = memo(function Stack({ state }) {
  return STATES.map((id) => (
    <img
      key={id}
      className={id === state ? 'cur' : ''}
      src={MASCOT[id]}
      alt=""
      draggable="false"
      decoding="async"
      width="360"
      height="406"
    />
  ));
});

// Round avatar of the sidebar: the top of the current panel (the face). Click opens the Activity screen.
export const MascotAvatar = memo(function MascotAvatar({ onOpen }) {
  const { enabled, state, phrase } = useMascot();
  if (!enabled) return null;
  return (
    <button
      className="mascot-avatar"
      data-state={state}
      data-testid="mascot-avatar"
      onClick={onOpen}
      title={STATE_LABEL[state] + ' — ' + phrase}
      aria-label={'Vesta: ' + STATE_LABEL[state] + '. ' + phrase + ' Abrir Atividade'}
    >
      <span className="mascot-face">
        <Stack state={state} />
      </span>
    </button>
  );
});

// Manga panel + speech bubble. Without `state`/`text` it mirrors the live state (header of Atividade).
// `calm` forces idle/sleeping for empty screens: the panel of the current state when it is one of them, else idle.
export const MascotPanel = memo(function MascotPanel({ text, calm = false, live = false, className = '' }) {
  const m = useMascot();
  if (!m.enabled) return null;
  const state = calm && m.state !== 'sleeping' ? 'idle' : m.state;
  return (
    <div className={'mascot-scene ' + className} data-state={state} data-testid="mascot-panel">
      <figure className="manga-panel">
        <div className="manga-art">
          <Stack state={state} />
        </div>
        {state === 'sleeping' && (
          <span className="manga-zzz" aria-hidden="true">
            z<i>z</i>
            <b>z</b>
          </span>
        )}
      </figure>
      <p className="manga-bubble" role={live ? 'status' : undefined}>
        {text || m.phrase}
      </p>
    </div>
  );
});
