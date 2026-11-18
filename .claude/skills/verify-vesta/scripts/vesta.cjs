#!/usr/bin/env node
// Abre o VeSTA de verdade (build atual, Electron + Playwright) numa pasta de dados descartável, fora da tela, roda uma
// jornada de usuário e guarda as provas fora da pasta descartável. Comandos:
//   node .claude/skills/verify-vesta/scripts/vesta.cjs doctor
//   node .claude/skills/verify-vesta/scripts/vesta.cjs run <jornada.cjs> [--seed] [--manter]
//   node .claude/skills/verify-vesta/scripts/vesta.cjs cleanup
// Uma jornada é um módulo que exporta `async (v) => {}`; `v` está descrito em abrir() abaixo.
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
// Toda pasta de dados desta skill começa com esta marca; é por ela que a limpeza acha o que a skill abriu.
const MARCA = 'vesta-verify-';
const PROVAS = path.join(os.tmpdir(), 'vesta-evidencias');
const REAL = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'VeSTA');

const claudeProjectName = (dir) => path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-');
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// ---- Processos ------------------------------------------------------------------------------------------------------
// Processos cuja linha de comando cita uma pasta desta skill (o Electron e o ai-memory abertos com ela). Nunca por nome.
function processosDaSkill(trecho = path.join(os.tmpdir(), MARCA)) {
  const alvo = trecho.replace(/'/g, "''");
  const ps =
    "$ErrorActionPreference='SilentlyContinue';" +
    'Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ' +
    "$_.CommandLine.ToLower().Contains('" +
    alvo.toLowerCase() +
    "') } | ForEach-Object { '' + $_.ProcessId + [char]9 + $_.Name }";
  let out = '';
  try {
    out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  } catch {}
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [pid, nome] = l.split('\t');
      return { pid: Number(pid), nome };
    })
    .filter((p) => p.pid && p.pid !== process.pid);
}
function encerrar(procs) {
  for (const p of procs)
    try {
      execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {}
}
function apagarPasta(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
  // As sessões que o Claude Code gravou para essa pasta (uma pasta por diretório de trabalho).
  const projects = path.join(os.homedir(), '.claude', 'projects'),
    prefix = claudeProjectName(dir);
  let nomes = [];
  try {
    nomes = fs.readdirSync(projects);
  } catch {}
  for (const n of nomes)
    if (n === prefix || n.startsWith(prefix + '-'))
      try {
        fs.rmSync(path.join(projects, n), { recursive: true, force: true });
      } catch {}
}

// ---- Abrir o app ----------------------------------------------------------------------------------------------------
async function abrir({ nome = 'jornada', seed = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), MARCA + nome + '-'));
  if (path.resolve(dataDir).toLowerCase().startsWith(path.resolve(REAL).toLowerCase()))
    throw new Error('pasta de dados aponta para os dados reais: ' + dataDir);
  if (seed) require(path.join(ROOT, 'scripts', 'seed-store.cjs')).seedStore(dataDir);
  const provas = path.join(PROVAS, carimbo() + '-' + nome);
  fs.mkdirSync(provas, { recursive: true });

  const { _electron: electron } = require(require.resolve('playwright', { paths: [ROOT] }));
  const { mainWindow } = require(path.join(ROOT, 'scripts', 'test-windows.cjs'));
  const env = {
    ...process.env,
    VESTA_DATA_DIR: dataDir,
    VESTA_TEST_BACKGROUND: '1', // fora da tela, sem foco e sem barra de tarefas
    VESTA_NO_UPDATE: '1',
    VESTA_NO_USAGE_REFRESH: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: require(require.resolve('electron', { paths: [ROOT] })),
    args: [ROOT],
    cwd: ROOT,
    env,
  });
  const page = await mainWindow(app);
  const problemas = [],
    passos = [];
  page.on('console', (m) => m.type() === 'error' && problemas.push('console: ' + m.text()));
  page.on('pageerror', (e) => problemas.push('pageerror: ' + e.message));
  await page.waitForSelector('.app-shell', { timeout: 30000 });
  await page.waitForSelector('.loading', { state: 'detached', timeout: 30000 });

  const v = {
    app,
    page,
    dataDir,
    provas,
    problemas,
    passos,
    // Captura de tela nomeada, dentro da pasta de provas.
    foto: async (n) => {
      await page.waitForTimeout(300);
      const arq = path.join(provas, String(passos.length).padStart(2, '0') + '-' + n + '.png');
      await page.screenshot({ path: arq });
      return arq;
    },
    // Um passo com nome: entra no relatório como ok ou FALHOU.
    passo: async (n, fn) => {
      try {
        await fn();
        passos.push('ok - ' + n);
        console.log('ok -', n);
      } catch (e) {
        passos.push('FALHOU - ' + n + ': ' + e.message.split('\n')[0]);
        e.message = 'passo "' + n + '": ' + e.message;
        throw e;
      }
    },
    // Lê o estado que o processo principal guarda (a mesma ponte que a interface usa).
    call: (metodo, args) => page.evaluate(([m, a]) => window.vesta.call(m, a), [metodo, args]),
    // A janela nativa de "escolher pasta" não é dirigível: a próxima resposta dela passa a ser `dir`.
    escolherPasta: (dir) =>
      app.evaluate(({ dialog }, d) => {
        const original = dialog.showOpenDialog;
        dialog.showOpenDialog = async () => {
          dialog.showOpenDialog = original;
          return { canceled: false, filePaths: [d] };
        };
      }, dir),
  };
  return v;
}

