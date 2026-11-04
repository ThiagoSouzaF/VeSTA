// vesta-app: the MCP server that lets a conversation see and change VeSTA's preferences. Real MCP client over HTTP,
// real Store and saveSettings; backups and Drive are stubs. Who gets it, what "Só consulta" sees, validation, notices.
const { test, after } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { Store } = require('../electron/app/store.cjs');
const { createMethods } = require('../electron/app/methods.cjs');
const { backupMethods } = require('../electron/backup/methods.cjs');
const { createAppMcp, appHint, READ_ONLY, TOOLS } = require('../electron/mcp/app.cjs');
const providers = require('../electron/ai/providers.cjs');

const hosts = [];
after(async () => {
  for (const h of hosts) await h.close();
});
function setup() {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-appmcp-')));
  const events = [],
    backupCalls = [];
  const ctx = {
    store,
    jobs: new Map(),
    sync: () => {},
    state: () => store.state,
    emit: (e) => events.push(e),
    app: { getPath: () => store.dir, getVersion: () => '0.0.0' },
  };
  let backupState = { auto: 'daily', keep: 10, drive: true };
  ctx.backups = {
    status: () => ({ ...backupState, folder: 'C:\\b', backups: [], cloud: { configured: true, connected: false } }),
    run: async (reason) => {
      backupCalls.push(reason);
      return { file: 'C:\\b\\VeSTA-backup-x.zip', size: 10, counts: { chats: 1, wikiPages: 2 }, drive: null };
    },
  };
  const methods = {
    ...createMethods({ ...ctx, permissions: {}, bounded: (v) => v, project: () => null }),
    backupSettings: (input) => {
      backupState = { ...backupState, ...input };
      return ctx.backups.status();
    },
  };
  const questCalls = [];
  ctx.integrations = { claude: { installed: true }, codex: { installed: false } };
  store.state.projects = [{ id: 'p1', name: 'site', path: 'C:/site' }];
  const record = (name, status) => (args) => {
    questCalls.push([name, args]);
    const q = store.state.quests.find((x) => x.id === args.id);
    if (q && status) q.status = status;
    return q;
  };
  ctx.quests = {
    createQuest: (input) => {
      questCalls.push(['createQuest', input]);
      const q = {
        id: 'q' + questCalls.length,
        title: input.title,
        status: 'draft',
        steps: input.steps || [],
        projectId: input.projectId,
        planning: input.plan ? { status: 'running' } : null,
        autoStart: input.autoStart || undefined,
      };
      store.state.quests.unshift(q);
      return q;
    },
    startQuest: record('startQuest', 'running'),
    resumeQuest: record('resumeQuest', 'running'),
    pauseQuest: record('pauseQuest', 'paused'),
    questState: ({ id }) => ({ id, etapas: [] }),
  };
  const host = createAppMcp(ctx, { methods });
  hosts.push(host);
  // addChat only takes what the new-chat modal sends; quest links and titles are set afterwards, as the app does.
  const chat = (over = {}) => Object.assign(store.addChat({ provider: 'claude', ...over }), over);
  return { store, ctx, host, events, backupCalls, questCalls, chat, backup: () => backupState };
}
async function connect(host, chat, token) {
  const ep = await host.endpointFor(chat);
  const client = new Client({ name: 't', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(ep.mcp), {
      requestInit: { headers: { Authorization: 'Bearer ' + (token ?? ep.token) } },
    })
  );
  return {
    ep,
    tools: async () => (await client.listTools()).tools.map((t) => t.name).sort(),
    async call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args });
      const text = r.content[0].text;
      return { error: !!r.isError, text, json: r.isError ? null : JSON.parse(text) };
    },
  };
}

