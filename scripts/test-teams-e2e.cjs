// E2E (Electron offscreen, no real AI): Equipes.
//   1. Equipes on the rail; a new team from the form (template Líder, Dev e Revisor) on a git project
//   2. "Começar": the lead plans, Dev works in its own worktree and commits, the reviewer approves — every message
//      travels on its wire (a packet on the desk, the wire hot), the board and the conversations follow
//   3. the lead asks the person's yes: the Você card waits; the answer wakes the lead
//   4. "Juntar 1 commit" merges Dev's branch into the project; the team chats stay out of Conversas
//   5. a dragged card keeps its place; "Parar todos"; the Papel theme
// The fake AI plays each agent by calling the team tools the way the vesta-skills server does (ctx.teams.tool).
// Needs a fresh `npm run build`. Usage: node scripts/test-teams-e2e.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { mainWindow } = require('./test-windows.cjs');

const root = path.join(__dirname, '..');
const data = scratch('teams');
const evidence = path.join(data, 'evidencias');
const projectDir = path.join(data, 'site');
fs.mkdirSync(evidence, { recursive: true });
fs.mkdirSync(projectDir, { recursive: true });
const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=teste', '-c', 'user.email=teste@exemplo', ...args], {
    encoding: 'utf8',
  });
git(projectDir, 'init', '-q', '-b', 'main');
fs.writeFileSync(path.join(projectDir, 'index.html'), '<h1>Site</h1>\n');
git(projectDir, 'add', '.');
git(projectDir, 'commit', '-q', '-m', 'início');
const now = Date.now();
fs.writeFileSync(
  path.join(data, 'vesta.json'),
  JSON.stringify({
    version: 5,
    settings: { memoryEnabled: false, capture: false, memoryTools: false, theme: 'ink', mascot: false },
    projects: [{ id: 'p1', name: 'Site', path: projectDir, createdAt: now }],
    chats: [],
    memories: [],
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
      VESTA_NO_UPDATE: '1',
      VESTA_NO_USAGE_REFRESH: '1',
      VESTA_TEAM_TICK_MS: '1000',
    },
  });
  try {
    const page = await mainWindow(app);
    await page.setViewportSize({ width: 1500, height: 920 });
    await page.waitForSelector('.loading', { state: 'detached' });
    // The fake AI: each agent, on its turn, does what its role would, through the team tools.
    await app.evaluate(
      (_, { electronDir }) => {
        const req = (f) => process.mainModule.require(electronDir + '/' + f);
        const cp = process.mainModule.require('node:child_process');
        const fsx = process.mainModule.require('node:fs');
        const pathx = process.mainModule.require('node:path');
        const main = req('main.cjs'),
          drivers = req('ai/drivers.cjs');
        const ctx = main.ctx;
        // Only Claude (the fake speaks Claude's events): the form swaps the template's Codex for it.
        for (const p of ['codex', 'opencode', 'drael']) ctx.integrations[p] = { installed: false };
        ctx.integrations.claude = { installed: true, exe: 'fake-claude.exe', models: [] };
        globalThis.__turns = [];
        const play = (prompt) => {
          const team = ctx.store.state.teams[0];
          const name = (prompt.match(/Você é (\S+) \(/) || [])[1];
          const m = team?.members.find((x) => x.name === name);
          if (!m) return 'Nada a fazer.';
          const chat = ctx.store.state.chats.find((c) => c.id === m.chatId);
          const tool = (n, a) => ctx.teams.tool(chat, n, a);
          globalThis.__turns.push(name);
          if (name === 'Líder') {
            if (/Objetivo:/.test(prompt) && !team.tasks.length) {
              tool('vesta_team_task', { para: 'Dev', titulo: 'Criar a página de contato', detalhe: 'contato.html' });
              return 'Planejei: T1 com o Dev.';
            }
            if (/T1 aprovada/.test(prompt)) {
              tool('vesta_team_send', {
                para: 'voce',
                texto: 'T1 revisada. Posso juntar a branch do Dev?',
                tipo: 'sim',
              });
              return 'Pedi o sim da pessoa.';
            }
            return 'Combinado, fico no aguardo.';
          }
          if (name === 'Dev' && /T1/.test(prompt)) {
            tool('vesta_team_move', { id: 'T1', coluna: 'fazendo' });
            fsx.writeFileSync(pathx.join(chat.workdir, 'contato.html'), '<form>contato</form>\n');
            const g = (...a) =>
              cp.execFileSync('git', ['-C', chat.workdir, '-c', 'user.name=dev', '-c', 'user.email=dev@exemplo', ...a]);
            g('add', '.');
            g('commit', '-q', '-m', 'contato');
            tool('vesta_team_move', { id: 'T1', coluna: 'revisao', para: 'Revisor', nota: 'contato.html pronto' });
            return 'Fiz a T1 e mandei para revisão.';
          }
          if (name === 'Revisor' && /T1/.test(prompt)) {
            tool('vesta_team_move', { id: 'T1', coluna: 'feito', nota: 'ok' });
            tool('vesta_team_send', { para: 'Líder', texto: 'T1 aprovada, sem pendências.', tipo: 'revisao' });
            return 'Revisei a T1.';
          }
          return 'Nada novo.';
        };
        drivers.start = (provider, spec, c) => {
          const done = {};
          setTimeout(() => {
            let text;
            try {
              text = play(c.prompt);
            } catch (e) {
              text = 'Erro: ' + e.message;
            }
            c.parse.accept({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
            c.parse.accept({
              type: 'result',
              result: text,
              num_turns: 1,
              usage: { input_tokens: 1200, output_tokens: 300 },
            });
            done.resolve({ code: 0, stderr: '' });
          }, 1500);
          return { done: new Promise((r) => (done.resolve = r)), stop() {} };
        };
      },
      { electronDir: path.join(root, 'electron').split(String.fromCharCode(92)).join('/') }
    );
    const state = () => page.evaluate(async () => (await window.vesta.call('bootstrap')).state);
    const until = async (ok, what, ms = 30000) => {
      let t;
      for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(250)) {
        t = (await state()).teams?.[0];
        if (t && ok(t)) return t;
      }
      const log = (t?.messages || []).map((m) => m.from + '>' + m.to + ' ' + m.kind + ': ' + m.text.slice(0, 80));
      throw new Error('timed out waiting for ' + what + ' | ' + t?.status + ' | ' + log.join(' || '));
    };
    const shot = async (name) => {
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(evidence, name + '.png') });
    };
    // Packets are short-lived: a sampler in the page counts every one that ever appears, by kind.
    const watchPackets = () =>
      page.evaluate(() => {
        window.__packets = [];
        window.__hot = 0;
        new MutationObserver((list) => {
          for (const r of list)
            for (const n of r.addedNodes)
              if (n.classList?.contains('team-packet')) window.__packets.push(n.getAttribute('data-kind'));
          if (document.querySelector('.team-wire.hot')) window.__hot++;
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
      });

    await step('Equipes on the rail; a new team from the form', async () => {
      await page.locator('.rail-item').filter({ hasText: 'Equipes' }).click();
      await page.getByRole('heading', { name: 'Uma equipe de agents num projeto.' }).waitFor();
      await shot('1-vazio');
      await page.getByRole('button', { name: 'Montar a primeira equipe' }).click();
      await page.locator('.team-form').waitFor();
      await page.locator('.team-field').filter({ hasText: 'NOME' }).locator('input').fill('Equipe do site');
      await page.locator('.team-field').filter({ hasText: 'OBJETIVO' }).locator('textarea').fill('Página de contato.');
      assert.equal(await page.locator('.team-member-row').count(), 3, 'template trio');
      await page.getByLabel('IA de Dev').selectOption('claude');
      await shot('2-formulario');
      await page.locator('[data-action="save"]').click();
      await page.locator('.team-view').waitFor();
      await page.locator('.team-card[data-agent="voce"]').waitFor();
      assert.equal(await page.locator('.team-card').count(), 4);
      assert.equal(await page.locator('.team-wire').count(), 3, 'you-lead and lead to each agent');
      await shot('3-mesa-nova');
    });

    await step('Começar: the work travels on the wires; board and conversations follow', async () => {
      await watchPackets();
      await page.locator('[data-action="start"]').click();
      await until((t) => t.members.find((m) => m.id === 'dev')?.branch, 'the worktrees');
      const t = await until((t) => (t.asks || []).some((a) => a.status === 'open'), 'the lead asking', 45000);
      const dev = t.members.find((m) => m.id === 'dev');
      assert.equal(dev.branch, 'equipe/equipe-do-site/dev');
      assert.ok(fs.existsSync(path.join(dev.workdir, 'contato.html')), 'Dev worked in its worktree');
      assert.ok(!fs.existsSync(path.join(projectDir, 'contato.html')), 'the project is untouched until the merge');
      assert.equal(t.tasks[0].column, 'done');
      assert.ok(dev.tokens > 0, 'tokens counted per agent');
      const kinds = await page.evaluate(() => window.__packets);
      for (const k of ['task', 'review', 'human'])
        assert.ok(kinds.includes(k), 'a ' + k + ' packet travelled: ' + kinds);
      assert.ok(await page.evaluate(() => window.__hot > 0), 'a wire got hot');
      assert.ok((await page.locator('.team-wire').count()) >= 4, 'Dev and Revisor talked: a new wire');
      await page.locator('.team-card[data-agent="voce"][data-state="waiting"]').waitFor();
      await page.locator('.team-entry').filter({ hasText: 'T1 aprovada' }).first().waitFor();
      await shot('4-esperando-voce');
      await page.locator('.team-tabs [data-tab="board"]').click();
      await page.locator('.team-col[data-column="done"] [data-task="T1"]').waitFor();
      await shot('5-quadro');
      await page.locator('.team-tabs [data-tab="log"]').click();
    });

    await step('the answer wakes the lead', async () => {
      const before = (await app.evaluate(() => globalThis.__turns)).length;
      await page.locator('.team-card[data-agent="voce"] .team-ask button', { hasText: 'Sim' }).click();
      await until((t) => !(t.asks || []).some((a) => a.status === 'open'), 'the ask answered');
      for (const end = Date.now() + 15000; Date.now() < end; await page.waitForTimeout(250))
        if ((await app.evaluate(() => globalThis.__turns)).slice(before).includes('Líder')) break;
      assert.ok((await app.evaluate(() => globalThis.__turns)).slice(before).includes('Líder'));
      await page.locator('.team-card[data-agent="voce"][data-state="idle"]').waitFor();
    });

    await step('Juntar 1 commit; team chats stay out of Conversas', async () => {
      await page.locator('.team-card[data-agent="dev"] .team-merge').waitFor({ timeout: 15000 });
      assert.match(await page.locator('.team-card[data-agent="dev"] .team-merge').innerText(), /Juntar 1 commit/);
      await page.locator('.team-card[data-agent="dev"] .team-merge').click();
      for (const end = Date.now() + 10000; Date.now() < end && !fs.existsSync(path.join(projectDir, 'contato.html')); )
        await page.waitForTimeout(250);
      assert.ok(fs.existsSync(path.join(projectDir, 'contato.html')), 'merged into the project');
      assert.match(git(projectDir, 'log', '--oneline', '-1'), /Merge branch 'equipe\/equipe-do-site\/dev'/);
      await page.locator('.team-entry').filter({ hasText: 'Você juntou' }).first().waitFor();
      const s = await state();
      const teamChats = s.chats.filter((c) => c.teamId);
      assert.equal(teamChats.length, 3);
      if (!(await page.locator('.conversation-drawer').count()))
        await page.locator('.rail-item').filter({ hasText: 'Conversas' }).click();
      await page.locator('.conversation-drawer').waitFor();
      const listed = await page.evaluate(
        (ids) => ids.filter((id) => document.querySelector('[data-chat="' + id + '"]')),
        teamChats.map((c) => c.id)
      );
      assert.deepEqual(listed, []);
      // The drawer only covers the side: the team is still open behind it.
      await page.locator('.team-view').waitFor();
      await shot('6-conversas-sem-a-equipe');
    });

    await step('a dragged card keeps its place; Parar todos; Papel', async () => {
      const box = await page.locator('.team-card[data-agent="revisor"] .team-card-name').boundingBox();
      const before = (await state()).teams[0].members.find((m) => m.id === 'revisor');
      await page.mouse.move(box.x + 20, box.y + 5);
      await page.mouse.down();
      await page.mouse.move(box.x - 120, box.y - 60, { steps: 8 });
      await page.mouse.up();
      const t = await until((t) => t.members.find((m) => m.id === 'revisor').x < before.x - 0.02, 'the new place');
      assert.ok(t.members.find((m) => m.id === 'revisor').y < before.y);
      await page.locator('[data-action="stop"]').click();
      await until((t) => t.status === 'stopped', 'stopped');
      await page.locator('.team-view[data-status="stopped"]').waitFor();
      await page.evaluate(() => window.vesta.call('saveSettings', { theme: 'paper' }));
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper');
      await shot('7-papel');
      // The list shows the team.
      await page.locator('.team-back').click();
      await page.locator('.team-tile[data-status="stopped"]').waitFor();
      await shot('8-lista');
    });
  } finally {
    await app.close();
  }
  console.log('evidências: ' + evidence);
  if (failed) {
    process.exitCode = 1;
    console.log(failed + ' passo(s) falharam');
  } else console.log('Equipes E2E: tudo certo');
})();
