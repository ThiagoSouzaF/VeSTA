const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const { plainCommand } = require('./permissions.cjs');
const { codexRateLimits } = require('./usage.cjs');
const path = require('node:path');
const os = require('node:os');
const { capList, taskStatus, MAX_STEPS, MAX_ACTIVITIES } = require('./tasks.cjs');
function locate(name) {
  if (name === 'drael') return require('./drael.cjs').locate();
  const home = os.homedir(),
    local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const names = name === 'opencode' ? ['opencode.exe'] : [name + '.exe'];
  const candidates = (process.env.PATH || '')
    .split(path.delimiter)
    .flatMap((dir) => names.map((n) => path.join(dir, n)));
  candidates.push(path.join(home, '.local', 'bin', name + '.exe'));
  if (name === 'opencode')
    for (const dir of [
      path.dirname(process.env.NODE_EXE || 'C:\\Program Files\\nodejs\\node.exe'),
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm'),
    ].filter(Boolean))
      candidates.push(path.join(dir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
  if (name === 'codex') {
    const base = path.join(local, 'OpenAI', 'Codex', 'bin');
    try {
      for (const d of fs.readdirSync(base).reverse()) candidates.push(path.join(base, d, 'codex.exe'));
    } catch {}
  }
  return candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}
function run(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (!exe) return reject(new Error('Programa não encontrado'));
    const child = spawn(exe, args, { windowsHide: true, shell: false, ...options });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => {
      kill(child);
      reject(new Error('O programa demorou para responder'));
    }, options.timeout || 20000);
    child.stdout.on('data', (b) => (stdout = (stdout + b).slice(-1000000)));
    child.stderr.on('data', (b) => (stderr = (stderr + b).slice(-10000)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout || 'Erro ' + code));
    });
    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(options.input || '');
    }
  });
}
function kill(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32')
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else child.kill('SIGTERM');
}
// MCP servers are registered per launch (flags/env), never in ~/.claude, ~/.codex or the global OpenCode config.
// Two servers can be present: the AI Memory (vesta-memory) and, in the quest's own chat, vesta-quest.
const MEMORY_SERVER = 'vesta-memory',
  MEMORY_TOKEN_ENV = 'VESTA_MEMORY_TOKEN',
  QUEST_SERVER = 'vesta-quest',
  QUEST_TOKEN_ENV = 'VESTA_QUEST_TOKEN';
// A server entry: { name, url, token, tokenEnv }. The helpers turn the endpoints the main process holds into entries.
const memoryServer = (endpoint) =>
  endpoint && { name: MEMORY_SERVER, url: endpoint.mcp, token: endpoint.token, tokenEnv: MEMORY_TOKEN_ENV };
const questServer = (endpoint) =>
  endpoint && { name: QUEST_SERVER, url: endpoint.mcp, token: endpoint.token, tokenEnv: QUEST_TOKEN_ENV };
