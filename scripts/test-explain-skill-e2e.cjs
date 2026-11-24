// E2E (real AI): /explain-skill explains a skill that lives in an AI's own folder, with a diagram and a picture that
// the chat draws. A throwaway project holds `.claude/skills/commit-curto` (Claude Code reads project skills there; the
// real ~/.claude is never touched). Claude (haiku) gets "/explain-skill commit-curto claude", finds it through
// vesta_skill_find and answers with ```mermaid, ```svg and a "Detalhes" part; the chat shows the drawn diagram and the
// sanitized picture. Needs Claude and a fresh `npm run build`.
// Usage: node scripts/test-explain-skill-e2e.cjs [shots-dir]
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
const SKILL = `---
name: commit-curto
description: Escreve mensagens de commit curtas em português a partir do diff preparado.
---

# Commit curto

1. Rode \`git diff --staged\` e leia o que mudou.
2. Se não houver nada preparado, peça para a pessoa rodar \`git add\` e pare.
3. Escreva um título de até 60 caracteres no imperativo e, se precisar, um corpo com o porquê.
4. Mostre a mensagem e só rode \`git commit\` depois do sim da pessoa.
`;

(async () => {
  const dataDir = scratch('explain-e2e'),
    projectDir = path.join(dataDir, 'projeto');
  fs.mkdirSync(path.join(projectDir, '.claude', 'skills', 'commit-curto'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.claude', 'skills', 'commit-curto', 'SKILL.md'), SKILL);
  fs.writeFileSync(
    path.join(dataDir, 'vesta.json'),
    JSON.stringify({
      version: 6,
      settings: { memoryEnabled: false, capture: false, memoryTools: false },
      projects: [{ id: 'proj', name: 'projeto-explain', path: projectDir, createdAt: Date.now() }],
      chats: [],
      memories: [],
      quests: [],
      consolidation: { schedule: { kind: 'manual' } },
    })
  );
  const env = { ...process.env, VESTA_DATA_DIR: dataDir, VESTA_NO_UPDATE: '1', VESTA_NO_USAGE_REFRESH: '1' };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  const problems = [];
  let page;
  try {
    page = await mainWindow(app);
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
    await page.waitForSelector('.loading', { state: 'detached' });
    await page.setViewportSize({ width: 1360, height: 900 });
    const call = (method, args) => page.evaluate(([m, a]) => window.vesta.call(m, a), [method, args]);
    const boot = await call('bootstrap');
    assert.ok(boot.integrations.claude?.installed, 'Claude precisa estar instalado');
    assert.ok(
      boot.state.skills.list.some((s) => s.name === 'explain-skill' && s.enabled),
      'a explain-skill vem com o VeSTA'
    );

    const created = await call('createChat', {
      provider: 'claude',
      model: 'claude-haiku-5-5',
      projectId: 'proj',
      mode: 'read',
    });
    const chatId = created.chats[0].id;
    const t0 = Date.now();
    await call('send', { chatId, text: '/explain-skill commit-curto claude' });
    // A fresh read each time (bootstrap snapshots the state before it waits for the AI probe).
    let chat;
    for (let i = 0; i < 240; i++) {
      await wait(1000);
      chat = (await call('bootstrap')).state.chats.find((c) => c.id === chatId);
      if (chat.messages.at(-1).status !== 'running') break;
    }
    const reply = chat.messages.at(-1);
    console.log('resposta em', Math.round((Date.now() - t0) / 1000) + 's,', reply.text.length, 'caracteres');
    assert.equal(reply.status, 'done', reply.error || 'a resposta não terminou');
    assert.equal(chat.messages.at(-2).skill, 'explain-skill', 'o /explain-skill foi carregado');
    const tools = (reply.activities || []).map((a) => a.label + ' ' + (a.detail || '')).join(' | ');
    console.log('ferramentas:', tools.slice(0, 300));
    if (process.env.DEBUG_EXPLAIN)
      console.log('DEBUG', JSON.stringify(reply.activities, null, 1).slice(0, 3000), reply.text);
    assert.match(tools, /vesta_skill_find|commit-curto/i, 'leu a skill (vesta_skill_find ou o arquivo)');
    assert.match(reply.text, /```mermaid/, 'diagrama');
    assert.match(reply.text, /```svg/, 'ilustração');
    assert.match(reply.text, /##\s*Detalhes/i, 'parte Detalhes');
    assert.match(reply.text, /git diff --staged|diff preparado|staged/i, 'explicou o que a skill faz');

    // The chat draws both: the diagram (mermaid, sanitized) and the picture (sanitized svg).
    await page
      .locator('.chat-item, button, a')
      .filter({ hasText: /explain-skill commit-curto/ })
      .first()
      .click();
    const diagram = page.locator('.md-mermaid[data-drawn="ok"] svg').first();
    await diagram.waitFor({ timeout: 30000 });
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('.md-mermaid[data-drawn="ok"] svg text')]
        .map((t) => t.textContent.trim())
        .filter(Boolean)
    );
    console.log('rótulos do diagrama:', labels.slice(0, 8).join(' | '));
    assert.ok(labels.length >= 3, 'o diagrama mostra os rótulos');
    const picture = page.locator('.md-svg svg').first();
    await picture.waitFor();
    const unsafe = await page.evaluate(
      () => document.querySelectorAll('.md-figure script, .md-figure foreignObject, .md-figure image').length
    );
    assert.equal(unsafe, 0, 'nada que rode ou carregue de fora');
    await diagram.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, 'explain-diagrama.png') });
    await picture.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, 'explain-ilustracao.png') });
    assert.deepEqual(
      problems.filter((p) => !/mermaid|Syntax error/i.test(p)),
      [],
      problems.join('\n')
    );
    console.log('PASS: /explain-skill explicou uma skill do Claude com diagrama e ilustração. Capturas em ' + shots);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
    try {
      await page.screenshot({ path: path.join(shots, 'explain-fail.png') });
    } catch {}
  } finally {
    await app.close().catch(() => {});
    await wait(500);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
