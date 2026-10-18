const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { parser } = require('../electron/providers.cjs');
const usage = require('../electron/usage.cjs');
const { Store } = require('../electron/store.cjs');
const { readCodexRateLimits } = require('../electron/rate-limits.cjs');
const run = (provider, events) => {
  const out = [];
  const p = parser(provider, (e) => out.push(e));
  for (const e of events) p.accept(e);
  return out;
};
const resetMs = 1800000000000;

test('migrates the old global rateLimit into the claude provider', () => {
  const old = {
    rateLimit: {
      fiveHour: { utilization: 0.3, resetsAt: resetMs },
      sevenDay: { utilization: 0.6, resetsAt: resetMs + 1 },
      updatedAt: 42,
    },
    daily: { '2026-10-15': { claude: { inputTokens: 1, outputTokens: 1, cacheTokens: 0, costUsd: 0, turns: 1 } } },
  };
  const m = usage.migrate(old);
  assert.deepEqual(Object.keys(m.rateLimit), ['claude']);
  assert.equal(m.rateLimit.claude.updatedAt, 42);
  assert.deepEqual(
    m.rateLimit.claude.windows.map((w) => [w.id, w.label, w.utilization, w.resetsAt, w.durationMins]),
    [
      ['five_hour', 'Janela de 5 horas', 0.3, resetMs, 300],
      ['seven_day', 'Janela semanal', 0.6, resetMs + 1, 10080],
    ]
  );
  assert.equal(m.daily['2026-10-15'].claude.turns, 1);
  // Idempotent, and an old empty shape becomes an empty map.
  assert.deepEqual(usage.migrate(m).rateLimit, m.rateLimit);
  assert.deepEqual(usage.migrate({ rateLimit: { fiveHour: null, sevenDay: null, updatedAt: null } }).rateLimit, {});
  assert.deepEqual(usage.migrate({}).rateLimit, {});
});

test('a store file with the old rateLimit loads migrated and gets the default fontScale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-usage-old-'));
  fs.writeFileSync(
    path.join(dir, 'vesta.json'),
    JSON.stringify({
      version: 2,
      chats: [],
      usage: {
        rateLimit: { fiveHour: { utilization: 0.2, resetsAt: resetMs }, sevenDay: null, updatedAt: 7 },
        daily: {},
      },
    })
  );
  const s = new Store(dir);
  assert.equal(s.state.usage.rateLimit.claude.windows[0].utilization, 0.2);
  assert.equal(s.state.settings.fontScale, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('codex RateLimitSnapshot is normalized (percent, seconds, window label, plan, credits)', () => {
  const r = usage.codexRateLimits({
    rateLimits: {
      limitId: 'codex',
      limitName: null,
      planType: 'plus',
      credits: { hasCredits: true, unlimited: false, balance: '12' },
      primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 },
      secondary: { usedPercent: 140, windowDurationMins: 10080, resetsAt: null },
    },
    rateLimitsByLimitId: {
      codex: { limitId: 'codex' },
      codex_spark: {
        limitName: 'GPT-5 Spark',
        primary: { usedPercent: 5, windowDurationMins: 90, resetsAt: 1800000100 },
        secondary: null,
      },
    },
  });
  assert.equal(r.planType, 'plus');
  assert.equal(r.credits.balance, '12');
  assert.deepEqual(r.windows[0], {
    id: 'primary',
    label: 'Janela de 5 horas',
    utilization: 0.25,
    resetsAt: 1800000000000,
    durationMins: 300,
  });
  assert.deepEqual([r.windows[1].id, r.windows[1].utilization, r.windows[1].resetsAt], ['secondary', 1, null]);
  assert.deepEqual(
    [r.windows[2].id, r.windows[2].label, r.windows[2].utilization],
    ['codex_spark:primary', 'GPT-5 Spark · Janela de 90 min', 0.05]
  );
  assert.equal(r.windows.length, 3);
  assert.deepEqual(usage.codexRateLimits(null).windows, []);
  assert.deepEqual(usage.codexRateLimits({ rateLimits: { primary: null, secondary: null } }).windows, []);
  assert.equal(usage.windowLabel(1440), 'Janela de 1 dia');
  assert.equal(usage.windowLabel(60), 'Janela de 1 hora');
});

test('rate limits are kept per provider; partial updates merge by id, a full read replaces', () => {
  const u = usage.emptyUsage();
  const full = (extra = {}) => ({
    type: 'usage',
    provider: 'codex',
    windows: [
      { id: 'primary', label: 'Janela de 5 horas', utilization: 0.1, resetsAt: 1, durationMins: 300 },
      { id: 'secondary', label: 'Janela semanal', utilization: 0.2, resetsAt: 2, durationMins: 10080 },
    ],
    planType: 'pro',
    ...extra,
  });
  assert.equal(usage.recordRateLimit(u, full({ replace: true }), 10), true);
  usage.recordRateLimit(u, { provider: 'claude', fiveHour: { utilization: 0.9, resetsAt: 3 } }, 11);
  usage.recordRateLimit(
    u,
    { provider: 'codex', windows: [{ id: 'primary', label: 'Janela de 5 horas', utilization: 0.4, resetsAt: 5 }] },
    12
  );
  assert.deepEqual(Object.keys(u.rateLimit).sort(), ['claude', 'codex']);
  assert.equal(u.rateLimit.codex.windows.length, 2);
  assert.equal(u.rateLimit.codex.windows[0].utilization, 0.4);
  assert.equal(u.rateLimit.codex.windows[0].durationMins, 300, 'fields not in the update survive');
  assert.equal(u.rateLimit.codex.windows[1].utilization, 0.2);
  assert.equal(u.rateLimit.codex.planType, 'pro');
  assert.equal(u.rateLimit.codex.updatedAt, 12);
  assert.equal(u.rateLimit.claude.windows.length, 1);
  usage.recordRateLimit(u, full({ replace: true, windows: [full().windows[0]] }), 13);
  assert.equal(u.rateLimit.codex.windows.length, 1);
  assert.equal(usage.recordRateLimit(u, { provider: 'codex', windows: [] }, 14), false);
  assert.equal(u.rateLimit.codex.updatedAt, 13);
});