test('a normal chat reads and changes preferences through the same validation as the screen', async () => {
  const s = setup();
  const c = s.chat({ title: 'Ajustes' });
  const m = await connect(s.host, c);
  assert.equal((await m.tools()).length, TOOLS.length);
  const before = (await m.call('vesta_settings_get')).json;
  assert.equal(before.aparencia.theme, 'ink');
  assert.ok(before.valoresAceitos.theme.includes('paper'));
  assert.equal(before.controleRemoto.ligado, false);
  assert.doesNotMatch(JSON.stringify(before), /token|secret|devices/i);
  const r = await m.call('vesta_settings_update', {
    theme: 'paper',
    fontScale: 1.23,
    mascot: false,
    backupAuto: 'weekly',
  });
  assert.equal(r.error, false, r.text);
  assert.equal(s.store.state.settings.theme, 'paper');
  assert.equal(s.store.state.settings.fontScale, 1.2, 'clamped/rounded like the zoom buttons');
  assert.equal(s.store.state.settings.mascot, false);
  assert.equal(s.backup().auto, 'weekly');
  assert.deepEqual(Object.keys(r.json.alterado).sort(), ['backupAuto', 'fontScale', 'mascot', 'theme']);
  assert.match(s.events.at(-1).message, /“Ajustes” mudou: .*theme → "paper"/);
  assert.equal(s.events.at(-1).type, 'notice');
});

test('invalid values, unknown keys and things only the person may do are refused', async () => {
  const s = setup();
  const m = await connect(s.host, s.chat());
  assert.match((await m.call('vesta_settings_update', { theme: 'neon' })).text, /valor não aceito/);
  assert.match((await m.call('vesta_settings_update', { mascot: 'sim' })).text, /true\/false/);
  // Undeclared keys never get through (not even to the screen's own method).
  const r = await m.call('vesta_settings_update', { chatSettings: false, remote: { enabled: true }, theme: 'aurora' });
  assert.equal(r.error, false);
  assert.equal(s.store.state.settings.chatSettings, true);
  assert.equal(s.store.state.remote.enabled, false);
  assert.match((await m.call('vesta_settings_update', {})).text, /Nada para mudar/);
  assert.match((await m.call('vesta_restore', {})).text, /indisponível/);
});

test('backup now, list and open Preferências at a section', async () => {
  const s = setup();
  const m = await connect(s.host, s.chat({ title: 'Backup' }));
  const b = await m.call('vesta_backup_now');
  assert.equal(b.json.arquivo, 'C:\\b\\VeSTA-backup-x.zip');
  assert.match(String(b.json.googleDrive), /não conectado/);
  assert.deepEqual(s.backupCalls, ['chat']);
  assert.equal((await m.call('vesta_backup_list')).json.googleDrive, 'não conectado');
  await m.call('vesta_open_settings', { section: 'backup' });
  assert.deepEqual(s.events.at(-1), { type: 'open-settings', section: 'backup' });
  assert.equal((await m.call('vesta_open_settings', { section: 'x' })).error, false, 'enum is advisory to the model');
});

test('"Só consulta" chats only read; quest step chats and the off switch get nothing; tokens are per chat', async () => {
  const s = setup();
  const reader = await connect(s.host, s.chat({ mode: 'read' }));
  assert.deepEqual(await reader.tools(), [...READ_ONLY].sort());
  assert.match((await reader.call('vesta_settings_update', { theme: 'paper' })).text, /indisponível/);
  assert.equal(s.store.state.settings.theme, 'ink');
  const step = s.chat({ questId: 'q1', stepId: 's1' });
  assert.equal(await s.host.endpointFor(step), null);
  const lead = s.chat({ questId: 'q1', questRole: 'lead' });
  assert.ok(await s.host.endpointFor(lead), 'the quest chat talks to the person');
  const a = await connect(s.host, s.chat());
  const other = s.chat();
  assert.notEqual((await s.host.endpointFor(other)).token, a.ep.token);
  await assert.rejects(connect(s.host, other, 'x'.repeat(48)));
  // Turned off in Preferências: new endpoints are refused and live tokens stop working.
  s.store.state.settings.chatSettings = false;
  assert.equal(await s.host.endpointFor(s.chat()), null);
  await assert.rejects(a.call('vesta_settings_get'));
});

