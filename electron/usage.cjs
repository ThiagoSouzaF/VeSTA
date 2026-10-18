// Usage tracking: rate-limit windows per provider + per-day, per-provider token/cost totals.
//   usage.rateLimit[provider] = {windows:[{id,label,utilization 0..1,resetsAt ms|null,durationMins|null}], updatedAt, planType?, credits?}
//   usage.daily[day][provider] = {inputTokens, outputTokens, cacheTokens, costUsd, turns}
const emptyUsage = () => ({ rateLimit: {}, daily: {} });
const dayKey = (t = Date.now()) => {
  const d = new Date(t),
    p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};
const CLAUDE_WINDOWS = {
  fiveHour: { id: 'five_hour', label: 'Janela de 5 horas', durationMins: 300 },
  sevenDay: { id: 'seven_day', label: 'Janela semanal', durationMins: 10080 },
};
// "Janela de 5 horas", "Janela semanal", "Janela de 30 dias"...
function windowLabel(mins) {
  if (!mins) return 'Janela';
  if (mins === 10080) return 'Janela semanal';
  if (mins >= 1440 && mins % 1440 === 0) return 'Janela de ' + mins / 1440 + (mins === 1440 ? ' dia' : ' dias');
  if (mins >= 60 && mins % 60 === 0) return 'Janela de ' + mins / 60 + (mins === 60 ? ' hora' : ' horas');
  return 'Janela de ' + mins + ' min';
}
const unit = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : null);
// Claude's {fiveHour, sevenDay} (as the parser emits) -> windows list.
function claudeWindows(ev) {
  const out = [];
  for (const [key, meta] of Object.entries(CLAUDE_WINDOWS))
    if (ev[key]) out.push({ ...meta, utilization: unit(ev[key].utilization), resetsAt: ev[key].resetsAt ?? null });
  return out;
}
// Codex RateLimitSnapshot {primary, secondary, limitId, limitName, planType, credits} -> {windows, planType, credits}.
// usedPercent is 0..100, resetsAt epoch seconds. Extra buckets (per-model limits) are prefixed with their name.
function codexWindows(snapshot, { main = true } = {}) {
  const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const windows = [];
  for (const slot of ['primary', 'secondary']) {
    const w = s[slot];
    if (!w || typeof w !== 'object' || w.usedPercent == null) continue;
    const mins = Number(w.windowDurationMins) > 0 ? Number(w.windowDurationMins) : null;
    const reset = Number(w.resetsAt);
    windows.push({
      id: (main ? '' : (s.limitId || s.limitName || 'extra') + ':') + slot,
      label: (main || !s.limitName ? '' : s.limitName + ' · ') + windowLabel(mins),
      utilization: unit(Number(w.usedPercent) / 100),
      resetsAt: Number.isFinite(reset) && reset > 0 ? Math.round(reset * 1000) : null,
      durationMins: mins,
    });
  }
  return {
    windows,
    planType: typeof s.planType === 'string' ? s.planType : null,
    credits: s.credits && typeof s.credits === 'object' ? s.credits : null,
  };
}
// Response of account/rateLimits/read (or the notification payload): the main bucket plus any named ones.
function codexRateLimits(result) {
  const r = result && typeof result === 'object' ? result : {};
  const main = codexWindows(r.rateLimits);
  const mainId = r.rateLimits?.limitId;
  for (const [id, snap] of Object.entries(r.rateLimitsByLimitId || {})) {
    if (id === mainId || !snap) continue;
    main.windows.push(...codexWindows({ limitId: id, ...snap }, { main: false }).windows);
  }
  return main;
}
// Accepts the old shape (fiveHour/sevenDay at the top level of usage.rateLimit) and rewrites it per provider.
function migrate(usage) {
  if (!usage.daily || typeof usage.daily !== 'object') usage.daily = {};
  const rl = usage.rateLimit && typeof usage.rateLimit === 'object' ? usage.rateLimit : {};
  if ('fiveHour' in rl || 'sevenDay' in rl || 'updatedAt' in rl) {
    const windows = claudeWindows(rl);
    const next = windows.length ? { claude: { windows, updatedAt: rl.updatedAt ?? null } } : {};
    for (const [k, v] of Object.entries(rl)) if (v?.windows && !next[k]) next[k] = v;
    usage.rateLimit = next;
  } else usage.rateLimit = rl;
  return usage;
}
// Event {provider, windows:[...]} or the Claude shape {provider, fiveHour, sevenDay}. `replace` swaps the whole
// window list (a full read) instead of updating windows by id (a partial notification).
function recordRateLimit(usage, ev, now = Date.now()) {
  migrate(usage);
  const provider = ev.provider || 'claude';
  const incoming = Array.isArray(ev.windows) ? ev.windows : claudeWindows(ev);
  if (!incoming.length && !ev.replace) return false;
  const cur = usage.rateLimit[provider] || { windows: [], updatedAt: null };
  const windows = ev.replace ? [] : [...cur.windows];
  for (const w of incoming) {
    const i = windows.findIndex((x) => x.id === w.id);
    if (i >= 0) windows[i] = { ...windows[i], ...w };
    else windows.push({ ...w });
  }
  usage.rateLimit[provider] = {
    ...cur,
    windows,
    updatedAt: now,
    ...(ev.planType ? { planType: ev.planType } : {}),
    ...(ev.credits ? { credits: ev.credits } : {}),
  };
  return true;
}
function recordCost(usage, ev, now = Date.now()) {
  migrate(usage);
  const day = usage.daily[dayKey(now)] || (usage.daily[dayKey(now)] = {});
  const p =
    day[ev.provider] || (day[ev.provider] = { inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0, turns: 0 });
  p.inputTokens += ev.inputTokens || 0;
  p.outputTokens += ev.outputTokens || 0;
  p.cacheTokens += ev.cacheTokens || 0;
  p.costUsd += ev.costUsd || 0;
  p.turns += 1;
  // keep ~120 days
  const keys = Object.keys(usage.daily).sort();
  while (keys.length > 120) delete usage.daily[keys.shift()];
  return p;
}
const zero = () => ({ inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0, turns: 0 });
// Shape returned by the `usage` IPC method:
//   {now, rateLimit, today:{[provider]:totals}, days:[{date,providers}] (newest first, last 7 with data),
//    byProvider:{[provider]:{today, week (calendar last 7 days), hasCost}}}
function summary(usage, now = Date.now()) {
  migrate(usage);
  const dates = Object.keys(usage.daily).sort().reverse();
  const week = new Set();
  for (let i = 0; i < 7; i++) week.add(dayKey(now - i * 86400000));
  const byProvider = {};
  const slot = (id) => (byProvider[id] ||= { today: zero(), week: zero(), hasCost: false });
  for (const [date, providers] of Object.entries(usage.daily)) {
    if (!week.has(date)) continue;
    for (const [id, t] of Object.entries(providers)) {
      const s = slot(id);
      for (const k of Object.keys(s.week)) s.week[k] += t[k] || 0;
      if (date === dayKey(now)) for (const k of Object.keys(s.today)) s.today[k] += t[k] || 0;
      if (t.costUsd > 0) s.hasCost = true;
    }
  }
  for (const id of Object.keys(usage.rateLimit)) slot(id);
  return {
    now,
    rateLimit: usage.rateLimit,
    today: usage.daily[dayKey(now)] || {},
    days: dates.slice(0, 7).map((date) => ({ date, providers: usage.daily[date] })),
    byProvider,
  };
}
module.exports = {
  emptyUsage,
  dayKey,
  migrate,
  windowLabel,
  claudeWindows,
  codexWindows,
  codexRateLimits,
  recordRateLimit,
  recordCost,
  summary,
};