test('summary gives per-provider totals for today and the last 7 calendar days, and where cost exists', () => {
  const u = usage.emptyUsage(),
    now = new Date(2026, 9, 15, 12).getTime(),
    day = (n) => now - n * 86400000;
  usage.recordCost(u, { provider: 'claude', inputTokens: 10, outputTokens: 5, cacheTokens: 1, costUsd: 0.5 }, now);
  usage.recordCost(u, { provider: 'claude', inputTokens: 20, outputTokens: 0, cacheTokens: 0, costUsd: 1 }, day(3));
  usage.recordCost(u, { provider: 'claude', inputTokens: 999, outputTokens: 0, cacheTokens: 0, costUsd: 9 }, day(8));
  usage.recordCost(u, { provider: 'codex', inputTokens: 7, outputTokens: 3, cacheTokens: 0, costUsd: 0 }, now);
  usage.recordRateLimit(u, { provider: 'opencode', windows: [{ id: 'x', utilization: 0.1 }] }, now);
  const s = usage.summary(u, now);
  assert.equal(s.byProvider.claude.today.inputTokens, 10);
  assert.equal(s.byProvider.claude.week.inputTokens, 30);
  assert.equal(s.byProvider.claude.week.costUsd, 1.5);
  assert.equal(s.byProvider.claude.hasCost, true);
  assert.equal(s.byProvider.codex.hasCost, false);
  assert.equal(s.byProvider.codex.week.outputTokens, 3);
  assert.equal(s.byProvider.opencode.week.turns, 0);
  assert.equal(s.today.codex.turns, 1);
});

test('codex notifications and the read response become provider usage events', () => {
  const out = run('codex', [
    {
      method: 'account/rateLimits/updated',
      params: {
        rateLimits: { planType: 'plus', primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: 1800000000 } },
      },
    },
    {
      method: 'account/rateLimits/read',
      params: {
        rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1800000000 } },
        rateLimitsByLimitId: null,
      },
    },
    { method: 'account/rateLimits/updated', params: { rateLimits: { primary: null, secondary: null } } },
  ]);
  const ev = out.filter((e) => e.type === 'usage');
  assert.equal(ev.length, 2, 'an update with no windows emits nothing');
  assert.deepEqual(
    [ev[0].provider, ev[0].replace, ev[0].planType, ev[0].windows[0].utilization],
    ['codex', false, 'plus', 0.5]
  );
  assert.deepEqual([ev[1].replace, ev[1].windows[0].utilization], [true, 0.1]);
  const u = usage.emptyUsage();
  for (const e of ev) usage.recordRateLimit(u, e, 1);
  assert.equal(u.rateLimit.codex.windows[0].utilization, 0.1);
});

// A stand-in for `codex app-server`: answers initialize and account/rateLimits/read over JSON lines.
function fakeServer(dir, body) {
  const file = path.join(dir, 'fake-codex.js');
  fs.writeFileSync(
    file,
    "const rl=require('readline').createInterface({input:process.stdin});\n" +
      "rl.on('line',(l)=>{const m=JSON.parse(l);" +
      body +
      '});\n'
  );
  return file;
}
test('readCodexRateLimits asks the app-server, normalizes the answer and ends the process', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-rl-'));
  try {
    const log = path.join(dir, 'log.txt');
    const script = fakeServer(
      dir,
      "require('fs').appendFileSync(" +
        JSON.stringify(log) +
        ",(m.method||'')+';');" +
        "if(m.method==='initialize')console.log(JSON.stringify({id:m.id,result:{}}));" +
        "if(m.method==='account/rateLimits/read')console.log(JSON.stringify({id:m.id,result:{rateLimits:{planType:'plus',primary:{usedPercent:30,windowDurationMins:300,resetsAt:1800000000}},rateLimitsByLimitId:null}}));"
    );
    const r = await readCodexRateLimits(process.execPath, { args: [script], timeoutMs: 10000 });
    assert.equal(r.planType, 'plus');
    assert.equal(r.windows[0].utilization, 0.3);
    assert.equal(fs.readFileSync(log, 'utf8'), 'initialize;initialized;account/rateLimits/read;');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('readCodexRateLimits rejects on a JSON-RPC error and on timeout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-rl-'));
  try {
    const bad = fakeServer(
      dir,
      "if(m.method==='initialize')console.log(JSON.stringify({id:m.id,result:{}}));" +
        "if(m.method==='account/rateLimits/read')console.log(JSON.stringify({id:m.id,error:{message:'sem login'}}));"
    );
    await assert.rejects(readCodexRateLimits(process.execPath, { args: [bad], timeoutMs: 10000 }), /sem login/);
    const silent = fakeServer(dir, '');
    const t = Date.now();
    await assert.rejects(readCodexRateLimits(process.execPath, { args: [silent], timeoutMs: 400 }), /demorou/);
    assert.ok(Date.now() - t < 5000);
    await assert.rejects(readCodexRateLimits(null), /não encontrado/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