// One or more servers for a provider -> { args, env }. The tokens travel by environment; each CLI expands them into the
// Authorization header itself, so they never appear on a command line.
function mcpTools(provider, servers) {
  servers = (servers || []).filter(Boolean);
  if (!servers.length) return { args: [], env: {} };
  const env = Object.fromEntries(servers.map((x) => [x.tokenEnv, x.token]));
  if (provider === 'claude')
    return {
      env,
      args: [
        '--mcp-config',
        JSON.stringify({
          mcpServers: Object.fromEntries(
            servers.map((x) => [
              x.name,
              { type: 'http', url: x.url, headers: { Authorization: 'Bearer ${' + x.tokenEnv + '}' } },
            ])
          ),
        }),
        '--allowedTools',
        ...servers.map((x) => 'mcp__' + x.name),
      ],
    };
  if (provider === 'codex')
    return {
      env,
      args: servers.flatMap((x) => {
        const key = 'mcp_servers.' + x.name + '.';
        return [
          '-c',
          key + 'url="' + x.url + '"',
          '-c',
          key + 'bearer_token_env_var="' + x.tokenEnv + '"',
          '-c',
          key + 'default_tools_approval_mode="approve"',
        ];
      }),
    };
  return {
    args: [],
    env: {
      ...env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        mcp: Object.fromEntries(
          servers.map((x) => [
            x.name,
            {
              type: 'remote',
              url: x.url,
              enabled: true,
              oauth: false,
              headers: { Authorization: 'Bearer {env:' + x.tokenEnv + '}' },
            },
          ])
        ),
      }),
    },
  };
}
// The AI Memory alone (kept for callers and tests that only know the memory endpoint).
const LEAD_DENIED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor'];
const memoryTools = (provider, endpoint) => mcpTools(provider, [memoryServer(endpoint)]);
// Tells the agent which scope is its own: tool calls without workspace/project would land in the server's default (inbox).
// `mode`: 'read' (consultation) never asks to write; edit/ask also teach durable preferences ("profile"). Subagents often
// have a fixed tool list without the memory tools, so the agent itself consults before delegating.
const PROFILE_CATEGORIES = ['stack', 'architecture', 'workflow', 'testing', 'tools', 'style', 'habits'];
function memoryHint(projectId, { mode = 'edit', handoff = false } = {}) {
  const project = projectId || 'inbox';
  const lines = [
    'Você tem acesso à memória compartilhada do VeSTA pelas ferramentas MCP do servidor "' +
      MEMORY_SERVER +
      '" (AI Memory). Nelas, passe workspace "vesta" e project "' +
      project +
      '" (exceto nas gravações com scope "profile", que valem para todos os projetos e não levam workspace/project).',
    'No início da conversa, consulte com memory_query decisões, fatos e preferências relevantes. Antes de delegar a um subagente, consulte a memória você mesmo e repasse no prompt dele o contexto relevante: subagentes com lista de ferramentas própria podem não ter acesso à memória. Se o subagente tiver acesso, mande-o usar workspace "vesta" e project "' +
      project +
      '".',
  ];
  if (handoff)
    lines.push(
      'Esta conversa veio de outra IA: se houver uma passagem de contexto pendente que você não viu, use memory_handoff_accept (workspace "vesta", project "' +
        project +
        '").'
    );
  if (mode === 'read')
    lines.push(
      'Modo consulta: apenas consulte a memória. Não grave nada, nem preferências; se algo merecer registro, diga ao usuário.'
    );
  else
    lines.push(
      'Use memory_write_page para registrar decisões, fatos e lições duráveis deste projeto (caminhos como "agentes/<assunto>.md"); tags e entities são listas (arrays), por exemplo tags: ["decisao"], entities: ["VeSTA"]. Não grave segredos nem trechos longos de código.',
      'Quando o usuário expressar uma preferência durável (como gosta de trabalhar, stack, estilo, ferramentas, idioma), grave-a no perfil: memory_write_page com scope "profile" e path "<categoria>/<assunto>.md" (categorias: ' +
        PROFILE_CATEGORIES.join(', ') +
        '; sem o prefixo profile/), uma preferência por página, o corpo começando com "# Título" e a frase da preferência na linha seguinte. Antes, consulte (memory_query) se o assunto já existe: se existir, atualize a mesma página (expected_page_id da leitura) em vez de duplicar; para uma nova, use create_only true. Só preferências que o usuário disse de fato, nunca suposições.'
    );
  return lines.join(' ');
}
// Chat modes: 'edit' = full access, 'ask' = the agent asks the user before acting, 'read' = consultation only.
const MODES = ['ask', 'edit', 'read'];
const modeOf = (chat) => (MODES.includes(chat.mode) ? chat.mode : 'edit');
// How each CLI is launched. Claude speaks stream-json both ways (its permission requests arrive on stdout and are
// answered on stdin); Codex runs its app-server (JSON-RPC with approval requests); OpenCode runs its HTTP server.
// `endpoint` = AI Memory; `extra` = more MCP servers (entries, see questServer), e.g. the quest chat's own.
function command(chat, exe, endpoint, { attachDir = null, extra = [] } = {}) {
  const servers = [memoryServer(endpoint), ...extra].filter(Boolean);
  if (chat.provider === 'drael') return require('./drael.cjs').command(chat, exe, servers);
  const mode = modeOf(chat),
    mem = mcpTools(chat.provider, servers);
  if (chat.provider === 'codex') {
    const policy =
      mode === 'ask'
        ? { approvalPolicy: 'on-request', sandbox: 'read-only' }
        : { approvalPolicy: 'never', sandbox: mode === 'edit' ? 'danger-full-access' : 'read-only' };
    return {
      exe,
      args: ['app-server', ...mem.args],
      env: mem.env,
      thread: { ...policy, ...(chat.model ? { model: chat.model } : {}) },
      resume: chat.sessionId || null,
    };
  }
  if (chat.provider === 'claude') {
    // Even with full access, Claude still asks before touching protected files (settings, .git): those go to the user too.
    // The quest chat is read-only too, but it must act on the quest through its MCP tools. Claude's plan mode makes the
    // model itself refuse any action ("plan mode is active"), so there it runs in the default mode with every tool that
    // edits or executes denied and no prompt channel: anything not allowed (the MCP tools) is refused outright.
    const lead = mode === 'read' && servers.some((x) => x.name === QUEST_SERVER);
    const permission = lead
      ? ['--permission-mode', 'default', '--disallowedTools', ...LEAD_DENIED_TOOLS]
      : mode === 'read'
        ? ['--permission-mode', 'plan', '--permission-prompts', 'none']
        : ['--permission-mode', mode === 'edit' ? 'bypassPermissions' : 'default', '--permission-prompt-tool', 'stdio'];
    return {
      exe,
      args: [
        '--print',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        ...permission,
        ...mem.args,
        // The chat's attachments live outside the project folder: let Claude read them without asking.
        ...(attachDir && require('node:fs').existsSync(attachDir) ? ['--add-dir', attachDir] : []),
        ...(chat.model ? ['--model', chat.model] : []),
        ...(chat.sessionId ? ['--resume', chat.sessionId] : []),
      ],
      env: mem.env,
    };
  }
  const permission =
    mode === 'read'
      ? { edit: 'deny', bash: 'deny', webfetch: 'allow', question: 'deny' }
      : mode === 'ask'
        ? { edit: 'ask', bash: 'ask', webfetch: 'ask', external_directory: 'ask', question: 'deny' }
        : { edit: 'allow', bash: 'allow', webfetch: 'allow', question: 'deny' };
  // The chat's attachments live outside the project: the agent may read exactly that folder without asking.
  if (attachDir && require('node:fs').existsSync(attachDir))
    permission.external_directory = { '*': 'ask', [attachDir.replaceAll('\\', '/') + '/*']: 'allow' };
  const slash = chat.model ? chat.model.indexOf('/') : -1;
  return {
    exe,
    args: ['serve', '--hostname', '127.0.0.1'],
    env: { ...mem.env, OPENCODE_PERMISSION: JSON.stringify(permission) },
    model: slash > 0 ? { providerID: chat.model.slice(0, slash), modelID: chat.model.slice(slash + 1) } : null,
    agent: mode === 'read' ? 'plan' : chat.agent || 'build',
    resume: chat.sessionId || null,
  };
}
const detailOf = (i) => i.command || i.file_path || i.path || i.pattern || i.url || i.query || i.description || '';
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// Tool name -> visual kind of the activity card.
function toolKind(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes(MEMORY_SERVER) || n.includes('vesta_memory')) return 'memory';
  if (n.startsWith('mcp__') || n.startsWith('mcp_')) return 'mcp';
  if (n === 'monitor') return 'monitor';
  if (/^(bash|shell|powershell|command|exec|run$)/.test(n)) return 'command';
  if (/^(read|write|edit|multiedit|notebookedit|patch|apply_patch|file)/.test(n)) return 'file';
  if (/^(grep|glob|list|ls|find|search|toolsearch)/.test(n)) return 'search';
  if (/^(web|fetch|browser)/.test(n)) return 'web';
  if (/^(todo|task_?create|task_?update)/.test(n)) return 'todo';
  return 'tool';
}
// Memory tools read as "Memória · memory_query" instead of the raw MCP-qualified name.
const questTool = (n) => new RegExp(QUEST_SERVER + '_+([\\w-]+)$').exec(n)?.[1];
const toolLabel = (name) => {
  const n = String(name || '');
  if (questTool(n)) return 'Quest · ' + questTool(n);
  if (toolKind(n) !== 'memory') return 'Usando ' + n;
  const i = n.lastIndexOf('memory_'),
    tool = i >= 0 ? n.slice(i) : n;
  return 'Memória · ' + tool;
};
const textOf = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c
          .map((x) => (typeof x === 'string' ? x : x?.text || ''))
          .filter(Boolean)
          .join('\n')
      : c && c.text
        ? c.text
        : '';
