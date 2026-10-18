import { useEffect, useMemo, useReducer } from 'react';
import { scan, resolve, nextChangeAt } from '../lib/mascot';

const APP_START = Date.now();
// The mascot state of the whole app (desktop provider and phone header). The facts are memoized on the identity of
// chats/running/quests; the result only changes identity when state, phrase or count change, so consumers do not
// re-render on every text delta. A timer wakes the hook only at the next moment time alone changes the answer.
export function useMascotState({ chats, running, quests }, groups, { online = true } = {}) {
  const facts = useMemo(() => scan({ chats, running, quests }, groups), [chats, running, quests, groups]);
  const [tick, bump] = useReducer((n) => n + 1, 0);
  const opts = { online, awakeSince: APP_START };
  const now = Date.now();
  const out = resolve(facts, now, opts);
  const at = nextChangeAt(facts, now, opts);
  useEffect(() => {
    if (!Number.isFinite(at)) return;
    const t = setTimeout(bump, Math.min(60_000, Math.max(250, at - Date.now() + 30)));
    return () => clearTimeout(t);
  }, [at, tick, out.state]);
  return useMemo(() => out, [out.state, out.phrase, out.count, out.title]);
}