test('the CLIs get vesta-app like the other VeSTA servers, and the prompt line follows the mode', () => {
  const ep = { mcp: 'http://127.0.0.1:1/mcp', token: 't'.repeat(48) };
  const claude = providers.mcpTools('claude', [providers.appServer(ep)]);
  assert.ok(claude.args.includes('mcp__vesta-app'));
  assert.equal(claude.env.VESTA_APP_TOKEN, ep.token);
  assert.doesNotMatch(claude.args.join(' '), /t{48}/, 'the token never goes on the command line');
  const codex = providers.mcpTools('codex', [providers.appServer(ep)]);
  assert.ok(codex.args.some((a) => a === 'mcp_servers.vesta-app.bearer_token_env_var="VESTA_APP_TOKEN"'));
  assert.match(appHint('edit'), /mudar as preferências/);
  assert.match(appHint('read'), /não altere nada/);
});

test("quests from a chat: created in the chat's project, planned by its AI or with the given steps, started on request", async () => {
  const s = setup();
  const c = s.chat({ title: 'Lançamento', projectId: 'p1' });
  const m = await connect(s.host, c);
  // No steps: the chat's AI (Claude, installed) plans; start=true -> starts by itself once planned.
  const planned = await m.call('vesta_quest_create', { title: 'Site novo', goal: 'Publicar o site', start: true });
  assert.equal(planned.error, false, planned.text);
  const [, input] = s.questCalls[0];
  assert.equal(input.projectId, 'p1');
  assert.deepEqual(input.plan, { provider: 'claude', model: '' });
  assert.equal(input.autoStart, true);
  assert.match(planned.json.proximo, /Planejando com claude; inicia sozinha/);
  assert.match(s.events.at(-1).message, /“Lançamento” criou a quest "Site novo" e pediu para iniciar/);
  // With steps and start: created with them and started right away; the person's screen is not taken over.
  const steps = [{ id: 's1', title: 'Texto', instructions: 'escreva', provider: 'claude' }];
  await m.call('vesta_quest_create', { title: 'Com plano', goal: 'g', steps, start: true });
  assert.deepEqual(
    s.questCalls.slice(1).map(([n]) => n),
    ['createQuest', 'startQuest']
  );
  assert.equal(s.questCalls[1][1].plan, undefined);
  assert.ok(!s.events.some((e) => e.type === 'open-quest'), 'creating does not navigate away from the chat');
  // A planner that is not installed falls back to an installed one.
  await m.call('vesta_quest_create', { title: 'X', goal: 'g', planner: 'codex' });
  assert.equal(s.questCalls.at(-1)[1].plan.provider, 'claude');
  // List (this project first), get, pause, start (resumes a paused one) and open.
  s.store.state.quests.push({ id: 'outra', title: 'Outra', status: 'draft', steps: [], projectId: null });
  const list = (await m.call('vesta_quest_list')).json.quests;
  assert.equal(list.at(-1).id, 'outra');
  assert.equal(list[0].projeto, 'site');
  const id = list[0].id;
  assert.deepEqual((await m.call('vesta_quest_get', { id })).json, { id, etapas: [] });
  await m.call('vesta_quest_pause', { id });
  await m.call('vesta_quest_start', { id });
  assert.deepEqual(
    s.questCalls.slice(-2).map(([n]) => n),
    ['pauseQuest', 'resumeQuest']
  );
  await m.call('vesta_quest_open', { id });
  assert.deepEqual(s.events.at(-1), { type: 'open-quest', questId: id });
  assert.match((await m.call('vesta_quest_open', { id: 'nao-existe' })).text, /não encontrada/);
});

test('quests from a chat: "Só consulta" lists, reads and opens, but cannot create, start or pause', async () => {
  const s = setup();
  const m = await connect(s.host, s.chat({ mode: 'read' }));
  const tools = await m.tools();
  for (const t of ['vesta_quest_list', 'vesta_quest_get', 'vesta_quest_open']) assert.ok(tools.includes(t), t);
  for (const t of ['vesta_quest_create', 'vesta_quest_start', 'vesta_quest_pause']) {
    assert.ok(!tools.includes(t), t);
    assert.match((await m.call(t, { id: 'x', title: 't', goal: 'g' })).text, /indisponível/);
  }
  assert.equal(s.questCalls.length, 0);
});
