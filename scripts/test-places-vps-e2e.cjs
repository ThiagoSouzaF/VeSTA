// E2E (Electron offscreen, a fake VPS, no real network): Onde rodam, fase 2.
//   1. "Conectar uma VPS": the steps with their commands, then each one's result; the VPS becomes a place
//   2. "Instalar agents aqui" on the VPS: the runner and the agent go there by SSH; a project agent is warned that the
//      project stays on the PC; the cards say where it runs
//   3. a run there comes back to the diary (lesson waiting for a yes); "Rodar agora" starts one there, which fails (its
//      AI cannot start on the fake) and is marked
//   4. Mapa: this PC with "VeSTA aberto" and the team, the VPS with its agent, the ssh wire, the log of what passed
//   5. offline: the last list stays, marked; the cards, the list and the map say "fora do ar"
//   6. "Esquecer este lugar": its agents come out of the VPS and run with VeSTA open again
// The VPS is scripts/fake-ssh.cjs: ssh's arguments in, the command run by Git Bash in a throwaway HOME. Its AIs are
// only the fakes of its bin folder, never the real ones of this PC. Needs a fresh `npm run build`.
// Usage: node scripts/test-places-vps-e2e.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { mainWindow } = require('./test-windows.cjs');

const root = path.join(__dirname, '..');
const data = scratch('places-vps');
const vpsHome = path.join(data, 'vps', 'home');
const vpsBin = path.join(data, 'vps', 'bin');
const down = path.join(data, 'vps', 'vps-down');
const evidence = path.join(data, 'evidencias');
const projectDir = path.join(data, 'projeto-site');
for (const d of [vpsHome, vpsBin, evidence, projectDir]) fs.mkdirSync(d, { recursive: true });
// The VPS's "Claude": a file that exists (so the probe finds it) but cannot start here.
fs.writeFileSync(path.join(vpsBin, 'claude'), '#!/bin/sh\necho fake\n');
const agentsDir = path.join(vpsHome, '.vesta-agents', 'agents');
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
const member = (id, name, role, provider, extra = {}) => ({
  id,
  name,
  role,
  provider,
  model: '',
  mode: 'read',
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
      agent('a-logs', 'Logs da VPS', 'Leia o journal das últimas 2 h e avise só se houver erro novo.', {
        projectId: 'p1',
      }),
      agent('a-faxina', 'Faxina da memória', 'Procure páginas repetidas na memória.'),
    ],
    teams: [
      {
        id: 't1',
        name: 'Equipe do site',
        projectId: 'p1',
        goal: 'Tela de agendamentos',
        members: [
          member('lid', 'Líder', 'organiza', 'claude', { lead: true }),
          member('dev', 'Dev', 'escreve o código', 'codex'),
        ],
        maxParallel: 2,
        budget: 0,
        maxTurns: 40,
        status: 'idle',
        tasks: [],
        messages: [{ id: 'm1', at: now - 60000, from: 'voce', to: 'lid', kind: 'task', text: 'Tela de agendamentos.' }],
        asks: [],
        spent: {},
        turns: 0,
        createdAt: now,
        updatedAt: now,
      },
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
      VESTA_AGENTS_HOME: path.join(data, 'pc-agents'),
      VESTA_AGENT_SCHEDULER: 'none',
      VESTA_SSH: JSON.stringify({
        exe: process.execPath,
        args: [path.join(__dirname, 'fake-ssh.cjs'), vpsHome, vpsBin],
      }),
      VESTA_PLACES_SYNC_MS: '700',
      VESTA_REMOTE_SYNC_MS: '1500',
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
    const until = async (what, pred, ms = 20000) => {
      for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(300)) {
        const v = pred(await state());
        if (v) return v;
      }
      throw new Error('timeout esperando ' + what);
    };
    const shot = (name) => page.screenshot({ path: path.join(evidence, name + '.png') });
    const row = (name) => page.locator('.place-table tbody tr').filter({ hasText: name });
    const pick = (name) => page.locator('.place-pick').filter({ hasText: name });
    let vpsId;

    await step('Conectar uma VPS: the steps and their commands, then the place', async () => {
      await page.locator('.rail-item').filter({ hasText: 'Agents' }).click();
      await page.locator('.agents-views [data-view="places"]').click();
      await page.getByRole('button', { name: 'Conectar uma VPS' }).click();
      const drawer = page.locator('.place-drawer');
      await drawer.locator('.pc-steps li').first().waitFor();
      assert.equal(await drawer.locator('.pc-steps li').count(), 5);
      await drawer.locator('.pc-field').filter({ hasText: 'NOME' }).locator('input').fill('vps-teste');
      await drawer
        .locator('.pc-field')
        .filter({ hasText: 'USUÁRIO@SERVIDOR' })
        .locator('input')
        .fill('thiago@203.0.113.10');
      assert.match(await drawer.locator('.pc-steps').innerText(), /ssh thiago@203\.0\.113\.10 "uname -a"/);
      await page.waitForTimeout(1500); // the drawer slides in (slow offscreen)
      await shot('1-conectar-antes');
      await drawer.getByRole('button', { name: 'Testar e conectar' }).click();
      await drawer.getByRole('button', { name: 'Ver o lugar' }).waitFor({ timeout: 30000 });
      const steps = await drawer.locator('.pc-steps li').evaluateAll((els) => els.map((e) => e.className));
      assert.deepEqual(steps, ['ok', 'ok', 'ok', 'warn', 'ok'], 'no systemd on the fake: a warning, not an error');
      assert.match(await drawer.innerText(), /Sem systemd/);
      await shot('2-conectar-depois');
      await drawer.getByRole('button', { name: 'Ver o lugar' }).click();
      await page.locator('.place-head h2').filter({ hasText: 'vps-teste' }).waitFor();
      assert.ok(fs.existsSync(path.join(vpsHome, '.vesta-agents', 'runner', 'vesta-agent.cjs')));
      assert.ok(fs.existsSync(path.join(vpsHome, '.vesta-agents', 'runner', 'vesta-agent')));
      vpsId = (await state()).places[0].id;
      assert.match(await page.locator('.place-ai[data-ai="claude"]').innerText(), /encontrada/);
      assert.match(await page.locator('.place-ai[data-ai="drael"]').innerText(), /só no Windows/);
      await page.locator('.place-cmds').getByText('ssh thiago@203.0.113.10').waitFor();
      await shot('3-vps-vazia');
    });

    await step('install on the VPS: by SSH, the project warning, the card says vps-teste', async () => {
      await page.getByRole('button', { name: 'Instalar agents aqui' }).click();
      const modal = page.locator('.place-install');
      await modal.waitFor();
      await modal.locator('.pi-tile[data-tile="Logs da VPS"]').click();
      await modal.locator('.pi-side').getByText('O projeto fica neste PC').waitFor();
      await modal
        .getByRole('button', { name: /^Instalar/ })
        .last()
        .click();
      await modal.waitFor({ state: 'detached', timeout: 30000 });
      await row('Logs da VPS').waitFor();
      const json = JSON.parse(fs.readFileSync(path.join(agentsDir, 'logs-da-vps', 'agent.json'), 'utf8'));
      assert.equal(json.cwd, null, 'no project folder of the PC on the VPS');
      assert.equal(json.projectName, 'Site');
      const s = await state();
      assert.equal(s.agents.find((a) => a.id === 'a-logs').places[vpsId].slug, 'logs-da-vps');
      await shot('4-vps-instalado');
    });

    await step('a run on the VPS comes back; Rodar agora runs there and its failure is marked', async () => {
      // What the timer there would have written.
      const t = Date.now() - 5000;
      fs.writeFileSync(
        path.join(agentsDir, 'logs-da-vps', 'runs', String(t).padStart(14, '0') + '-run-1.json'),
        JSON.stringify({
          id: 'run-1',
          at: t,
          endedAt: t + 3000,
          trigger: 'schedule',
          status: 'ok',
          summary: 'Nenhum erro novo no journal.',
          error: '',
          text: 'Resumo: Nenhum erro novo no journal.\nLição: o nginx reinicia às 04:00; ignore esse aviso.',
          lessons: [],
          usage: { input: 10, cached: 900, output: 40 },
          provider: 'claude',
          hash: json0().hash,
        })
      );
      const a = await until('a execução da VPS no diário', (s) => {
        const x = s.agents.find((y) => y.id === 'a-logs');
        return x.runs?.[0]?.id === 'run-1' && x;
      });
      assert.equal(a.runs[0].place, vpsId);
      assert.deepEqual(
        a.lessons.map((l) => [l.text, l.status]),
        [['o nginx reinicia às 04:00; ignore esse aviso.', 'pending']]
      );
      await row('Logs da VPS').getByRole('button', { name: 'Rodar agora' }).click();
      const b = await until(
        'a execução pedida',
        (s) => {
          const x = s.agents.find((y) => y.id === 'a-logs');
          return x.runs?.[0]?.trigger === 'manual' && x;
        },
        40000
      );
      assert.equal(b.runs[0].status, 'error', "the fake's Claude cannot start: the run is a failure, brought back");
      await page.getByRole('button', { name: 'Atualizar a lista' }).click();
      await row('Logs da VPS').locator('.place-bad').waitFor();
      await pick('vps-teste').locator('.place-bad').waitFor();
      await shot('5-vps-falhou');
      await page.locator('.agents-views [data-view="agents"]').click();
      const chip = page.locator('.agent-card[data-agent="Logs da VPS"] .agent-loc[data-where="' + vpsId + '"]');
      await chip.waitFor();
      assert.match(await chip.innerText(), /vps-teste/);
      await page.locator('.agents-where [data-where="' + vpsId + '"]').click();
      assert.equal(await page.locator('.agent-card[data-agent]').count(), 1);
      await page.locator('.agents-where [data-where="all"]').click();
      await page.locator('.agents-views [data-view="places"]').click();
    });

    await step(
      'Mapa: this PC with the team and VeSTA aberto, the VPS with its agent, the ssh wire, the log',
      async () => {
        await page.locator('.places-modes [data-mode="map"]').click();
        await page.locator('.pmap-zone[data-zone="pc"]').waitFor();
        const vpsZone = page.locator('.pmap-zone[data-zone="' + vpsId + '"]');
        await vpsZone.locator('.pmap-card[data-node="a:a-logs:' + vpsId + '"]').waitFor();
        assert.equal(
          await vpsZone.locator('.pmap-card').first().getAttribute('data-state'),
          'error',
          'its last run failed'
        );
        await page.locator('.pmap-team[data-team="Equipe do site"] .pmap-card').nth(1).waitFor();
        await page.locator('.pmap-card[data-node="a:a-faxina:vesta"]').waitFor();
        await page.locator('.pmap-wire.cross text').filter({ hasText: 'ssh' }).waitFor();
        assert.ok((await page.locator('.pmap-wire').count()) >= 3, 'the team wires and the ssh one');
        await page.locator('.pmap-entry').filter({ hasText: 'Logs da VPS → Você' }).first().waitFor();
        // A new team message shows up in the log (and travels, if the window draws).
        await app.evaluate(
          (_, dir) => {
            const ctx = process.mainModule.require(dir + '/main.cjs').ctx;
            const t = ctx.store.state.teams[0];
            t.messages.push({ id: 'm2', at: Date.now(), from: 'lid', to: 'dev', kind: 'task', text: 'T1: endpoint.' });
            ctx.sync();
          },
          path.join(root, 'electron')
        );
        await page.locator('.pmap-entry').filter({ hasText: 'T1: endpoint.' }).waitFor();
        await page.waitForTimeout(1200);
        await shot('6-mapa');
      }
    );

    await step('offline: the last list stays, marked, in the list, the cards and the map', async () => {
      fs.writeFileSync(down, '');
      await page.locator('.places-modes [data-mode="list"]').click();
      await pick('vps-teste').click();
      await page.getByRole('button', { name: 'Atualizar a lista' }).click();
      await page.locator('.place-offline').waitFor();
      assert.match(await page.locator('.place-offline').innerText(), /Connection timed out/);
      await row('Logs da VPS').waitFor();
      assert.equal(await row('Logs da VPS').getByRole('button', { name: 'Rodar agora' }).isDisabled(), true);
      await pick('vps-teste').getByText('fora do ar').first().waitFor();
      await shot('7-fora-do-ar');
      await page.locator('.places-modes [data-mode="map"]').click();
      await page.locator('.pmap-zone.off[data-zone="' + vpsId + '"]').waitFor();
      await page.locator('.pmap-wire.down text').filter({ hasText: '✕ ssh' }).waitFor();
      await page.waitForTimeout(800);
      await shot('8-mapa-fora-do-ar');
      await page.locator('.agents-views [data-view="agents"]').click();
      await page.locator('.agent-card[data-agent="Logs da VPS"] .agent-loc.off').getByText('fora do ar').waitFor();
      await page.locator('.agents-views [data-view="places"]').click();
    });

    await step('Esquecer este lugar: its agents leave the VPS and run with VeSTA open again', async () => {
      fs.rmSync(down);
      await page.locator('.places-modes [data-mode="list"]').click();
      await pick('vps-teste').click();
      await page.getByRole('button', { name: 'Esquecer este lugar' }).click();
      const drawer = page.locator('.place-drawer');
      assert.match(await drawer.innerText(), /Logs da VPS/);
      await drawer.getByRole('button', { name: 'Esquecer', exact: true }).click();
      await page.locator('.place-head h2').filter({ hasText: 'Este PC' }).waitFor({ timeout: 30000 });
      assert.equal(await pick('vps-teste').count(), 0);
      const s = await state();
      assert.equal(s.places.length, 0);
      const logs = s.agents.find((a) => a.id === 'a-logs');
      assert.deepEqual(logs.places, {});
      assert.ok(logs.runs.length >= 2, 'its runs stay in the diary');
      assert.equal(fs.existsSync(path.join(agentsDir, 'logs-da-vps')), false);
    });
    await call('placesView');
  } finally {
    await app.close();
  }
  console.log('evidências: ' + evidence);
  if (failed) {
    process.exitCode = 1;
    console.log(failed + ' passo(s) falharam');
  } else console.log('Onde rodam (VPS) E2E: tudo certo');
})();

function json0() {
  return JSON.parse(fs.readFileSync(path.join(agentsDir, 'logs-da-vps', 'agent.json'), 'utf8'));
}
