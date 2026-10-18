const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { Permissions, ruleFor, plainCommand } = require('../electron/permissions.cjs');
const { command, parser } = require('../electron/providers.cjs');
const { claudeDetail } = require('../electron/drivers.cjs');
function broker() {
  const updates = [],
    rules = { c1: [] };
  return {
    updates,
    rules,
    p: new Permissions({ onUpdate: (chatId, r) => updates.push({ chatId, ...r }), rules: (id) => rules[id] }),
  };
}
test('Codex PowerShell wrapper is unwrapped for display and rules', () => {
  assert.equal(
    plainCommand(
      '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command \'mkdir pasta-x\''
    ),
    'mkdir pasta-x'
  );
  assert.equal(plainCommand('npm test'), 'npm test');
  assert.deepEqual(ruleFor({ tool: 'Bash', command: 'npm run build -- --x' }), {
    key: 'cmd:npm',
    label: 'comandos "npm …"',
  });
  assert.equal(ruleFor({ tool: 'Edit' }).key, 'tool:edit');
});
test('a request waits for the answer; once does not create a rule', async () => {
  const { p, updates, rules } = broker();
  const pending = p.ask('c1', { provider: 'claude', tool: 'Bash', command: 'mkdir a', title: 'Criar' });
  assert.equal(updates.at(-1).status, 'pending');
  assert.equal(p.waiting('c1').length, 1);
  assert.ok(p.answer(updates.at(-1).id, 'once'));
  assert.deepEqual(await pending, { allow: true, always: false, message: undefined });
  assert.equal(updates.at(-1).status, 'allowed');
  assert.deepEqual(rules.c1, []);
  assert.equal(p.answer(updates.at(-1).id, 'once'), false);
});
test('always remembers the program for this chat and answers the next request by itself', async () => {
  const { p, updates, rules } = broker();
  const first = p.ask('c1', { tool: 'Bash', command: 'mkdir a' });
  p.answer(updates.at(-1).id, 'always');
  await first;
  assert.deepEqual(rules.c1, ['cmd:mkdir']);
  assert.deepEqual(await p.ask('c1', { tool: 'Bash', command: 'mkdir b' }), { allow: true, always: true });
  assert.equal(updates.at(-1).status, 'auto');
  // A different program still asks.
  p.ask('c1', { tool: 'Bash', command: 'rm -rf b' });
  assert.equal(updates.at(-1).status, 'pending');
});
test('deny and cancel resolve as not allowed, with a message for the agent', async () => {
  const { p, updates } = broker();
  const a = p.ask('c1', { tool: 'Bash', command: 'x' });
  p.answer(updates.at(-1).id, 'deny');
  const r = await a;
  assert.equal(r.allow, false);
  assert.match(r.message, /negou/);
  const b = p.ask('c1', { tool: 'Edit' });
  p.cancelChat('c1');
  assert.equal((await b).allow, false);
  assert.equal(updates.at(-1).status, 'cancelled');
  assert.equal(p.waiting('c1').length, 0);
});
test('ask mode: each CLI is launched so that it asks', () => {
  const claude = command({ provider: 'claude', mode: 'ask' }, 'claude.exe').args.join(' ');
  assert.match(claude, /--permission-mode default/);
  assert.match(claude, /--permission-prompt-tool stdio/);
  assert.match(claude, /--input-format stream-json/);
  // Full access still routes Claude's protected-file prompts to the user instead of denying them silently.
  assert.match(
    command({ provider: 'claude', mode: 'edit' }, 'claude.exe').args.join(' '),
    /bypassPermissions.*--permission-prompt-tool stdio/
  );
  assert.match(
    command({ provider: 'claude', mode: 'read' }, 'claude.exe').args.join(' '),
    /plan --permission-prompts none/
  );
  assert.deepEqual(command({ provider: 'codex', mode: 'ask' }, 'codex.exe').thread, {
    approvalPolicy: 'on-request',
    sandbox: 'read-only',
  });
  const oc = command({ provider: 'opencode', mode: 'ask', model: 'drael/drael-v1' }, 'opencode.exe');
  assert.equal(JSON.parse(oc.env.OPENCODE_PERMISSION).bash, 'ask');
  assert.deepEqual(oc.model, { providerID: 'drael', modelID: 'drael-v1' });
  assert.equal(oc.args[0], 'serve');
});
test('Claude permission requests from a subagent are attributed to its card', () => {
  const p = parser('claude', () => {});
  p.accept({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'agent1', name: 'Agent', input: { description: 'Criar pasta', prompt: 'mkdir x' } },
      ],
    },
  });
  p.accept({
    type: 'assistant',
    parent_tool_use_id: 'agent1',
    message: { content: [{ type: 'tool_use', id: 'bash1', name: 'Bash', input: { command: 'mkdir x' } }] },
  });
  assert.equal(p.ownerOf('bash1'), 'Criar pasta');
  assert.equal(p.ownerOf('other'), null);
  assert.equal(claudeDetail('Write', { file_path: 'C:/a.txt', content: 'x' }), 'C:/a.txt');
});
test('Codex app-server: streamed text, subagent threads and commands', () => {
  const ev = [],
    p = parser('codex', (e) => ev.push(e));
  p.setMainThread('main');
  p.accept({
    method: 'item/started',
    params: { threadId: 'main', item: { type: 'agentMessage', id: 'm1', text: '' } },
  });
  p.accept({ method: 'item/agentMessage/delta', params: { threadId: 'main', itemId: 'm1', delta: 'Olá' } });
  p.accept({
    method: 'item/completed',
    params: { threadId: 'main', item: { type: 'agentMessage', id: 'm1', text: 'Olá' } },
  });
  p.accept({
    method: 'item/started',
    params: {
      threadId: 'main',
      item: {
        type: 'subAgentActivity',
        id: 's1',
        kind: 'started',
        agentThreadId: 'sub',
        agentPath: '/root/criar_pasta',
      },
    },
  });
  assert.equal(p.ownerOfThread('sub'), 'criar pasta');
  assert.equal(p.ownerOfThread('main'), null);
  p.accept({
    method: 'item/completed',
    params: {
      threadId: 'main',
      item: {
        type: 'commandExecution',
        id: 'c1',
        command: '"powershell.exe" -Command \'mkdir y\'',
        status: 'declined',
      },
    },
  });
  assert.equal(p.text, 'Olá');
  const act = ev.find((e) => e.type === 'activity');
  assert.equal(act.detail, 'mkdir y');
  assert.equal(act.status, 'error');
  assert.equal(act.label, 'Comando negado');
  assert.ok(ev.some((e) => e.type === 'subagent' && e.toolUseId === 'sub' && e.status === 'running'));
});
