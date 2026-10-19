// REAL attachments E2E: launches the app on a throwaway VESTA_DATA_DIR and talks to the installed CLIs (cheap models).
//   node scripts/test-attachments-e2e.cjs [claude] [codex] [opencode]      (default: every provider that is installed)
// Per provider, in one chat: (1) a PNG with the word VESTA42 -> "what is written?"; (2) a PDF and a TXT with code
// phrases (small, so they also go inline) -> repeat them; (3) a 120 KB log whose phrase is on the last line (too big
// to inline: the agent must read the copied file by its path, outside the project folder).
// Env: VESTA_E2E_CLAUDE_MODEL (default haiku), VESTA_E2E_CODEX_MODEL, VESTA_E2E_OPENCODE_MODEL (default drael/drael-v1).
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { mainWindow } = require('./test-windows.cjs');
const { makePng, makePdf, makeTxt } = require('./att-fixtures.cjs');

const root = path.join(__dirname, '..');
const MODELS = {
  claude: process.env.VESTA_E2E_CLAUDE_MODEL || 'haiku',
  codex: process.env.VESTA_E2E_CODEX_MODEL || '',
  opencode: process.env.VESTA_E2E_OPENCODE_MODEL || 'drael/drael-v1',
};
const TURN_TIMEOUT = 240000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wanted = process.argv.slice(2);
  const dataDir = scratch('att-e2e'),
    files = scratch('att-e2e-files');
  const png = await makePng(path.join(files, 'quadrado.png'), 'VESTA42');
  const pdf = makePdf(path.join(files, 'relatorio.pdf'), 'CODIGO-AZUL-77');
  const txt = makeTxt(path.join(files, 'nota.txt'), 'LUA-VERDE-58');
  const big = path.join(files, 'registro.log');
  fs.writeFileSync(
    big,
    'linha de enchimento sem importancia\n'.repeat(3400) + 'A frase-código final é: ONDA-ROXA-91\n'
  );
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, VESTA_DATA_DIR: dataDir, VESTA_NO_UPDATE: '1', VESTA_NO_USAGE_REFRESH: '1' },
  });
  const results = [];
  try {
    const page = await mainWindow(app);
    await page.waitForSelector('.loading', { state: 'detached' });
    const call = (method, args) => page.evaluate(([m, a]) => window.vesta.call(m, a), [method, args]);
    const boot = await call('bootstrap');
    const installed = Object.entries(boot.integrations)
      .filter(([id, p]) => p.installed && ['claude', 'codex', 'opencode', 'drael'].includes(id))
      .map(([id]) => id);
    const providers = (wanted.length ? wanted : installed).filter((p) => installed.includes(p));
    console.log('installed:', installed.join(', ') || '(none)', '| testing:', providers.join(', '));
    const stage = async (...paths) => {
      const r = await call('attachPaths', { paths });
      assert.deepEqual(r.errors, [], 'attach errors');
      return r.attachments.map((a) => a.id);
    };
    const turn = async (chatId, text, ids) => {
      await call('send', { chatId, text, attachments: ids });
      const end = Date.now() + TURN_TIMEOUT;
      for (;;) {
        await wait(1500);
        const s = (await call('bootstrap')).state;
        if (!s.running.includes(chatId)) {
          const chat = s.chats.find((c) => c.id === chatId);
          const a = chat.messages.at(-1);
          return { reply: a.text || '', status: a.status, error: a.error || '', chat };
        }
        if (Date.now() > end) throw new Error('timeout waiting for the answer');
      }
    };
    for (const provider of providers) {
      const started = Date.now();
      const out = { provider, model: MODELS[provider] || '(padrão)', checks: [] };
      results.push(out);
      const check = (name, ok, detail) => {
        out.checks.push({ name, ok, detail });
        console.log((ok ? 'ok   ' : 'FAIL ') + provider + ' - ' + name + (ok ? '' : ' -> ' + detail));
      };
      try {
        const created = await call('createChat', { provider, model: MODELS[provider], mode: 'read', memory: false });
        const chatId = created.chats[0].id;
        let r = await turn(
          chatId,
          'Qual palavra está escrita na imagem anexa? Responda apenas com a palavra.',
          await stage(png)
        );
        check('imagem PNG: lê "VESTA42"', /vesta\s*42/i.test(r.reply), r.error || r.reply.slice(0, 200));
        const att = r.chat.messages.find((m) => m.attachments).attachments[0];
        check(
          'cópia dentro da pasta de anexos do chat',
          att.path.includes(path.join('attachments', chatId)) && fs.existsSync(att.path),
          att.path
        );
        r = await turn(
          chatId,
          'Anexei um PDF e um TXT. Repita, separadas por vírgula, a frase secreta do PDF e a frase-código do TXT.',
          await stage(pdf, txt)
        );
        check('PDF: repete "CODIGO-AZUL-77"', /codigo-azul-77/i.test(r.reply), r.error || r.reply.slice(0, 200));
        check('TXT: repete "LUA-VERDE-58"', /lua-verde-58/i.test(r.reply), r.error || r.reply.slice(0, 200));
        r = await turn(
          chatId,
          'Leia o arquivo de log anexo (use suas ferramentas de leitura) e repita a frase-código da última linha.',
          await stage(big)
        );
        check(
          'log grande por caminho: repete "ONDA-ROXA-91"',
          /onda-roxa-91/i.test(r.reply),
          r.error || r.reply.slice(0, 200)
        );
        await call('deleteChat', { id: chatId });
        check(
          'excluir o chat apaga a pasta de anexos',
          !fs.existsSync(path.join(dataDir, 'attachments', chatId)),
          'pasta ainda existe'
        );
      } catch (e) {
        check('execução', false, e.message.split('\n')[0]);
      }
      out.seconds = Math.round((Date.now() - started) / 1000);
    }
    console.log('\n=== resumo ===');
    for (const r of results)
      console.log(
        r.provider +
          ' (' +
          r.model +
          ', ' +
          r.seconds +
          's): ' +
          r.checks.filter((c) => c.ok).length +
          '/' +
          r.checks.length +
          ' ok'
      );
    fs.writeFileSync(path.join(files, 'results.json'), JSON.stringify(results, null, 2));
    const failed = results.flatMap((r) => r.checks.filter((c) => !c.ok));
    if (!results.length) console.log('Nenhum provedor instalado para testar.');
    if (failed.length) process.exitCode = 1;
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(files, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
