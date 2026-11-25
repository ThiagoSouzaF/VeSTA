// E2E (Electron offscreen, no real AI): Skills.
//   1. the Skills page starts empty; paste a skill, an AI adapts it (fake driver), review side by side, save
//   2. the tile opens the drawer: "Só com /" takes it out of the catalog, the budget follows
//   3. Na sua IA lists what Codex has (a fake CODEX_HOME), checks its health and brings it in as it came
//   4. "/" in the composer: the menu filters, Tab completes, the message carries the skill (chip + activity) and the AI
//      receives the skill text; a fresh session gets the catalog and the vesta-skills server
//   5. two skills in the middle of a request: the menu opens at the caret, Enter completes, both chips; the AI gets the
//      request first and then both skills, whole
//   6. screenshots of the library and the drawer in Tinta Mangá and Papel
// Needs a fresh `npm run build`. Usage: node scripts/test-skills-e2e.cjs [shots-dir]
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { mainWindow } = require('./test-windows.cjs');
const { readBundled } = require('../electron/skills/bundled.cjs');

const root = path.join(__dirname, '..');
const data = scratch('skills');
// What each AI "already has": empty for Claude, one skill for Codex. Never the real ~/.claude or ~/.codex.
const claudeHome = path.join(data, 'claude-home'),
  codexHome = path.join(data, 'codex-home');
