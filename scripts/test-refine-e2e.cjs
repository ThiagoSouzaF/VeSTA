// E2E (real AI): refining a skill and an agent through the screens. A throwaway data dir holds the skill /commit-curto
// (used once in a chat where the person then corrected it) and an agent with a kept lesson and a failed run.
//   1. Skills → /commit-curto → Refinar: Claude (haiku) with a goal opens the refinement chat; its bar shows the
//      proposal (vesta_refine_propose), the diff, and Aplicar puts it in use; the old text is in Versões and comes back.
//   2. Agents → the agent → Refinar: the proposal folds the lesson into the task; Aplicar changes the task.
// Needs Claude and a fresh `npm run build`.
// Usage: node scripts/test-refine-e2e.cjs [shots-dir]
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { mainWindow } = require('./test-windows.cjs');

const root = path.join(__dirname, '..');
const shots = process.argv[2] || scratch('shots');
fs.mkdirSync(shots, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = 'claude-haiku-5-5';
const SKILL = `---
name: commit-curto
description: Escreve mensagens de commit.
---

# Commit curto

1. Leia o diff preparado.
2. Escreva a mensagem de commit.
3. Mostre a mensagem para a pessoa.
`;

function seed(dataDir) {
  const t = Date.now() - 3600000;
  const dir = path.join(dataDir, 'skills', 'commit-curto');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), SKILL);
  fs.writeFileSync(
    path.join(dir, 'skill.json'),
    JSON.stringify({
      name: 'commit-curto',
      description: 'Escreve mensagens de commit.',
      source: { kind: 'paste', label: 'Criadas por você', url: '', path: '', license: '' },
      enabled: true,
      mode: 'auto',
      compat: { claude: 'ok', codex: 'ok', opencode: 'ok', drael: 'ok' },
      adaptedBy: null,
      changes: [],
      tokens: 40,
      createdAt: t,
      updatedAt: t,
      uses: 1,
      lastUsedAt: t + 1000,
      recent: [{ chatId: 'used', at: t + 1000 }],
      versions: [],
      proposal: null,
    })
  );
  const agentId = 'ag1';
  fs.writeFileSync(
    path.join(dataDir, 'vesta.json'),
    JSON.stringify({
      version: 6,
      settings: { memoryEnabled: false, capture: false, memoryTools: false },
      projects: [],
      chats: [
        {
          id: 'used',
          title: 'Commit do login',
          provider: 'claude',
          model: '',
          projectId: null,
          mode: 'edit',
          memory: false,
          sessionId: null,
          createdAt: t,
          updatedAt: t + 5000,
          messages: [
            { id: 'u1', role: 'user', text: '/commit-curto', createdAt: t, skill: 'commit-curto' },
            {
              id: 'a1',
              role: 'assistant',
              text: 'Mensagem: "Fixed the login bug and also refactored the whole session module for clarity"',
              createdAt: t + 2000,
              status: 'done',
              activities: [],
            },
            {
              id: 'u2',
              role: 'user',
              text: 'Não! Em português e com título curto, no máximo 50 caracteres.',
              createdAt: t + 4000,
            },
          ],
        },
      ],
      memories: [],
      quests: [],
      agents: [
        {
          id: agentId,
          name: 'Revisor noturno',
          prompt: 'Revise as mudanças do dia.',
          provider: 'claude',
          model: MODEL,
          projectId: null,
          mode: 'read',
          memory: false,
          skills: false,
          skillNames: [],
          schedule: { kind: 'manual', time: '08:30', days: [], hours: 4 },
          enabled: true,
          catchUp: false,
          runs: [
            {
              id: 'r1',
              at: t,
              endedAt: t + 1000,
              trigger: 'manual',
              status: 'error',
              chatId: null,
              summary: '',
              error: 'Não achou o repositório: a tarefa não diz qual pasta.',
            },
          ],
          lessons: [
            {
              id: 'l1',
              text: 'Sempre listar os arquivos mudados antes de revisar',
              status: 'kept',
              from: 'person',
              at: t,
              runId: null,
            },
          ],
          suggestion: null,
          nextRunAt: null,
          unseen: 0,
          createdAt: t,
          updatedAt: t,
        },
      ],
      consolidation: { schedule: { kind: 'manual' } },
    })
  );
}

