// E2E (Electron offscreen, a fake VPS, no real network): Onde rodam, fase 3 (sincronizar).
//   1. "Levar mudanças sozinho": on, a change of an installed agent reaches the VPS by itself; off, it waits and
//      "Atualizar todos" takes it
//   2. a team split across places: the form says where each member runs; the header says "Roda em"; the members on the
//      VPS take their turns there (runner jobs) and talk through action lines that VeSTA carries
//   3. Mapa: the team's frame on the VPS, the wire from you crossing to it, the log saying which places it crossed
//   4. offline: a message to a member on the VPS waits ("na fila: lugar fora do ar") and is delivered when it is back
// The VPS is scripts/fake-ssh.cjs; its Claude is a node script that answers each member by its name. Needs a fresh
// `npm run build`.
// Usage: node scripts/test-places-sync-e2e.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { mainWindow } = require('./test-windows.cjs');

const root = path.join(__dirname, '..');
const data = scratch('places-sync');
const vpsHome = path.join(data, 'vps', 'home');
const vpsBin = path.join(data, 'vps', 'bin');
const down = path.join(data, 'vps', 'vps-down');
const evidence = path.join(data, 'evidencias');
const projectDir = path.join(data, 'projeto-site');
for (const d of [vpsHome, vpsBin, evidence, projectDir]) fs.mkdirSync(d, { recursive: true });
// The probe finds "claude" in the fake's bin folder; the runner there then gets this node script as its Claude.
fs.writeFileSync(path.join(vpsBin, 'claude'), '#!/bin/sh\necho fake\n');
const fakeAi = path.join(data, 'vps', 'fake-claude.cjs');
fs.writeFileSync(
  fakeAi,
  `let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const me = /^Você é (\\S+)/.exec(input)?.[1];
  let text;
  if (me === 'Líder' && /README pronto|CHANGELOG pronto/.test(input))
    text = 'Conferi.\\nvesta_team_send {"para":"voce","tipo":"sim","texto":"Posso dar por terminado?"}';
  else if (me === 'Líder') text = 'Planejei.\\nvesta_team_task {"para":"Docs","titulo":"README novo","detalhe":"seção de instalação"}';
  else if (/CHANGELOG/.test(input)) text = 'Escrevi o CHANGELOG.\\nvesta_team_send {"para":"Líder","tipo":"resposta","texto":"CHANGELOG pronto"}';
  else text = 'Escrevi o README.\\nvesta_team_send {"para":"Líder","tipo":"resposta","texto":"README pronto"}';
  console.log(JSON.stringify({ type: 'result', result: text, usage: { input_tokens: 30, output_tokens: 3 } }));
});`
);
const now = Date.now();
fs.writeFileSync(
  path.join(data, 'vesta.json'),
  JSON.stringify({
    version: 6,
    settings: { memoryEnabled: false, capture: false, memoryTools: false, theme: 'ink', mascot: false },
    projects: [{ id: 'p1', name: 'Site', path: projectDir, createdAt: now }],
    chats: [],
    memories: [],
    agents: [
      {
        id: 'a-logs',
        name: 'Logs da VPS',
        prompt: 'Leia o journal das últimas 2 h.',
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
      },
    ],
    teams: [],
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
      VESTA_AGENTS_HOME: path.join(data, 'pc-agents'),
      VESTA_AGENT_SCHEDULER: 'none',
      VESTA_SSH: JSON.stringify({
        exe: process.execPath,
        args: [path.join(__dirname, 'fake-ssh.cjs'), vpsHome, vpsBin],
      }),
      VESTA_PLACES_SYNC_MS: '700',
      VESTA_REMOTE_SYNC_MS: '1500',
      VESTA_TEAM_TICK_MS: '700',
      VESTA_NO_UPDATE: '1',
      VESTA_NO_USAGE_REFRESH: '1',
    },
  });
  try {
    const page = await mainWindow(app);
    await page.setViewportSize({ width: 1500, height: 940 });
    await page.waitForSelector('.loading', { state: 'detached' });
    const call = (m, a) => page.evaluate(([m, a]) => window.vesta.call(m, a), [m, a]);
    const state = () =>
      app.evaluate(
        (_, dir) => JSON.parse(JSON.stringify(process.mainModule.require(dir + '/main.cjs').ctx.store.state)),
        path.join(root, 'electron')
      );
    const until = async (what, pred, ms = 30000) => {
      for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(300)) {
        const v = pred(await state());
        if (v) return v;
      }
      throw new Error('timeout esperando ' + what);
    };
    const shot = (name) => page.screenshot({ path: path.join(evidence, name + '.png') });
    const thereJson = () =>
      JSON.parse(fs.readFileSync(path.join(vpsHome, '.vesta-agents', 'agents', 'logs-da-vps', 'agent.json'), 'utf8'));
    const r = await call('placeConnect', { name: 'vps-teste', host: 'thiago@203.0.113.10' });
    assert.equal(r.ok, true, 'connected');
    const vpsId = r.placeId;
    // The runner there gets the fake Claude (a node script) for the team turns.
    const configFile = path.join(vpsHome, '.vesta-agents', 'config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.ais.claude = { exe: process.execPath, args: [fakeAi] };
    fs.writeFileSync(configFile, JSON.stringify(config));
    await call('placeInstall', { placeId: vpsId, agentIds: ['a-logs'] });
    const agentOf = async () => (await state()).agents.find((a) => a.id === 'a-logs');

    await step('Levar mudanças sozinho: on, a change goes by itself; off, Atualizar todos takes it', async () => {
      await page.locator('.rail-item').filter({ hasText: 'Agents' }).click();
      await page.locator('.agents-views [data-view="places"]').click();
      const sw = page.locator('.places-auto');
      await sw.waitFor();
      assert.equal(await sw.getAttribute('data-auto'), 'on', 'on by default');
      await call('agentUpdate', { ...(await agentOf()), prompt: 'Leia o journal das últimas 4 h.' });
      for (const end = Date.now() + 20000; !/4 h/.test(thereJson().prompt) && Date.now() < end; )
        await page.waitForTimeout(300);
      assert.match(thereJson().prompt, /4 h/, 'the VPS got the change by itself');
      await sw.getByRole('switch').click();
      await page.locator('.places-auto[data-auto="off"]').waitFor();
      await call('agentUpdate', { ...(await agentOf()), prompt: 'Leia o journal das últimas 6 h.' });
      await page.locator('.place-pick').filter({ hasText: 'vps-teste' }).click();
      const all = page.locator('.place-all');
      await all.waitFor({ timeout: 20000 });
      assert.match(await all.innerText(), /atualizar todos .1./i);
      await page.waitForTimeout(400);
      await shot('1-atualizar-todos');
      assert.doesNotMatch(thereJson().prompt, /6 h/, 'off: it waits');
      await all.click();
      let toasts = [];
      for (let k = 0; k < 40 && !toasts.some((x) => x.includes('1 atualizado')); k++) {
        await page.waitForTimeout(250);
        toasts = toasts.concat(await page.locator('.toast').allInnerTexts());
      }
      assert.ok(
        toasts.some((x) => x.includes('1 atualizado')),
        'the toast says how many'
      );
      assert.match(thereJson().prompt, /6 h/);
      await all.waitFor({ state: 'detached' });
      await sw.getByRole('switch').click();
      await page.locator('.places-auto[data-auto="on"]').waitFor();
    });

    let teamId;
    await step('a team across places: the form says where each one runs, the turns run on the VPS', async () => {
      const created = await call('teamCreate', {
        name: 'Equipe do site',
        projectId: 'p1',
        goal: 'README novo',
        members: [
          { name: 'Líder', role: 'organiza', provider: 'claude', mode: 'read', lead: true, place: vpsId },
          { name: 'Docs', role: 'escreve a documentação', provider: 'claude', mode: 'edit', place: 'pc' },
        ],
      });
      teamId = created.id;
      await page.locator('.rail-item').filter({ hasText: 'Equipes' }).click();
      await page.locator('.team-tile').first().click();
      await page.locator('.team-where[data-where="pc"]').waitFor();
      // Edit: Docs goes to the VPS too.
      await page.getByRole('button', { name: 'Editar a equipe' }).click();
      const places = page.locator('select[data-field="place"]');
      assert.equal(await places.count(), 2);
      assert.equal(await places.nth(0).inputValue(), vpsId);
      await page.waitForTimeout(300);
      await shot('2-formulario-lugares');
      await places.nth(1).selectOption(vpsId);
      await page.locator('[data-action="save"]').click();
      await page.locator('.team-where[data-where="' + vpsId + '"]').waitFor();
      assert.match(await page.locator('.team-head').innerText(), /Roda em vps-teste/);
      await page.locator('.team-card[data-agent="docs"] .team-place').filter({ hasText: 'vps-teste' }).waitFor();
      await page.locator('[data-action="start"]').click();
      // Líder plans on the VPS, Docs writes on the VPS, Líder asks you: each step a job there.
      const t = await until(
        'a pergunta do Líder',
        (s) => {
          const x = s.teams.find((y) => y.id === teamId);
          return x.asks?.some((a) => a.status === 'open') && x;
        },
        60000
      );
      assert.equal(t.tasks[0].title, 'README novo');
      assert.ok(t.messages.some((m) => m.from === 'docs' && m.text === 'README pronto'));
      assert.equal(t.members.find((m) => m.id === 'docs').lastLine, 'Escrevi o README.');
      assert.ok(fs.existsSync(path.join(vpsHome, '.vesta-agents', 'teams', teamId, 'docs')), 'its folder there');
      assert.ok(
        t.members.every((m) => !m.chatId),
        'no chat on this PC'
      );
      await page.locator('.team-card[data-agent="voce"] .team-ask').waitFor();
      await page.waitForTimeout(600);
      await shot('3-equipe-na-vps');
    });

    await step('Mapa: the team on the VPS, your wire crossing to it, the log says which places', async () => {
      await page.locator('.rail-item').filter({ hasText: 'Agents' }).click();
      await page.locator('.agents-views [data-view="places"]').click();
      await page.locator('.places-modes [data-mode="map"]').click();
      const vpsZone = page.locator('.pmap-zone[data-zone="' + vpsId + '"]');
      await vpsZone.waitFor();
      await page.waitForTimeout(1500);
      await vpsZone
        .locator('.pmap-team[data-team="Equipe do site"] .pmap-card[data-node="t:' + teamId + ':lider"]')
        .waitFor();
      await vpsZone.locator('.pmap-card[data-node="t:' + teamId + ':docs"]').waitFor();
      assert.ok((await page.locator('.pmap-wire.cross').count()) >= 2, 'the ssh wire and yours to the lead');
      await page.locator('.pmap-entry .pmap-where.cross').filter({ hasText: 'Este PC → vps-teste' }).first().waitFor();
      await page.waitForTimeout(1200);
      await shot('4-mapa-equipe-dividida');
    });

    await step('offline: a message to Docs waits in the queue and goes when the VPS is back', async () => {
      fs.writeFileSync(down, '');
      await until('a VPS fora do ar', (s) => s.places[0].online === false);
      await page.locator('.rail-item').filter({ hasText: 'Equipes' }).click();
      await page.locator('.team-tile').first().click();
      await page.locator('.team-where.off').first().waitFor();
      await page.locator('.team-say select').selectOption('docs');
      await page.locator('.team-say input').fill('Agora o CHANGELOG.');
      await page.locator('.team-say button').click();
      await page.locator('.team-entry .team-held').first().waitFor();
      assert.match(await page.locator('.team-entry').first().innerText(), /na fila: lugar fora do ar/);
      await page.waitForTimeout(400);
      await shot('5-na-fila');
      await page.locator('.rail-item').filter({ hasText: 'Agents' }).click();
      await page.locator('.agents-views [data-view="places"]').click();
      await page.locator('.places-modes [data-mode="map"]').click();
      await page.locator('.pmap-entry').filter({ hasText: 'na fila: lugar fora do ar' }).first().waitFor();
      await shot('6-mapa-na-fila');
      fs.rmSync(down);
      const t = await until('o CHANGELOG entregue e respondido', (s) => {
        const x = s.teams.find((y) => y.id === teamId);
        return x.messages.some((m) => m.text === 'CHANGELOG pronto') && x;
      });
      const held = t.messages.find((m) => m.text === 'Agora o CHANGELOG.');
      assert.equal(held.held, false);
      assert.ok(held.deliveredAt);
      await page.locator('.pmap-entry').filter({ hasText: 'CHANGELOG pronto' }).first().waitFor();
      await call('teamStop', { id: teamId });
    });
  } finally {
    await app.close();
  }
  console.log('evidências: ' + evidence);
  if (failed) {
    process.exitCode = 1;
    console.log(failed + ' passo(s) falharam');
  } else console.log('Onde rodam (sincronizar) E2E: tudo certo');
})();
