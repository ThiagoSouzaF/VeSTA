// E2E (Electron offscreen, a fake AI, no real scheduler): Onde rodam.
//   1. the Agents cards say where each agent runs ("VeSTA aberto"); the screen's "Onde rodam" tab shows this PC empty
//   2. "Instalar agents aqui": a big window with the agents as squares; the Codex one needs its AI; two Claude ones go
//      in together; the table lists them, the folder has the runner and the agents
//   3. "Rodar agora": the run starts apart from VeSTA (VeSTA's executable with --vesta-agent, the same way the Task
//      Scheduler does), ends in the folder and comes back to the agent's diary with its lesson waiting for a yes
//   4. a failing run shows a filled "falhou" mark (Tinta and Papel); "Execuções" reads the runs from the folder
//   5. changing the agent leaves the install outdated; "Atualizar" puts the new version there
//   6. the cards and the ONDE filter say "Este PC"; "Remover" takes it out of the folder
// The AI is a node script that answers like `claude -p --output-format json`; VESTA_AGENT_SCHEDULER=none keeps the real
// Task Scheduler out. Needs a fresh `npm run build`. Usage: node scripts/test-places-e2e.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { mainWindow } = require('./test-windows.cjs');

const root = path.join(__dirname, '..');
const data = scratch('places');
const home = path.join(data, 'agents-home');
const evidence = path.join(data, 'evidencias');
const projectDir = path.join(data, 'projeto-site');
fs.mkdirSync(evidence, { recursive: true });
fs.mkdirSync(projectDir, { recursive: true });
fs.writeFileSync(path.join(projectDir, 'README.md'), '# Site\n');
// The fake Claude: fails when the task says FALHE, otherwise answers with a summary and a lesson.
const fake = path.join(data, 'fake-claude.cjs');
fs.writeFileSync(
  fake,
  `let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  if (/FALHE/.test(input)) { process.stderr.write('O Claude não respondeu: login vencido.\\n'); process.exit(3); }
  const where = require('node:path').basename(process.cwd());
  console.log(JSON.stringify({ type: 'result', is_error: false, result: 'Li a pasta ' + where + '.\\nResumo: 3 commits ontem, comece pelo teste do login.\\nLição: o build vem antes dos testes.', usage: { input_tokens: 12, cache_read_input_tokens: 4000, output_tokens: 80 } }));
});`
);
const now = Date.now();
const agent = (id, name, prompt, extra = {}) => ({
  id,
  name,
  prompt,
  provider: 'claude',
  model: '',
  projectId: null,
  mode: 'read',
  memory: false,
  skills: false,
  skillNames: [],
  catchUp: false,
  enabled: true,
  schedule: { kind: 'daily', time: '03:00', days: [], hours: 4 },
  nextRunAt: now + 6 * 3600e3,
  runs: [],
  lessons: [],
  unseen: 0,
  createdAt: now,
  updatedAt: now,
  ...extra,
});
fs.writeFileSync(
  path.join(data, 'vesta.json'),
  JSON.stringify({
    version: 6,
    settings: { memoryEnabled: false, capture: false, memoryTools: false, theme: 'ink', mascot: false },
    projects: [{ id: 'p1', name: 'Site', path: projectDir, createdAt: now }],
    chats: [],
    memories: [],
    agents: [
      agent('a-bom-dia', 'Bom dia do VeSTA', 'Leia os commits de ontem e diga por onde começar.', { projectId: 'p1' }),
      agent('a-backup', 'Backup conferido', 'Confira o backup de ontem. FALHE de propósito.', { memory: true }),
      agent('a-deps', 'Dependências do Mora', 'Atualize as dependências Go.', { provider: 'codex', mode: 'edit' }),
    ],
  })
);

let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log('ok - ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL - ' + name + ': ' + e.message.replace(/\s+/g, ' ').slice(0, 500));
  }
};