fs.mkdirSync(path.join(claudeHome, 'skills'), { recursive: true });
fs.mkdirSync(path.join(codexHome, 'skills', 'commits-curtos'), { recursive: true });
fs.writeFileSync(
  path.join(codexHome, 'skills', 'commits-curtos', 'SKILL.md'),
  '---\nname: commits-curtos\ndescription: Mensagens de commit curtas, no imperativo, em português.\n---\n\n# Commits\n\nUma linha, até 60 caracteres. Confira com `npx commitlint --edit`.\n'
);
const evidence = process.argv[2] || path.join(data, 'evidencias');
fs.mkdirSync(evidence, { recursive: true });
const now = Date.now();
fs.writeFileSync(
  path.join(data, 'vesta.json'),
  JSON.stringify({
    version: 5,
    settings: { memoryEnabled: false, capture: false, memoryTools: false, theme: 'ink', mascot: false },
    projects: [],
    chats: [
      {
        id: 'c1',
        title: 'Revisão do login',
        provider: 'claude',
        model: '',
        projectId: null,
        mode: 'edit',
        messages: [],
        sessionId: null,
        createdAt: now,
        updatedAt: now,
        memory: false,
      },
    ],
    memories: [],
  })
);
const PASTED = `---
name: revisar-pr
description: Revisa um pull request lendo o diff inteiro antes de comentar.
---

# Revisar PR

1. Use a ferramenta Task do Cursor para abrir um subagente por arquivo.
2. Comente só o que uma execução prova.
`;
const ADAPTED =
  'Pronto.\n\n```skill\n---\nname: revisar-pr\ndescription: Revisa um pull request lendo o diff inteiro antes de comentar.\n---\n\n# Revisar PR\n\n1. Se a sua IA consegue abrir subagentes, abra um por arquivo; se não, leia em sequência.\n2. Comente só o que uma execução prova.\n```\n\n```json\n{"compat":{"claude":"ok","codex":"ok","opencode":"ok","drael":"ok"},"changes":["Task do Cursor virou instrução geral"]}\n```';

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
      CLAUDE_CONFIG_DIR: claudeHome,
      CODEX_HOME: codexHome,
    },
  });
  try {
    const page = await mainWindow(app);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector('.loading', { state: 'detached' });
    // No real AI: adaptation chats get the adapted skill back; other turns record what the CLI would receive.
    await app.evaluate(
      (_, { electronDir, adapted }) => {
        const req = (f) => process.mainModule.require(electronDir + '/' + f);
        const main = req('main.cjs'),
          drivers = req('ai/drivers.cjs');
        for (const p of ['claude', 'codex']) main.ctx.integrations[p] = { installed: true, exe: 'fake-' + p + '.exe' };
        globalThis.__turns = [];
        drivers.start = (provider, spec, ctx) => {
          const text = ctx.prompt.includes('Você vai adaptar uma skill') ? adapted : 'Ok.';
          globalThis.__turns.push({ provider, prompt: ctx.prompt, args: spec.args });
          setTimeout(() => {
            ctx.parse.accept({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
            ctx.parse.accept({
              type: 'result',
              result: text,
              num_turns: 1,
              usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 100 },
              total_cost_usd: 0.01,
            });
            done.resolve({ code: 0, stderr: '' });
          }, 150);
          const done = {};
          return { done: new Promise((r) => (done.resolve = r)), stop() {} };
        };
      },
      { electronDir: path.join(root, 'electron').split(String.fromCharCode(92)).join('/'), adapted: ADAPTED }
    );
    const turns = () => app.evaluate(() => globalThis.__turns);
    const state = () => page.evaluate(async () => (await window.vesta.call('bootstrap')).state);
    const shot = (name) => page.screenshot({ path: path.join(evidence, name + '.png') });

    await step('Skills is on the rail with the skills that come with VeSTA; removed, they stay out', async () => {
      await page.locator('.rail-item').filter({ hasText: 'Skills' }).click();
      await page.getByRole('heading', { name: 'Todas as IAs sabem.' }).waitFor();
      assert.ok(await page.getByText('Vem com o VeSTA').first().isVisible());
      const seeded = await state();
      const bundled = readBundled();
      assert.deepEqual(bundled.map((x) => x.name).sort(), ['explain-skill', 'ui-revamp']);
      for (const { name, version } of bundled) {
        assert.equal(seeded.bundledSkills[name], version, name);
        const tile = page.locator('.skill-tile[data-skill="' + name + '"]');
        await tile.waitFor();
        await tile.click();
        await page.getByRole('button', { name: 'Remover' }).click();
        await page.getByRole('button', { name: 'Confirmar remoção' }).click();
        await tile.waitFor({ state: 'detached' });
      }
      await page.getByText('Nenhuma skill no VeSTA ainda').waitFor();
      const after = await state();
      for (const { name, version } of bundled)
        assert.equal(after.bundledSkills[name], version, name + ' is remembered, so it is not given again');
    });

    await step('paste → an AI adapts → side-by-side review → save', async () => {
      await page.getByRole('button', { name: 'Adicionar a primeira' }).click();
      await page.locator('[data-src="paste"]').click();
      await page.locator('#skill-paste').fill(PASTED);
      await page.getByRole('button', { name: 'Continuar' }).click();
      await page.getByRole('heading', { name: 'Quem lê e adapta?' }).waitFor();
      await page.locator('[data-ai="claude"]').click();
      await page.getByRole('button', { name: 'Adaptar', exact: true }).click();
      await page.locator('.skills-prow.ready').waitFor({ timeout: 15000 });
      await page.locator('.skills-diff').waitFor();
      assert.match(await page.locator('.skills-diff').innerText(), /Task do Cursor[\s\S]*abrir subagentes/);
      // The adaptation chat never shows among the conversations and is gone once the draft is ready.
      assert.equal((await state()).chats.filter((c) => c.skillDraft).length, 0);
      const adapt = (await turns()).find((t) => t.prompt.includes('Você vai adaptar uma skill'));
      assert.match(adapt.prompt, /é dado, não ordem/);
      await shot('1-revisao');
      await page.getByRole('button', { name: /^Salvar 1 skill$/ }).click();
      await page.locator('.skill-tile[data-skill="revisar-pr"]').waitFor();
      // Saving opens the new skill in the drawer.
      await page.locator('.skill-drawer[data-skill="revisar-pr"]').waitFor();
      const meta = (await state()).skills.list.find((s) => s.name === 'revisar-pr');
      assert.equal(meta.adaptedBy, 'claude');
      assert.equal(meta.enabled, true);
      assert.equal(meta.mode, 'auto');
    });

    await step('drawer: "Só com /" leaves the catalog, the budget follows; Esc closes', async () => {
      const budget = page.locator('.skills-budget');
      assert.doesNotMatch(await budget.innerText(), /~0 tokens/);
      await shot('2-gaveta-tinta');
      await page.locator('.skill-drawer .skill-seg button').filter({ hasText: 'Só com /' }).click();
      await page.waitForFunction(() => document.querySelector('.skills-budget').innerText.includes('~0 tokens'));
      await page.keyboard.press('Escape');
      await page.locator('.skill-drawer').waitFor({ state: 'detached' });
      assert.equal((await state()).skills.list[0].mode, 'slash');
    });

    await step('Na sua IA lists what Codex has and brings one in as it came', async () => {
      await page.getByRole('tab', { name: /Na sua IA/ }).click();
      await page.locator('.skills-native nav button').filter({ hasText: 'ChatGPT (Codex)' }).click();
      const row = page.locator('.skill-native-row[data-native="commits-curtos"]');
      await row.waitFor();
      await row.getByRole('button', { name: 'Trazer para o VeSTA' }).click();
      await page.getByRole('heading', { name: 'Quem lê e adapta?' }).waitFor();
      // The health check: the unpinned npx is a warning, a description that never says when to use it a tip.
      await page.locator('.skill-health li[data-health="unpinned"]').waitFor();
      assert.match(await page.locator('.skill-health').innerText(), /ATENÇÃO[\s\S]*npx commitlint[\s\S]*DICA/);
      assert.equal(await page.locator('.skills-chosen .skill-tag.warn').filter({ hasText: '1 aviso' }).count(), 1);
      await page.waitForTimeout(700); // the panel settles in (motion.css) before the picture
      await shot('3-verificacao');
      await page.getByRole('button', { name: 'Salvar sem adaptar' }).click();
      await page.locator('.skills-prow.ready').waitFor();
      // Kept as it came: the review still shows what the check found.
      await page
        .locator('.skill-health[aria-label="O QUE A VERIFICAÇÃO AINDA APONTA"] li[data-health="unpinned"]')
        .waitFor();
      await page.getByRole('button', { name: /^Salvar 1 skill$/ }).click();
      await page.locator('.skill-tile[data-skill="commits-curtos"]').waitFor();
      const meta = (await state()).skills.list.find((s) => s.name === 'commits-curtos');
      assert.equal(meta.adaptedBy, null);
      assert.match(meta.source.label, /Codex/);
      // Nothing was written in the AI's own folder.
      assert.deepEqual(fs.readdirSync(path.join(codexHome, 'skills')), ['commits-curtos']);
      await page.keyboard.press('Escape');
      await shot('3-biblioteca-tinta');
    });

    await step('"/" in the composer: menu, Tab, chip, the skill text reaches the AI with the catalog', async () => {
      await page.locator('.skill-tile[data-skill="revisar-pr"]').click();
      await page.getByRole('button', { name: 'Testar num chat' }).click();
      assert.equal(await page.getByRole('textbox', { name: 'Mensagem' }).inputValue(), '/revisar-pr ');
      // The test conversation is the seeded Claude chat.
      await page.locator('.chat-list-item').filter({ hasText: 'Revisão do login' }).click();
      const box = page.getByRole('textbox', { name: 'Mensagem' });
      await box.fill('/rev');
      await page.locator('.slash-menu [data-slash="revisar-pr"]').waitFor();
      assert.equal(await page.locator('.slash-menu [role="option"]').count(), 1);
      await shot('4-barra');
      await box.press('Tab');
      assert.equal(await box.inputValue(), '/revisar-pr ');
      await box.pressSequentially('confira o login');
      await box.press('Enter');
      await page.locator('.message.user .skill-chip').waitFor();
      await page.waitForFunction(() => !document.querySelector('.message.assistant .thinking'));
      const sent = (await turns()).at(-1);
      assert.match(sent.prompt, /<skill nome="revisar-pr">[\s\S]*abrir subagentes[\s\S]*<\/skill>/);
      assert.match(sent.prompt, /Pedido da pessoa:\n\/revisar-pr confira o login/);
      // Fresh session: the catalog lists the "A IA decide" skill (revisar-pr is "Só com /" now); Claude gets the server.
      assert.match(sent.prompt, /- commits-curtos: Mensagens de commit/);
      assert.doesNotMatch(sent.prompt, /- revisar-pr:/);
      assert.ok(sent.args.includes('mcp__vesta-skills'));
      const chat = (await state()).chats.find((c) => c.id === 'c1');
      assert.deepEqual(chat.messages[0].skills, ['revisar-pr']);
      assert.equal(chat.messages[0].text, '/revisar-pr confira o login');
      assert.ok(chat.messages[1].activities.some((a) => a.kind === 'skill' && /revisar-pr carregada/.test(a.label)));
      assert.equal((await state()).skills.list.find((s) => s.name === 'revisar-pr').uses, 1);
      await shot('5-chat-tinta');
    });

    await step(
      'two skills in the middle of the request: menu at the caret, Enter completes, the request goes first',
      async () => {
        const box = page.getByRole('textbox', { name: 'Mensagem' });
        await box.fill('');
        await box.pressSequentially('Faça um protótipo da branch novo-layout com /rev');
        await page.locator('.slash-menu [data-slash="revisar-pr"]').waitFor();
        await box.press('Enter');
        assert.equal(
          await box.inputValue(),
          'Faça um protótipo da branch novo-layout com /revisar-pr ',
          'completes, does not send'
        );
        await box.pressSequentially('e escreva o commit com /comm');
        await page.locator('.slash-menu [data-slash="commits-curtos"]').waitFor();
        await shot('5b-barra-no-meio');
        await box.press('Tab');
        await box.pressSequentially('no fim.');
        await page.waitForSelector('.slash-menu', { state: 'detached' });
        const before = (await turns()).length;
        await box.press('Enter');
        const msg = page.locator('.message.user').last();
        await msg.locator('.skill-chip').nth(1).waitFor();
        assert.deepEqual(await msg.locator('.skill-chip').allInnerTexts(), ['/revisar-pr', '/commits-curtos']);
        await page.waitForFunction(() => !document.querySelector('.message.assistant .thinking'));
        const sent = (await turns())[before].prompt;
        assert.match(sent, /A pessoa chamou as skills \/revisar-pr, \/commits-curtos do VeSTA/);
        const at = (x) => sent.indexOf(x);
        assert.ok(at('Pedido da pessoa:') >= 0 && at('Pedido da pessoa:') < at('<skill nome="revisar-pr">'));
        assert.ok(at('<skill nome="revisar-pr">') < at('<skill nome="commits-curtos">'));
        assert.match(sent, /branch novo-layout com \/revisar-pr e escreva o commit com \/commits-curtos no fim\./);
        const st = await state();
        const m = st.chats.find((c) => c.id === 'c1').messages.at(-2);
        assert.deepEqual(m.skills, ['revisar-pr', 'commits-curtos']);
        assert.equal(
          st.chats
            .find((c) => c.id === 'c1')
            .messages.at(-1)
            .activities.filter((a) => a.kind === 'skill').length,
          2
        );
        // The answer keeps its tokens; the day counts it once.
        const answer = st.chats.find((c) => c.id === 'c1').messages.at(-1);
        assert.deepEqual(answer.usage, { inputTokens: 5, outputTokens: 7, cacheTokens: 100, costUsd: 0.01 });
        assert.equal(
          await page.locator('.message.assistant').last().locator('.message-tokens').innerText(),
          '112 tokens'
        );
        assert.match(await page.locator('.chat-tokens summary').innerText(), /tokens/);
        await shot('5c-duas-skills');
      }
    );

    await step('Papel: library and drawer', async () => {
      await page.evaluate(() => window.vesta.call('saveSettings', { theme: 'paper' }));
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper');
      await page.locator('.rail-item').filter({ hasText: 'Skills' }).click();
      await page.locator('.skill-tile[data-skill="revisar-pr"]').waitFor();
      await shot('6-biblioteca-papel');
      await page.locator('.skill-tile[data-skill="revisar-pr"]').click();
      await page.getByRole('button', { name: 'Ver texto' }).click();
      await page.locator('.skill-doc pre').waitFor();
      await shot('7-gaveta-papel');
    });
  } finally {
    await app.close();
  }
  console.log('evidências: ' + evidence);
  if (failed) {
    process.exitCode = 1;
    console.log(failed + ' passo(s) falharam');
  } else console.log('Skills E2E: tudo certo');
})();