(async () => {
  const dataDir = scratch('refine-e2e');
  seed(dataDir);
  const env = { ...process.env, VESTA_DATA_DIR: dataDir, VESTA_NO_UPDATE: '1', VESTA_NO_USAGE_REFRESH: '1' };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  const problems = [];
  let page;
  const step = async (name, fn) => {
    const t0 = Date.now();
    await fn();
    console.log('ok -', name, '(' + Math.round((Date.now() - t0) / 1000) + 's)');
  };
  try {
    page = await mainWindow(app);
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
    await page.waitForSelector('.loading', { state: 'detached' });
    await page.setViewportSize({ width: 1360, height: 900 });
    const call = (method, args) => page.evaluate(([m, a]) => window.vesta.call(m, a), [method, args]);
    const state = async () => (await call('bootstrap')).state;
    assert.ok((await call('bootstrap')).integrations.claude?.installed, 'Claude precisa estar instalado');
    // Waits for the refinement chat's turn to end; one nudge if the AI only asked a question.
    const proposal = async (chatId, has) => {
      for (let round = 0; round < 2; round++) {
        let chat;
        for (let i = 0; i < 300; i++) {
          await wait(1000);
          const st = await state();
          chat = st.chats.find((c) => c.id === chatId);
          if (chat.messages.at(-1).status !== 'running') break;
        }
        const reply = chat.messages.at(-1);
        assert.equal(reply.status, 'done', reply.error || 'a resposta não terminou');
        if (has(await state())) return reply;
        console.log('  a IA respondeu sem propor; pedindo a proposta:', reply.text.slice(0, 200).replace(/\s+/g, ' '));
        await call('send', { chatId, text: 'Pode propor agora, pela ferramenta vesta_refine_propose.' });
      }
      throw new Error('a IA não propôs');
    };

    let skillChat;
    await step('Skills → /commit-curto → Refinar com Claude opens the refinement chat with its bar', async () => {
      await page.locator('.rail-item').filter({ hasText: 'Skills' }).click();
      await page.locator('.skill-tile[data-skill="commit-curto"]').click();
      const drawer = page.locator('.skill-drawer[data-skill="commit-curto"]');
      await drawer.locator('.refine-panel').waitFor();
      assert.match(await drawer.locator('.refine-intro').innerText(), /Nada muda sem o seu sim/);
      await drawer.locator('.refine-ais [data-ai="claude"]').click();
      await drawer.locator('.refine-model').selectOption(MODEL);
      await drawer
        .locator('.refine-goal')
        .fill('As mensagens devem sair em português, com título de no máximo 50 caracteres. Pode propor direto.');
      await page.screenshot({ path: path.join(shots, 'refine-skill-drawer.png') });
      await drawer.getByRole('button', { name: 'Refinar com IA' }).click();
      await page.locator('.refine-chat-bar[data-refine="skill"]').waitFor();
      assert.match(await page.locator('.refine-chat-title').innerText(), /Refinando \/commit-curto/);
      skillChat = (await state()).chats.find((c) => c.refine?.name === 'commit-curto');
      assert.equal(skillChat.mode, 'read');
      assert.equal(skillChat.model, MODEL);
      assert.match(skillChat.messages[0].text, /português/, 'the chat shows what the person asked, not the context');
      assert.doesNotMatch(skillChat.messages[0].text, /Como refinar/);
    });

    await step('the AI reads the evidence and proposes; the bar shows the diff; Aplicar puts it in use', async () => {
      const reply = await proposal(
        skillChat.id,
        (st) => !!st.skills.list.find((s) => s.name === 'commit-curto').proposal
      );
      console.log('  resposta:', reply.text.slice(0, 240).replace(/\s+/g, ' '));
      const tools = (reply.activities || []).map((a) => a.label + ' ' + (a.detail || '')).join(' | ');
      assert.match(tools, /refine/i, 'used the refine tools: ' + tools.slice(0, 300));
      const bar = page.locator('.refine-chat-bar');
      await bar.locator('.refine-proposal').waitFor();
      await bar.getByRole('button', { name: 'Ver diferenças' }).click();
      await bar.locator('.refine-diff .refine-line.add').first().waitFor();
      assert.ok((await bar.locator('.refine-diff .refine-line.add').count()) > 0);
      await page.screenshot({ path: path.join(shots, 'refine-skill-proposal.png') });
      const before = (await call('skillsRead', { name: 'commit-curto' })).text;
      assert.equal(before, SKILL, 'nothing changes before the yes');
      await bar.getByRole('button', { name: 'Aplicar' }).click();
      await bar.locator('.refine-proposal').waitFor({ state: 'detached' });
      const after = await call('skillsRead', { name: 'commit-curto' });
      assert.notEqual(after.text, SKILL);
      assert.match(after.text, /name: "?commit-curto/);
      assert.match(after.text, /portugu/i, 'the new text has what the person asked');
      assert.equal(after.meta.versions.length, 1);
      assert.match(after.meta.versions[0].note, /Antes do refino/);
    });

    await step('Versões shows the old text and brings it back', async () => {
      await page.locator('.rail-item').filter({ hasText: 'Skills' }).click();
      await page.locator('.skill-tile[data-skill="commit-curto"]').click();
      const drawer = page.locator('.skill-drawer[data-skill="commit-curto"]');
      await drawer.locator('.refine-versions summary').click();
      await drawer.locator('.refine-versions [data-version="1"]').getByRole('button', { name: 'Ver' }).click();
      assert.match(await drawer.locator('.refine-version-text').innerText(), /Mostre a mensagem para a pessoa/);
      assert.ok(await drawer.getByRole('button', { name: 'Continuar o refino' }).isVisible(), 'one chat per skill');
      await page.screenshot({ path: path.join(shots, 'refine-skill-versions.png') });
      await drawer.locator('[data-version="1"]').getByRole('button', { name: 'Voltar a esta' }).click();
      await drawer.locator('[data-version="1"]').getByRole('button', { name: 'Confirmar volta' }).click();
      await drawer.locator('.refine-versions [data-version="2"]').waitFor();
      assert.equal((await call('skillsRead', { name: 'commit-curto' })).text, SKILL);
      await page.keyboard.press('Escape');
    });

    await step('Agents → the agent → Refinar: the lesson folds into the task and Aplicar changes it', async () => {
      await page.locator('.rail-item').filter({ hasText: 'Agents' }).click();
      await page.locator('.agent-card[data-agent="Revisor noturno"] .agent-card-open').click();
      const drawer = page.locator('.agent-drawer[data-agent="Revisor noturno"]');
      await drawer.locator('.refine-panel').waitFor();
      await drawer.locator('.refine-ais [data-ai="claude"]').click();
      await drawer.locator('.refine-model').selectOption(MODEL);
      await drawer
        .locator('.refine-goal')
        .fill('Junte a lição aprovada na tarefa e diga na tarefa para usar a pasta C:\\repo. Pode propor direto.');
      await drawer.getByRole('button', { name: 'Refinar com IA' }).click();
      await page.locator('.refine-chat-bar[data-refine="agent"]').waitFor();
      const chat = (await state()).chats.find((c) => c.refine?.kind === 'agent');
      await proposal(chat.id, (st) => !!st.agents[0].proposal);
      const p = (await state()).agents[0].proposal;
      console.log('  tarefa proposta:', p.prompt.slice(0, 200).replace(/\s+/g, ' '));
      assert.match(p.prompt, /repo/i);
      const bar = page.locator('.refine-chat-bar');
      await bar.locator('.refine-proposal').waitFor();
      await page.screenshot({ path: path.join(shots, 'refine-agent-proposal.png') });
      await bar.getByRole('button', { name: 'Aplicar' }).click();
      await bar.locator('.refine-proposal').waitFor({ state: 'detached' });
      const a = (await state()).agents[0];
      assert.equal(a.prompt, p.prompt);
      assert.equal(a.versions[0].prompt, 'Revise as mudanças do dia.');
      assert.deepEqual(a.versions[0].lessons, ['Sempre listar os arquivos mudados antes de revisar']);
    });

    assert.deepEqual(problems, [], problems.join('\n'));
    console.log(
      'PASS: refino de skill e de agent pelas telas, com proposta, diferenças, aplicar e versões. Capturas em ' + shots
    );
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
    try {
      await page.screenshot({ path: path.join(shots, 'refine-fail.png') });
    } catch {}
  } finally {
    await app.close().catch(() => {});
    await wait(500);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