(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: {
      ...process.env,
      VESTA_DATA_DIR: data,
      VESTA_AGENTS_HOME: home,
      VESTA_AGENT_SCHEDULER: 'none',
      VESTA_PLACES_SYNC_MS: '700',
      VESTA_NO_UPDATE: '1',
      VESTA_NO_USAGE_REFRESH: '1',
    },
  });
  try {
    const page = await mainWindow(app);
    await page.setViewportSize({ width: 1500, height: 940 });
    await page.waitForSelector('.loading', { state: 'detached' });
    // Only Claude is "installed": the fake, run by node.
    await app.evaluate(
      (_, { electronDir, node, fake }) => {
        const ctx = process.mainModule.require(electronDir + '/main.cjs').ctx;
        for (const p of ['codex', 'opencode', 'drael']) ctx.integrations[p] = { installed: false };
        ctx.integrations.claude = { installed: true, authenticated: true, exe: node, runArgs: [fake], models: [] };
      },
      { electronDir: path.join(root, 'electron'), node: process.execPath, fake }
    );
    const call = (m, a) => page.evaluate(([m, a]) => window.vesta.call(m, a), [m, a]);
    // Read from the main process: bootstrap would probe the AIs again and put the real Claude back in place of the fake.
    const state = () =>
      app.evaluate(
        (_, dir) => JSON.parse(JSON.stringify(process.mainModule.require(dir + '/main.cjs').ctx.store.state)),
        path.join(root, 'electron')
      );
    const agentUntil = async (id, pred, ms = 20000) => {
      for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(300)) {
        const a = (await state()).agents.find((x) => x.id === id);
        if (pred(a)) return a;
      }
      throw new Error('timeout esperando ' + id);
    };
    const shot = (name) => page.screenshot({ path: path.join(evidence, name + '.png') });
    const row = (name) => page.locator('.place-table tbody tr').filter({ hasText: name });
    const card = (name) => page.locator('.agent-card[data-agent="' + name + '"]');

    await step('cards say where each agent runs; Onde rodam shows this PC empty', async () => {
      await page.locator('.rail-item').filter({ hasText: 'Agents' }).click();
      await card('Bom dia do VeSTA').locator('.agent-loc[data-where="vesta"]').waitFor();
      assert.equal(await page.locator('.agent-loc[data-where="vesta"]').count(), 3);
      await page.locator('.agents-views [data-view="places"]').click();
      await page.locator('.place-head h2').filter({ hasText: 'Este PC' }).waitFor();
      await page.locator('.place-empty').waitFor();
      assert.match(await page.locator('.place-path').innerText(), /agents-home/);
      await shot('1-este-pc-vazio');
    });

    await step('install window: squares, the Codex one needs its AI, two go in together', async () => {
      await page.getByRole('button', { name: 'Instalar agents aqui' }).click();
      const modal = page.locator('.place-install');
      await modal.waitFor();
      assert.equal(await modal.locator('.pi-tile').count(), 3);
      const deps = modal.locator('.pi-tile[data-tile="Dependências do Mora"]');
      assert.equal(await deps.getAttribute('aria-disabled'), 'true');
      await deps.locator('.pi-need').waitFor();
      await modal.locator('.pi-tile[data-tile="Bom dia do VeSTA"]').click();
      await modal.locator('.pi-tile[data-tile="Backup conferido"]').click();
      await modal.locator('.pi-side').getByText('Usa a memória do VeSTA').waitFor();
      await modal.locator('.pi-tabs button').filter({ hasText: 'Precisam de algo' }).click();
      assert.equal(await modal.locator('.pi-tile').count(), 1);
      await modal.locator('.pi-tabs button').filter({ hasText: 'Todos' }).click();
      await shot('2-instalar-quadrados');
      await modal.getByRole('button', { name: 'Instalar 2 agents' }).click();
      await modal.waitFor({ state: 'detached', timeout: 10000 });
      await row('Bom dia do VeSTA').waitFor();
      await row('Backup conferido').waitFor();
      assert.ok(fs.existsSync(path.join(home, 'runner', 'vesta-agent.cjs')));
      assert.ok(fs.existsSync(path.join(home, 'runner', 'vesta-agent.cmd')));
      assert.ok(fs.existsSync(path.join(home, 'agents', 'bom-dia-do-vesta', 'agent.json')));
      const s = await state();
      assert.equal(s.agents.find((a) => a.id === 'a-bom-dia').places.pc.slug, 'bom-dia-do-vesta');
      await shot('3-instalados');
    });

    await step('Rodar agora: runs apart from VeSTA and comes back to the diary', async () => {
      await row('Bom dia do VeSTA').getByRole('button', { name: 'Rodar agora' }).click();
      const a = await agentUntil('a-bom-dia', (x) => x.runs?.[0]?.place === 'pc', 30000);
      assert.equal(a.runs[0].status, 'ok');
      assert.equal(a.runs[0].summary, '3 commits ontem, comece pelo teste do login.');
      assert.deepEqual(
        a.lessons.map((l) => [l.text, l.status]),
        [['o build vem antes dos testes.', 'pending']]
      );
      // It ran in the project folder, through the real --vesta-agent launch.
      const rec = JSON.parse(
        fs.readFileSync(
          path.join(
            home,
            'agents',
            'bom-dia-do-vesta',
            'runs',
            fs.readdirSync(path.join(home, 'agents', 'bom-dia-do-vesta', 'runs'))[0]
          ),
          'utf8'
        )
      );
      assert.match(rec.text, /Li a pasta projeto-site/);
      assert.equal(rec.trigger, 'manual');
      await page.getByRole('button', { name: 'Atualizar a lista' }).click();
      await row('Bom dia do VeSTA').locator('.place-ok').waitFor();
    });

    await step('a failing run is marked; Execuções reads the folder; Papel', async () => {
      await row('Backup conferido').getByRole('button', { name: 'Rodar agora' }).click();
      await agentUntil('a-backup', (x) => x.runs?.[0]?.place === 'pc', 30000);
      await page.getByRole('button', { name: 'Atualizar a lista' }).click();
      await row('Backup conferido').locator('.place-bad').waitFor();
      assert.match(await row('Backup conferido').innerText(), /login vencido/);
      assert.equal(
        await row('Backup conferido')
          .getAttribute('class')
          .then((c) => /\berr\b/.test(c)),
        true
      );
      await page.locator('.place-pick .place-bad').waitFor();
      const bg = await page.locator('.place-table .place-bad').evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.equal(bg, 'rgb(239, 68, 68)', 'filled red in Tinta');
      await shot('4-falhou-tinta');
      await call('saveSettings', { theme: 'paper' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper');
      const paper = await page
        .locator('.place-table .place-bad')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.equal(paper, 'rgb(200, 30, 30)', 'filled red in Papel');
      await shot('5-falhou-papel');
      await row('Bom dia do VeSTA').getByRole('button', { name: 'Execuções' }).click();
      const drawer = page.locator('.place-drawer');
      await drawer.locator('.pd-runs li').first().waitFor();
      assert.match(await drawer.innerText(), /3 commits ontem/);
      await page.waitForTimeout(1500); // the drawer slides in (slow offscreen)
      await shot('6-execucoes');
      await drawer.getByRole('button', { name: 'Fechar' }).click();
      await call('saveSettings', { theme: 'ink' });
    });

    await step('a changed agent is outdated there until Atualizar', async () => {
      // With "Levar mudanças sozinho" off (on, the next read would carry it: test-places-sync-e2e).
      await page.locator('.places-auto').getByRole('switch').click();
      await page.locator('.places-auto[data-auto="off"]').waitFor();
      const a = (await state()).agents.find((x) => x.id === 'a-bom-dia');
      await call('agentUpdate', { ...a, prompt: 'Leia os commits de ontem e de hoje.' });
      await page.getByRole('button', { name: 'Atualizar a lista' }).click();
      await row('Bom dia do VeSTA').locator('.place-flag').waitFor();
      await row('Bom dia do VeSTA').getByRole('button', { name: 'Atualizar', exact: true }).click();
      await page.locator('.place-drawer').getByRole('button', { name: 'Atualizar', exact: true }).click();
      await page.locator('.place-drawer').waitFor({ state: 'detached' });
      await row('Bom dia do VeSTA').locator('.place-flag').waitFor({ state: 'detached' });
      const json = JSON.parse(fs.readFileSync(path.join(home, 'agents', 'bom-dia-do-vesta', 'agent.json'), 'utf8'));
      assert.equal(json.prompt, 'Leia os commits de ontem e de hoje.');
    });

    await step('cards and ONDE say Este PC; Remover takes it out of the folder', async () => {
      await page.locator('.agents-views [data-view="agents"]').click();
      await card('Bom dia do VeSTA').locator('.agent-loc[data-where="pc"]').waitFor();
      await page.locator('.agents-where [data-where="pc"]').click();
      assert.equal(await page.locator('.agent-card[data-agent]').count(), 2);
      await page.waitForTimeout(1500); // the cards fade in (slow offscreen)
      await shot('7-cartoes-onde');
      await page.locator('.agents-where [data-where="all"]').click();
      await page.locator('.agents-views [data-view="places"]').click();
      await row('Backup conferido').getByRole('button', { name: 'Remover' }).click();
      await page.locator('.place-drawer').getByRole('button', { name: 'Remover', exact: true }).click();
      await row('Backup conferido').waitFor({ state: 'detached' });
      assert.equal(fs.existsSync(path.join(home, 'agents', 'backup-conferido')), false);
      const s = await state();
      const backup = s.agents.find((x) => x.id === 'a-backup');
      assert.equal(backup.places.pc, undefined);
      assert.equal(backup.runs[0].status, 'error', 'its run stays in the diary');
    });
  } finally {
    await app.close();
  }
  console.log('evidências: ' + evidence);
  if (failed) {
    process.exitCode = 1;
    console.log(failed + ' passo(s) falharam');
  } else console.log('Onde rodam E2E: tudo certo');
})();
