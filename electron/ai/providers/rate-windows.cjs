// Normalizes the rate-limit windows each provider reports into { fiveHour, sevenDay }.
// Normalizes a rate-limit window: utilization 0..1, resetsAt in epoch milliseconds (accepts seconds, ms or ISO).
function normWindow(w) {
  if (!w || typeof w !== 'object') return null;
  const rawU = w.utilization ?? w.used_percentage ?? w.usedPercentage ?? w.usedPercent ?? w.percent;
  const rawR = w.resetsAt ?? w.resets_at ?? w.resetAt ?? w.reset_at ?? w.resetsAtMs;
  let u = rawU == null || rawU === '' ? null : Number(rawU);
  if (u != null && !Number.isFinite(u)) u = null;
  if (u != null) {
    if (u > 1) u /= 100;
    u = Math.min(1, Math.max(0, u));
  }
  let r = null;
  if (rawR != null && rawR !== '') {
    r = typeof rawR === 'string' && Number.isNaN(Number(rawR)) ? Date.parse(rawR) : Number(rawR);
    if (!Number.isFinite(r)) r = null;
    else if (r < 1e11) r = Math.round(r * 1000);
  }
  if (u == null && r == null) return null;
  return { utilization: u, resetsAt: r };
}
function rateWindows(info) {
  const out = { fiveHour: null, sevenDay: null };
  if (!info || typeof info !== 'object') return out;
  const put = (name, w) => {
    const key = /five|5/i.test(name) ? 'fiveHour' : /seven|week|7/i.test(name) ? 'sevenDay' : null;
    if (!key) return;
    const n = normWindow(w);
    if (n) out[key] = n;
  };
  const wins = info.unifiedWindows || info.unified_windows || info.windows;
  if (wins && typeof wins === 'object') for (const [k, v] of Object.entries(wins)) put(k, v);
  for (const k of ['five_hour', 'fiveHour', 'seven_day', 'sevenDay']) if (info[k]) put(k, info[k]);
  // The top-level window only fills a gap: it often carries resetsAt without utilization.
  const type = info.rateLimitType || info.rate_limit_type;
  if (type) {
    const before = { ...out };
    put(String(type), info);
    for (const k of ['fiveHour', 'sevenDay']) if (before[k]) out[k] = before[k];
  }
  return out;
}
module.exports = { normWindow, rateWindows };