async function fechar(v, { manter = false } = {}) {
  await v.app.close().catch(() => {});
  encerrar(processosDaSkill(v.dataDir)); // o que sobrou dessa instância (ex.: ai-memory)
  if (!manter) apagarPasta(v.dataDir);
}

// ---- Comandos -------------------------------------------------------------------------------------------------------
function maisNovo(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? maisNovo(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}
function doctor() {
  const linhas = [],
    erros = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  linhas.push('VeSTA ' + pkg.version + ' em ' + ROOT);
  for (const dep of ['electron', 'playwright'])
    try {
      require.resolve(dep, { paths: [ROOT] });
    } catch {
      erros.push(dep + ' não instalado: rode npm install');
    }
  const dist = path.join(ROOT, 'dist', 'index.html');
  if (!fs.existsSync(dist)) erros.push('sem dist/: rode npm run build');
  else {
    const build = fs.statSync(dist).mtimeMs,
      fonte = Math.max(maisNovo(path.join(ROOT, 'src')), maisNovo(path.join(ROOT, 'electron', 'shared')));
    if (fonte > build) erros.push('dist/ é mais antigo que src/: rode npm run build (a janela carrega dist/)');
    else linhas.push('build em dia (' + new Date(build).toLocaleString('pt-BR') + ')');
  }
  const sobras = processosDaSkill();
  if (sobras.length)
    erros.push(
      'processos de verificações anteriores ainda vivos: ' +
        sobras.map((p) => p.nome + ' ' + p.pid).join(', ') +
        ' (rode cleanup)'
    );
  else linhas.push('nenhuma instância de verificação viva');
  linhas.push('provas ficam em ' + PROVAS);
  for (const l of linhas) console.log('ok -', l);
  for (const e of erros) console.log('PROBLEMA -', e);
  process.exitCode = erros.length ? 1 : 0;
}

async function run(arquivo, { seed, manter }) {
  if (!arquivo) throw new Error('uso: vesta.cjs run <jornada.cjs> [--seed] [--manter]');
  const jornada = require(path.resolve(arquivo));
  const nome = path.basename(arquivo, path.extname(arquivo));
  const v = await abrir({ nome, seed });
  let erro = null;
  try {
    await jornada(v);
    await v.page.waitForTimeout(300);
    if (v.problemas.length) throw new Error('a interface registrou erros:\n' + v.problemas.join('\n'));
  } catch (e) {
    erro = e;
    await v.foto('falha').catch(() => {});
  }
  const relatorio = [
    '# ' + nome + ': ' + (erro ? 'FALHOU' : 'ok'),
    '',
    ...v.passos.map((p) => '- ' + p),
    erro ? '\n```\n' + erro.message + '\n```' : '',
    v.problemas.length ? '\nErros da interface:\n' + v.problemas.map((p) => '- ' + p).join('\n') : '',
    '\nPasta de dados: ' + v.dataDir + (manter || erro ? ' (mantida)' : ' (apagada)'),
  ].join('\n');
  fs.writeFileSync(path.join(v.provas, 'relatorio.md'), relatorio);
  await fechar(v, { manter: manter || !!erro });
  console.log((erro ? 'FALHOU' : 'ok') + ' - provas em ' + v.provas);
  if (erro) {
    console.error(erro.message);
    process.exitCode = 1;
  }
}

function cleanup() {
  const procs = processosDaSkill();
  encerrar(procs);
  let pastas = 0;
  for (const n of fs.readdirSync(os.tmpdir()))
    if (n.startsWith(MARCA)) {
      apagarPasta(path.join(os.tmpdir(), n));
      pastas++;
    }
  console.log('encerrados ' + procs.length + ' processos e apagadas ' + pastas + ' pastas de dados; provas mantidas');
}

module.exports = { abrir, fechar, processosDaSkill, ROOT, PROVAS };

if (require.main === module) {
  const [cmd, arq, ...resto] = process.argv.slice(2);
  const flags = { seed: resto.includes('--seed') || arq === '--seed', manter: resto.includes('--manter') };
  const comandos = { doctor, cleanup, run: () => run(arq, flags) };
  if (!comandos[cmd]) {
    console.error('uso: vesta.cjs doctor | run <jornada.cjs> [--seed] [--manter] | cleanup');
    process.exit(2);
  }
  Promise.resolve(comandos[cmd]()).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