// Strips the harness frame Claude Code wraps around a subagent report and its per-line indentation.
const unframe = (s) => {
  const m = /The report follows:\s*\n/i.exec(s);
  if (!m) return s;
  return s
    .slice(m.index + m[0].length)
    .split('\n')
    .map((l) => l.replace(/^ {2}/, ''))
    .join('\n');
};
const summarize = (v) => clip(unframe(textOf(v).replace(/^\s*\[Subagent hand-back\]\s*/i, '')).trim(), 4000);
// Normalizes a rate-limit window: utilization 0..1, resetsAt in epoch milliseconds (accepts seconds, ms or ISO).
function normWindow(w) {
  if (!w || typeof w !== 'object') return null;
  const rawU = w.utilization ?? w.used_percentage ?? w.usedPercentage ?? w.usedPercent ?? w.percent;
  const rawR = w.resetsAt ?? w.resets_at ?? w.resetAt ?? w.reset_at ?? w.resetsAtMs;
  let u = rawU == null || rawU === '' ? null : Number(rawU);
  if (u != null && !Number.isFinite(u)) u = null;
  if (u != null) {
    if (u > 1) u /= 100;
    u = Math.min(1, Math.max(0, u));
  }
  let r = null;
  if (rawR != null && rawR !== '') {
    r = typeof rawR === 'string' && Number.isNaN(Number(rawR)) ? Date.parse(rawR) : Number(rawR);
    if (!Number.isFinite(r)) r = null;
    else if (r < 1e11) r = Math.round(r * 1000);
  }
  if (u == null && r == null) return null;
  return { utilization: u, resetsAt: r };
}
function rateWindows(info) {
  const out = { fiveHour: null, sevenDay: null };
  if (!info || typeof info !== 'object') return out;
  const put = (name, w) => {
    const key = /five|5/i.test(name) ? 'fiveHour' : /seven|week|7/i.test(name) ? 'sevenDay' : null;
    if (!key) return;
    const n = normWindow(w);
    if (n) out[key] = n;
  };
  const wins = info.unifiedWindows || info.unified_windows || info.windows;
  if (wins && typeof wins === 'object') for (const [k, v] of Object.entries(wins)) put(k, v);
  for (const k of ['five_hour', 'fiveHour', 'seven_day', 'sevenDay']) if (info[k]) put(k, info[k]);
  // The top-level window only fills a gap: it often carries resetsAt without utilization.
  const type = info.rateLimitType || info.rate_limit_type;
  if (type) {
    const before = { ...out };
    put(String(type), info);
    for (const k of ['fiveHour', 'sevenDay']) if (before[k]) out[k] = before[k];
  }
  return out;
}
// One Codex app-server item -> activity fields (label, detail, kind, status); null for items shown elsewhere.
function codexItem(it, done) {
  const status = !done ? 'running' : ['failed', 'declined'].includes(it.status) ? 'error' : 'done';
  if (it.type === 'commandExecution')
    return {
      label: done ? (it.status === 'declined' ? 'Comando negado' : 'Comando concluído') : 'Executando comando',
      detail: plainCommand(it.command),
      kind: 'command',
      status,
      ...(done && it.aggregatedOutput ? { result: clip(it.aggregatedOutput, 600) } : {}),
    };
  if (it.type === 'fileChange')
    return {
      label: done ? (it.status === 'declined' ? 'Alteração negada' : 'Arquivos atualizados') : 'Alterando arquivos',
      detail: (it.changes || []).map((x) => x.path).join(', '),
      kind: 'file',
      status,
    };
  if (it.type === 'mcpToolCall' && it.server === QUEST_SERVER)
    return { label: 'Quest · ' + it.tool, detail: it.arguments?.stepId || '', kind: 'mcp', status };
  if (it.type === 'mcpToolCall') {
    const mem = it.server === MEMORY_SERVER;
    return {
      label: mem ? toolLabel(MEMORY_SERVER + '_' + it.tool) : 'Consultando ferramenta',
      detail: mem ? it.arguments?.query || it.arguments?.path || '' : [it.server, it.tool].filter(Boolean).join(' · '),
      kind: mem ? 'memory' : 'mcp',
      status,
    };
  }
  if (it.type === 'webSearch') return { label: 'Pesquisando na web', detail: it.query, kind: 'web', status };
  if (it.type === 'dynamicToolCall')
    return { label: 'Usando ' + (it.tool || it.name || 'ferramenta'), detail: '', kind: 'tool', status };
  return null;
}
function parser(provider, emit) {
  let text = '',
    seen = new Set(),
    subs = new Set(),
    gap = false;
  const subLabels = new Map();
  let draelToolId = 0;
  const draelTools = new Map();
  const append = (t) => {
    if (!t) return;
    text += t;
    emit({ type: 'text', text: t });
  };
  const activity = (label, detail, extra = {}) =>
    emit({ type: 'activity', label, detail: clip(detail, 3000), kind: 'tool', ...extra });
  const subagent = (o) => emit({ type: 'subagent', provider, ...o });
  // Partial update of an activity already announced (merged by id): status, result, background flags.
  const activityUpdate = (id, o) => emit({ type: 'activity', id, ...o });
  const cost = (o) =>
    emit({
      type: 'cost',
      provider,
      inputTokens: num(o.inputTokens),
      outputTokens: num(o.outputTokens),
      cacheTokens: num(o.cacheTokens),
      costUsd: num(o.costUsd),
    });
  const startSub = (id, input, status, result) => {
    subs.add(id);
    subLabels.set(
      id,
      clip(input?.description || String(input?.prompt || '').split('\n')[0] || input?.subagent_type || 'subagente', 120)
    );
    subagent({
      toolUseId: id,
      subagentType: clip(input?.subagent_type || input?.subagentType || 'agent', 80),
      label: clip(input?.description || String(input?.prompt || '').split('\n')[0], 200),
      prompt: clip(input?.prompt, 6000),
      status,
      ...(result !== undefined ? { result } : {}),
    });
  };
  // Codex app-server state: the chat's own thread, subagent threads -> their card, streamed message items, turn usage.
  let mainThread = null,
    paragraph = false;
  const threadOwner = new Map(),
    threadLabel = new Map(),
    streamed = new Set(),
    usage = { inputTokens: 0, outputTokens: 0, cacheTokens: 0 };
  // Claude: tool_use id -> the subagent card it runs under, so a permission request can say who is asking.
  const toolOwner = new Map(),
    background = new Set();
  // Claude activities: tool_use ids announced as activities; tool_use ids that run as background tasks; task_id -> tool_use id.
  const toolIds = new Set(),
    bgTools = new Set(),
    taskTool = new Map();
  // Claude background tasks (commands, monitors) the CLI is still tracking: task_id -> {taskId, type, description}.
  // `background_tasks_changed` is authoritative; task_started/task_notification keep the list right in between.
  const bgList = new Map();
  const listTasks = () => [...bgList.values()].filter((t) => t.type !== 'local_agent');
  const trackBackground = (event) => {
    if (event.subtype === 'background_tasks_changed') {
      bgList.clear();
      for (const t of event.tasks || [])
        if (t?.task_id)
          bgList.set(t.task_id, {
            taskId: t.task_id,
            type: t.task_type || '',
            description: clip(t.description, 160),
          });
      emit({ type: 'tasks', tasks: listTasks() });
    } else if (event.subtype === 'task_started' && event.is_backgrounded && event.task_id) {
      bgList.set(event.task_id, {
        taskId: event.task_id,
        type: event.task_type || '',
        description: clip(event.description, 160),
        ...(event.tool_use_id ? { toolUseId: event.tool_use_id } : {}),
      });
    } else if (event.subtype === 'task_notification' && event.task_id) {
      bgList.delete(event.task_id);
    } else if (event.subtype === 'task_updated' && taskStatus(event.patch?.status) !== 'running' && event.task_id) {
      bgList.delete(event.task_id);
    }
  };
  // A write to the AI Memory (by the agent itself) is reported so the app can show where a profile entry came from.
  const memoryWrites = new Set();
  const memoryCall = (name, input, key) => {
    if (key) {
      if (memoryWrites.has(key)) return;
      if (/memory_write_page$/.test(String(name || ''))) memoryWrites.add(key);
    }
    if (!String(name || '').includes(MEMORY_SERVER) && !/vesta_memory/.test(String(name || ''))) return;
    if (!/memory_write_page$/.test(String(name))) return;
    emit({
      type: 'memory-write',
      path: clip(input?.path, 300),
      scope: input?.scope || '',
      body: clip(input?.body, 2000),
    });
  };
  const taskStats = (u) =>
    u ? { toolUses: num(u.tool_uses), tokens: num(u.total_tokens), durationMs: num(u.duration_ms) } : undefined;
  // Claude `system` task events: subagents and background commands/monitors share task_id <-> tool_use_id.
  const claudeTask = (event) => {
    const id = event.tool_use_id || taskTool.get(event.task_id);
    if (event.subtype === 'task_started') {
      if (!id) return;
      taskTool.set(event.task_id, id);
      if (event.task_type === 'local_agent' || subs.has(id)) {
        if (!subs.has(id))
          startSub(
            id,
            { description: event.description, prompt: event.prompt, subagent_type: event.subagent_type },
            'running'
          );
        if (event.is_backgrounded) background.add(id);
        subagent({
          toolUseId: id,
          taskId: event.task_id,
          ...(event.is_backgrounded ? { background: true } : {}),
        });
      } else {
        bgTools.add(id);
        if (!toolIds.has(id)) {
          toolIds.add(id);
          activity('Segundo plano', event.description || '', { kind: 'command', id, status: 'running' });
        }
        activityUpdate(id, {
          background: true,
          taskId: event.task_id,
          status: 'running',
          ...(event.description ? { title: clip(event.description, 160) } : {}),
        });
      }
      return;
    }
    if (!id) return;
    const sub = subs.has(id);
    if (event.subtype === 'task_progress' && sub) {
      subagent({
        toolUseId: id,
        stats: { ...taskStats(event.usage), ...(event.last_tool_name ? { lastTool: event.last_tool_name } : {}) },
      });
    }
    if (event.subtype === 'task_updated') {
      const status = taskStatus(event.patch?.status);
      if (status === 'running') return;
      const endedAt = num(event.patch?.end_time) || undefined;
      if (sub) subagent({ toolUseId: id, status, endedAt });
      else if (toolIds.has(id)) activityUpdate(id, { status, endedAt });
    }
    if (event.subtype === 'task_notification') {
      const st = taskStatus(event.status),
        status = st === 'running' ? 'error' : st,
        summary = clip(event.summary || '', 4000) || undefined;
      if (sub) {
        background.delete(id);
        subagent({ toolUseId: id, status, result: summary, stats: taskStats(event.usage) });
      } else if (toolIds.has(id)) activityUpdate(id, { status, ...(summary ? { result: summary } : {}) });
    }
  };
  return {
    get text() {
      return text;
    },
    setMainThread(id) {
      mainThread = id;
    },
    // Claude background subagents still working: their completion starts another turn in the same process.
    backgroundRunning() {
      return background.size > 0;
    },
    // Background commands / monitors the CLI still tracks (not subagents): the reason to keep following a chat.
    followTasks() {
      return listTasks();
    },
    // A new turn of the same process (a background task finished, or the user wrote again): the text restarts.
    nextTurn() {
      text = '';
      gap = false;
      paragraph = false;
    },
    ownerOf(toolUseId) {
      const id = toolOwner.get(toolUseId);
      return id ? subLabels.get(id) || 'subagente' : null;
    },
    ownerOfThread(threadId) {
      if (!threadId || threadId === mainThread) return null;
      const id = threadOwner.get(threadId);
      return threadLabel.get(threadId) || (id && subLabels.get(id)) || 'subagente';
    },
    accept(event) {
      if (provider === 'drael') {
        if (event.type === 'text') append(event.text);
        if (event.type === 'tool') {
          const id = 'drael-' + ++draelToolId,
            queue = draelTools.get(event.name) || [];
          queue.push(id);
          draelTools.set(event.name, queue);
          if (event.name === 'task') startSub(id, event.args, 'running');
          else
            activity(event.name, JSON.stringify(event.args || {}), {
              kind: toolKind(event.name),
              status: 'running',
              toolUseId: id,
              id,
            });
        }
        if (event.type === 'result') {
          const id = draelTools.get(event.name)?.shift() || 'drael-' + ++draelToolId,
            status = event.error ? 'error' : 'done';
          if (event.name === 'task') subagent({ toolUseId: id, status, result: clip(event.text, 12000) });
          else activityUpdate(id, { status, kind: toolKind(event.name), result: clip(event.text, 600) });
        }
        if (event.type === 'end') {
          cost({
            inputTokens: event.usage?.input,
            outputTokens: event.usage?.output,
            cacheTokens: event.usage?.cached,
          });
          if (event.refused || event.stopped === 'max_turns')
            emit({
              type: 'provider-error',
              message: event.refused || 'Drael atingiu o limite de etapas desta resposta.',
            });
        }
      } else if (provider === 'codex') {
        // JSON-RPC notifications from `codex app-server` ({method, params}).
        const m = event.method,
          p = event.params || {},
          it = p.item,
          tid = p.threadId || p.thread?.id;
        // Rate limits arrive as a notification (account/rateLimits/updated) and as the read response (replace = full list).
        if (m === 'account/rateLimits/updated' || m === 'account/rateLimits/read') {
          const r = codexRateLimits(m === 'account/rateLimits/read' ? p : { rateLimits: p.rateLimits });
          if (r.windows.length)
            emit({ type: 'usage', provider: 'codex', ...r, replace: m === 'account/rateLimits/read' });
          return;
        }
        if (m === 'thread/started' && !mainThread) mainThread = p.thread?.id;
        // A subagent's own thread names it (nickname/role), even before its spawn call reports the thread id.
        if (m === 'thread/started' && p.thread?.parentThreadId && p.thread.id !== mainThread)
          threadLabel.set(
            p.thread.id,
            clip(
              p.thread.agentNickname ||
                p.thread.agentRole ||
                String(p.thread.preview || '').split('\n')[0] ||
                'subagente',
              120
            )
          );
        if (m === 'thread/started' && p.thread?.id === mainThread) emit({ type: 'session', sessionId: mainThread });
        if (tid && mainThread && tid !== mainThread) {
          // Work inside a subagent thread becomes live steps of its card.
          const owner = threadOwner.get(tid);
          if (!owner || !it || !/^item\/(started|completed)$/.test(m)) return;
          const s = codexItem(it, m === 'item/completed');
          if (s)
            subagent({
              toolUseId: owner,
              step: {
                id: it.id,
                kind: s.kind,
                label: s.label,
                detail: clip(s.detail, 300),
                status: s.status,
                ...(s.result ? { result: s.result } : {}),
              },
            });
          return;
        }
        if (m === 'item/started' && it?.type === 'agentMessage') paragraph = true;
        if (m === 'item/agentMessage/delta') {
          streamed.add(p.itemId);
          if (paragraph && text) append('\n\n');
          paragraph = false;
          append(p.delta);
        }
        if (m === 'item/completed' && it?.type === 'agentMessage' && !streamed.has(it.id) && it.text) {
          append((text ? '\n\n' : '') + it.text);
          paragraph = false;
        }
        if ((m === 'item/started' || m === 'item/completed') && it) {
          const done = m === 'item/completed';
          if (it.type === 'subAgentActivity' && it.agentThreadId) {
            // Newer Codex announces each subagent by its thread and path ("/root/criar_pasta"): the card is keyed by that thread.
            const key = it.agentThreadId,
              name =
                String(it.agentPath || '')
                  .split('/')
                  .filter(Boolean)
                  .pop() || 'subagente';
            threadOwner.set(key, key);
            if (!threadLabel.has(key)) threadLabel.set(key, clip(name.replace(/_/g, ' '), 120));
            if (it.kind === 'started' && !subs.has(key))
              startSub(key, { subagent_type: 'agent', description: threadLabel.get(key) }, 'running');
            if (it.kind === 'completed' && subs.has(key)) subagent({ toolUseId: key, status: 'done' });
            if (['failed', 'errored', 'interrupted'].includes(it.kind) && subs.has(key))
              subagent({ toolUseId: key, status: taskStatus(it.kind) });
          } else if (it.type === 'collabAgentToolCall') {
            if (it.tool === 'spawnAgent') {
              for (const t of it.receiverThreadIds || []) threadOwner.set(t, it.id);
              if (!subs.has(it.id))
                startSub(
                  it.id,
                  {
                    subagent_type: 'agent',
                    prompt: it.prompt || '',
                    description: String(it.prompt || '').split('\n')[0],
                  },
                  'running'
                );
            }
            // Any collab call carries the states of the agents it touched: finished ones close their card.
            for (const [t, st] of Object.entries(it.agentsStates || {})) {
              const owner = threadOwner.get(t);
              if (owner && ['completed', 'errored', 'shutdown', 'interrupted', 'notFound'].includes(st?.status))
                subagent({
                  toolUseId: owner,
                  status: taskStatus(st.status),
                  ...(st.message ? { result: clip(st.message, 4000) } : {}),
                });
            }
          } else {
            if (m === 'item/started' && it.type === 'mcpToolCall' && it.server === MEMORY_SERVER)
              memoryCall(MEMORY_SERVER + '_' + it.tool, it.arguments);
            const s = codexItem(it, done);
            if (s)
              activity(s.label, s.detail, {
                kind: s.kind,
                id: it.id,
                status: s.status,
                ...(s.result ? { result: s.result } : {}),
              });
          }
        }
        if (m === 'thread/tokenUsage/updated' && tid === mainThread) {
          const l = p.tokenUsage?.last || {};
          usage.inputTokens += num(l.inputTokens);
          usage.outputTokens += num(l.outputTokens) + num(l.reasoningOutputTokens);
          usage.cacheTokens += num(l.cachedInputTokens);
        }
        if (m === 'turn/completed' && tid === mainThread) {
          if (usage.inputTokens || usage.outputTokens) cost(usage);
          if (p.turn?.status === 'failed')
            emit({ type: 'provider-error', message: p.turn.error?.message || 'O Codex não concluiu a resposta' });
        }
        if (m === 'error' && !p.willRetry && (!tid || tid === mainThread))
          emit({ type: 'provider-error', message: p.error?.message || 'Falha no Codex' });
      } else if (provider === 'claude') {
        if (event.session_id) emit({ type: 'session', sessionId: event.session_id });
        // Events from inside a subagent carry parent_tool_use_id: they become live steps of its card, never main text.
        const parent = event.parent_tool_use_id;
        if (parent) {
          if (!subs.has(parent)) return;
          const step = (s) => subagent({ toolUseId: parent, step: s });
          if (event.type === 'assistant')
            for (const block of event.message?.content || []) {
              if (block.type === 'tool_use') {
                toolOwner.set(block.id, parent);
                const i = block.input || {};
                step({
                  id: block.id,
                  kind: toolKind(block.name),
                  label: toolLabel(block.name),
                  detail: clip(detailOf(i), 300),
                  ...(i.description && i.description !== detailOf(i) ? { title: clip(i.description, 160) } : {}),
                  status: 'running',
                });
              }
              if (block.type === 'text' && block.text?.trim())
                step({
                  id: event.message?.id + ':text',
                  kind: 'text',
                  label: 'Escrevendo',
                  detail: clip(block.text.trim(), 300),
                  status: 'done',
                });
            }
          if (event.type === 'user' && Array.isArray(event.message?.content))
            for (const block of event.message.content)
              if (block?.type === 'tool_result')
                step({
                  id: block.tool_use_id,
                  status: block.is_error ? 'error' : 'done',
                  result: clip(textOf(block.content), 400),
                });
          return;
        }
        if (
          event.type === 'stream_event' &&
          event.event?.type === 'content_block_delta' &&
          event.event.delta?.type === 'text_delta'
        ) {
          if (gap && !/\s$/.test(text)) append('\n\n');
          gap = false;
          append(event.event.delta.text);
        }
        if (event.type === 'assistant')
          for (const block of event.message?.content || []) {
            if (block.type === 'text' && !text) append(block.text);
            if (block.type === 'tool_use') {
              if (block.name === 'Agent' || block.name === 'Task') {
                if (!subs.has(block.id)) startSub(block.id, block.input, 'running');
              } else {
                const i = block.input || {},
                  detail = detailOf(i);
                toolIds.add(block.id);
                memoryCall(block.name, i);
                if (i.run_in_background || block.name === 'Monitor') bgTools.add(block.id);
                activity(toolLabel(block.name), detail, {
                  kind: toolKind(block.name),
                  id: block.id,
                  status: 'running',
                  ...(i.description && i.description !== detail ? { title: clip(i.description, 160) } : {}),
                  ...(i.run_in_background ? { background: true } : {}),
                });
              }
            }
          }
        if (event.type === 'user' && Array.isArray(event.message?.content))
          for (const block of event.message.content) {
            if (block?.type === 'tool_result' && toolIds.has(block.tool_use_id)) {
              // A tool launched in the background only acknowledges here; task_updated/task_notification ends it.
              const r = event.tool_use_result,
                taskId = r && typeof r === 'object' ? r.backgroundTaskId || r.taskId : '',
                id = block.tool_use_id;
              if (!block.is_error && (taskId || bgTools.has(id))) {
                bgTools.add(id);
                if (taskId) taskTool.set(taskId, id);
                activityUpdate(id, { background: true, ...(taskId ? { taskId } : {}) });
              } else
                activityUpdate(id, {
                  status: block.is_error ? 'error' : 'done',
                  result: clip(textOf(block.content), 600),
                });
            }
            if (block?.type === 'tool_result' && subs.has(block.tool_use_id)) {
              // A backgrounded subagent only acknowledges its launch here; task_notification closes it later.
              const body = textOf(block.content);
              if (!block.is_error && /^\s*Async agent launched/i.test(body)) {
                background.add(block.tool_use_id);
                subagent({ toolUseId: block.tool_use_id, background: true });
              } else
                subagent({
                  toolUseId: block.tool_use_id,
                  status: block.is_error ? 'error' : 'done',
                  result: summarize(block.content),
                });
            }
          }
        if (event.type === 'system') {
          trackBackground(event);
          claudeTask(event);
        }
        // A second turn (after a background task) starts a new message: keep paragraphs apart.
        if (event.type === 'stream_event' && event.event?.type === 'message_start' && text) gap = true;
        if (event.type === 'rate_limit_event') {
          const w = rateWindows(event.rate_limit_info);
          if (w.fiveHour || w.sevenDay) emit({ type: 'usage', provider: 'claude', ...w });
        }
        if (event.type === 'result' && event.num_turns === 0 && !event.result && !event.is_error) {
        } else if (event.type === 'result') {
          if (!text && event.result) append(event.result);
          const u = event.usage;
          if (u || event.total_cost_usd != null)
            cost({
              inputTokens: u?.input_tokens,
              outputTokens: u?.output_tokens,
              cacheTokens: num(u?.cache_read_input_tokens) + num(u?.cache_creation_input_tokens),
              costUsd: event.total_cost_usd,
            });
          if (event.is_error)
            emit({
              type: 'provider-error',
              message: (event.errors || []).join('\n') || event.result || 'Falha no Claude',
            });
        }
      } else {
        const sessionId = event.sessionID || event.part?.sessionID;
        if (sessionId) emit({ type: 'session', sessionId });
        if (event.type === 'text') {
          const key = event.part?.id;
          if (!key || !seen.has(key)) {
            if (key) seen.add(key);
            append((text ? '\n\n' : '') + (event.part?.text || event.text || ''));
          }
        }
        if (event.type === 'tool_use') {
          const part = event.part || {},
            st = part.state || {},
            id = part.callID || part.id || '';
          if (part.tool === 'task') {
            const status = st.status === 'error' ? 'error' : st.status === 'completed' ? 'done' : 'running';
            startSub(
              id,
              st.input || {},
              status,
              status === 'running' ? undefined : summarize(st.output || st.error || st.title)
            );
          } else {
            memoryCall(part.tool, st.input, id);
            activity(
              toolLabel(part.tool),
              st.title ||
                st.input?.query ||
                st.input?.path ||
                st.input?.command ||
                st.input?.filePath ||
                st.input?.pattern ||
                '',
              {
                kind: toolKind(part.tool),
                id: id || undefined,
                status: st.status === 'completed' ? 'done' : st.status === 'error' ? 'error' : 'running',
                ...(st.status === 'completed' || st.status === 'error'
                  ? { result: clip(textOf(st.output || st.error), 600) }
                  : {}),
              }
            );
          }
        }
        if (event.type === 'step_finish' && event.part) {
          const t = event.part.tokens || {};
          cost({
            inputTokens: t.input,
            outputTokens: num(t.output) + num(t.reasoning),
            cacheTokens: num(t.cache?.read) + num(t.cache?.write),
            costUsd: event.part.cost,
          });
        }
        if (event.type === 'error')
          emit({
            type: 'provider-error',
            message: event.error?.data?.message || event.error?.message || 'Falha no OpenCode',
          });
      }
    },
  };
}
// Merges a subagent event into a message's list (upsert by toolUseId), stamping start/end times.
// Steps carry their own startedAt/endedAt; old steps beyond MAX_STEPS are folded into `stepsDropped`.
function upsertSubagent(list, ev, now = Date.now()) {
  const { type, step, ...fields } = ev;
  for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
  let rec = list.find((s) => s.toolUseId === fields.toolUseId);
  if (!rec) {
    rec = { startedAt: now, status: 'running' };
    list.push(rec);
  }
  Object.assign(rec, fields);
  if (step) {
    rec.steps = rec.steps || [];
    const i = rec.steps.findIndex((x) => x.id === step.id);
    if (i >= 0) rec.steps[i] = stamp({ ...rec.steps[i], ...step }, now);
    else rec.steps.push(stamp({ at: now, startedAt: now, ...step }, now));
    const dropped = capList(rec.steps, MAX_STEPS);
    if (dropped) rec.stepsDropped = (rec.stepsDropped || 0) + dropped;
  }
  if (rec.status !== 'running' && !rec.endedAt) rec.endedAt = now;
  if (rec.status === 'running') delete rec.endedAt;
  return rec;
}
// Start/end bookkeeping shared by activities and steps.
function stamp(a, now) {
  if (a.status && a.status !== 'running') a.endedAt = a.endedAt || now;
  else if (a.status === 'running') delete a.endedAt;
  return a;
}
// Same for generic activities carrying an id (codex emits started/completed for the same item).
function upsertActivity(list, ev, now = Date.now()) {
  const { type, ...a } = ev;
  for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k];
  if (a.id) {
    const i = list.findIndex((x) => x.id === a.id);
    if (i >= 0) {
      list[i] = stamp({ ...list[i], ...a }, now);
      return list[i];
    }
  }
  const rec = stamp({ startedAt: now, ...a }, now);
  list.push(rec);
  return rec;
}
// Applies an activity/subagent parser event to a stored assistant message and returns the stream event to send
// to the renderer (or null for other event types). Long runs keep every running task; only old finished ones are
// folded into "+N anteriores". A subagent event carries only the step that changed.
function applyToMessage(message, event, now = Date.now()) {
  if (event.type === 'activity') {
    message.activities = message.activities || [];
    const activity = upsertActivity(message.activities, event, now);
    message.activitiesDropped = (message.activitiesDropped || 0) + capList(message.activities, MAX_ACTIVITIES);
    return { type: 'activity', messageId: message.id, activity };
  }
  if (event.type === 'subagent') {
    message.subagents = message.subagents || [];
    const rec = upsertSubagent(message.subagents, event, now),
      { steps, ...fields } = rec,
      step = event.step && (steps || []).find((x) => x.id === event.step.id);
    return { type: 'subagent', messageId: message.id, subagent: { ...fields, ...(step ? { step } : {}) } };
  }
  return null;
}
module.exports = {
  applyToMessage,
  MODES,
  modeOf,
  locate,
  run,
  kill,
  command,
  memoryTools,
  mcpTools,
  memoryServer,
  questServer,
  memoryHint,
  PROFILE_CATEGORIES,
  MEMORY_SERVER,
  QUEST_SERVER,
  QUEST_TOKEN_ENV,
  parser,
  upsertSubagent,
  upsertActivity,
  rateWindows,
  normWindow,
};
