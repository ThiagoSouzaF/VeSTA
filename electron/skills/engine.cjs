// Skills in VeSTA: the library every AI shares, what each AI already has on its own (Na sua IA), the import (paste,
// file, GitHub link, an AI's own skill), the adaptation by an AI the person picks, and what goes to a chat: the short
// catalog of "A IA decide" skills (once per session) and the whole skill when the person types /nome.
//
// Adaptation runs in a hidden chat (mode read, no memory, `skillDraft` set): the regular send flow, any of the four
// AIs. Its answer becomes a draft, kept in memory until the person saves or discards it; the chat is then deleted.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { UserError } = require('../app/errors.cjs');
const { redact } = require('../memory/redact.cjs');
const F = require('./format.cjs');
const { createLibrary } = require('./library.cjs');
const { scanNative } = require('./native.cjs');
const S = require('./sources.cjs');
const G = require('./github.cjs');
const { buildAdaptPrompt, parseAdaptReply } = require('./adapt.cjs');

const NATIVE_TTL = 60000;
const MAX_PARALLEL = 3;
const CATALOG_DESC = 180;
const SLASH = /^\/([a-z0-9][a-z0-9-]{0,63})(?=\s|$)\s*([\s\S]*)$/;

// deps (tests): { send, net, native(), pick() }
function createSkills(ctx, { root, deps = {} } = {}) {
  const lib = createLibrary(root);
  const send = deps.send || ((...a) => require('../chat/send.cjs').send(...a));
  const net = deps.net || G.githubNet({ gh: deps.gh });
  const scans = new Map(); // scanId -> { at, candidates }
  const drafts = new Map(); // draftId -> draft
  const queue = [];
  let nativeCache = null;

  const changed = () => ctx.sync?.();
  const projects = () => ctx.store?.state.projects || [];
  function native() {
    if (deps.native) return deps.native();
    if (!nativeCache || Date.now() - nativeCache.at > NATIVE_TTL)
      nativeCache = { at: Date.now(), value: scanNative({ projects: projects() }) };
    return nativeCache.value;
  }

  // ---- What the screen sees ------------------------------------------------------------------------------------
  const draftSummary = (d) => ({
    id: d.id,
    name: d.name,
    status: d.status, // 'waiting' | 'running' | 'ready' | 'error'
    mode: d.mode,
    provider: d.provider || null,
    error: d.error || '',
    changes: d.changes || [],
    compat: d.compat || null,
    tokens: d.text ? F.tokens(d.text) : 0,
    originalTokens: F.tokens(d.candidate.text),
    source: d.candidate.source,
    exists: !!lib.get(d.name),
    hasScripts: !!d.candidate.hasScripts,
  });
  const summary = () => ({ list: lib.list(), drafts: [...drafts.values()].map(draftSummary) });

  function nativeList() {
    const n = native();
    const mark = (s) => ({ ...s, inVesta: !!lib.get(s.name) });
    return { claude: n.claude.map(mark), codex: n.codex.map(mark), opencode: n.opencode.map(mark) };
  }

  // ---- Import ----------------------------------------------------------------------------------------------------
  // -> { scanId, label, truncated, candidates: [{ key, name, description, files, skipped, hasScripts, exists, ... }] }
  async function scan(input = {}) {
    let candidates,
      label = '',
      truncated = false;
    if (input.kind === 'paste') candidates = [S.fromText(input.text)];
    else if (input.kind === 'path') candidates = S.fromPath(String(input.path || ''));
    else if (input.kind === 'native') {
      // Only a folder the native scan listed: the screen never names an arbitrary path here.
      const all = [...native().claude, ...native().codex];
      const hit = all.find((s) => s.dir === input.dir);
      if (!hit) throw new UserError('Skill não encontrada nesta IA.');
      const who = hit.provider === 'claude' ? 'Claude' : 'Codex';
      candidates = [
        S.fromDir(hit.dir, { kind: 'native', label: who + ' · ' + hit.label, url: '', path: '', license: '' }),
      ];
    } else if (input.kind === 'github') {
      const r = await G.scanGithub(input.url, net);
      ({ label, truncated, candidates } = r);
    } else throw new UserError('Origem de skill desconhecida');
    const scanId = randomUUID();
    // Only the latest few scans are kept (each may hold a whole repository's SKILL.md files).
    for (const [id] of [...scans].slice(0, Math.max(0, scans.size - 4))) scans.delete(id);
    scans.set(scanId, { at: Date.now(), candidates });
    return {
      scanId,
      label: label || candidates[0]?.source.label || '',
      truncated,
      candidates: candidates.map((c, key) => ({
        key,
        name: c.name,
        description: c.description,
        files: c.files.length,
        skipped: c.skipped,
        hasScripts: c.hasScripts,
        license: c.source.license || '',
        exists: !!lib.get(c.name),
        tokens: F.tokens(c.text),
      })),
    };
  }
  async function picked(scanId, keys) {
    const s = scans.get(scanId);
    if (!s) throw new UserError('A leitura expirou. Comece de novo.');
    const list = (Array.isArray(keys) ? keys : []).map((k) => s.candidates[k]).filter(Boolean);
    if (!list.length) throw new UserError('Escolha ao menos uma skill.');
    // GitHub: the supporting files of the picked skills are downloaded only now.
    for (const c of list)
      if (c.fetch && c.files.length && c.files[0].text === undefined) c.files = await G.fetchFiles(c, net);
    return list;
  }
  const newDraft = (c, extra) => {
    const d = { id: randomUUID(), name: c.name, candidate: c, mode: 'auto', ...extra };
    drafts.set(d.id, d);
    return d;
  };

  // Saved as imported (no AI): the text stays the original one.
  async function keep({ scanId, keys }) {
    const list = await picked(scanId, keys);
    const ids = list.map((c) => newDraft(c, { status: 'ready', text: c.text, compat: null, changes: [] }).id);
    changed();
    return ids;
  }

  // ---- Adaptation ------------------------------------------------------------------------------------------------
  async function adapt({ scanId, keys, provider, model = '', lang = 'pt-BR' }) {
    if (!['claude', 'codex', 'opencode', 'drael'].includes(provider))
      throw new UserError('Escolha a IA que vai adaptar');
    const list = await picked(scanId, keys);
    const ids = list.map((c) => {
      const d = newDraft(c, { status: 'waiting', provider, model, lang });
      queue.push(d.id);
      return d.id;
    });
    pump();
    changed();
    return ids;
  }
  const running = () => [...drafts.values()].filter((d) => d.status === 'running').length;
  function pump() {
    while (queue.length && running() < MAX_PARALLEL) {
      const d = drafts.get(queue.shift());
      if (d?.status === 'waiting') start(d);
    }
  }
  function start(d) {
    d.status = 'running';
    let chat;
    try {
      chat = ctx.store.addChat({ provider: d.provider, model: d.model, projectId: null, mode: 'read', memory: false });
      chat.title = 'Adaptar skill: ' + d.name;
      chat.skillDraft = d.id;
      d.chatId = chat.id;
    } catch (e) {
      return fail(d, e.message);
    }
    Promise.resolve()
      .then(() => send(ctx, { chatId: chat.id, text: buildAdaptPrompt(d.candidate, { lang: d.lang }) }))
      .catch((e) => fail(d, e.message));
  }
  function dropChat(d) {
    if (!d.chatId || !ctx.store) return;
    const chats = ctx.store.state.chats;
    const i = chats.findIndex((c) => c.id === d.chatId);
    if (i >= 0) chats.splice(i, 1);
    d.chatId = null;
    ctx.store.saveSoon?.();
  }
  function fail(d, message) {
    d.status = 'error';
    d.error = redact(String(message || 'A IA falhou.')).slice(0, 600);
    dropChat(d);
    pump();
    changed();
  }
  // Every finished turn passes here; only adaptation chats matter.
  function onChatDone({ chatId, status }) {
    const chat = ctx.store.state.chats.find((c) => c.id === chatId);
    const d = chat?.skillDraft && drafts.get(chat.skillDraft);
    if (!d || d.chatId !== chatId) return;
    const reply = [...chat.messages].reverse().find((m) => m.role === 'assistant');
    if (status !== 'done') return fail(d, reply?.error || 'A adaptação foi interrompida.');
    try {
      Object.assign(d, parseAdaptReply(reply.text, d.name), { status: 'ready', error: '' });
    } catch (e) {
      return fail(d, e.message);
    }
    dropChat(d);
    pump();
    changed();
  }
  // Adaptation chats left by a previous run (the app closed mid-way) are removed at start.
  function recover() {
    const chats = ctx.store.state.chats;
    for (let i = chats.length - 1; i >= 0; i--) if (chats[i].skillDraft) chats.splice(i, 1);
  }

  const draftOf = (id) => {
    const d = drafts.get(id);
    if (!d) throw new UserError('Rascunho não encontrado');
    return d;
  };
  function draftRead(id) {
    const d = draftOf(id);
    return {
      ...draftSummary(d),
      text: d.text || '',
      original: d.candidate.text,
      files: d.candidate.files.map((f) => f.path),
    };
  }
  function draftUpdate(id, patch = {}) {
    const d = draftOf(id);
    if (patch.text !== undefined) {
      if (!String(patch.text).trim()) throw new UserError('A skill não pode ficar vazia');
      d.text = String(patch.text);
    }
    if (patch.name !== undefined) {
      const name = F.skillName({ name: patch.name }, '');
      if (!F.NAME.test(name || '')) throw new UserError('Nome inválido: use letras minúsculas, números e "-"');
      d.name = name;
      if (d.text) d.text = F.withFrontmatter(d.text, { name });
    }
    if (patch.mode !== undefined) d.mode = patch.mode === 'slash' ? 'slash' : 'auto';
    changed();
    return draftSummary(d);
  }
  // Another AI redoes one draft.
  function redo(id, { provider, model = '' }) {
    const d = draftOf(id);
    if (d.status === 'running') throw new UserError('Essa skill ainda está sendo adaptada');
    Object.assign(d, { provider, model, status: 'waiting', error: '', text: '', changes: [], compat: null });
    queue.push(d.id);
    pump();
    changed();
  }
  function saveDrafts({ ids, replace = false }) {
    const saved = [];
    for (const id of ids || []) {
      const d = draftOf(id);
      if (d.status !== 'ready') continue;
      const c = d.candidate;
      lib.install(
        {
          name: d.name,
          text: d.text,
          description: c.description,
          files: c.files,
          original: { text: c.text, files: c.files },
          source: c.source,
          compat: d.compat || {},
          adaptedBy: d.provider && d.compat ? d.provider : null,
          changes: d.changes,
          mode: d.mode,
        },
        { replace }
      );
      drafts.delete(id);
      saved.push(d.name);
    }
    changed();
    return saved;
  }
  function discard(ids) {
    for (const id of ids || []) {
      const d = drafts.get(id);
      if (!d) continue;
      if (d.chatId) ctx.stopChat?.(d.chatId);
      dropChat(d);
      drafts.delete(id);
    }
    pump();
    changed();
  }

  // ---- What goes to a chat ---------------------------------------------------------------------------------------
  // An AI that has a skill of the same name on its own (Claude, Codex) uses its own: the catalog skips it.
  function usable(chat) {
    const n = chat.provider === 'claude' || chat.provider === 'codex' ? native()[chat.provider] : [];
    const own = new Set(n.map((s) => s.name));
    return lib.list().filter((s) => s.enabled && s.compat?.[chat.provider] === 'ok' && !own.has(s.name));
  }
  const hasAny = () => lib.list().some((s) => s.enabled);
  // The lines that tell the AI what it may load (only "A IA decide" skills; "Só com /" ones cost nothing here).
  function catalogHint(chat) {
    const auto = usable(chat).filter((s) => s.mode === 'auto');
    if (!auto.length) return '';
    return (
      'Skills do VeSTA (ferramenta vesta_skill_load do servidor vesta-skills): quando o pedido combinar com uma delas, carregue-a antes de seguir e siga o que ela diz. Não carregue sem motivo.\n' +
      auto.map((s) => '- ' + s.name + ': ' + clip(s.description, CATALOG_DESC)).join('\n')
    );
  }
  // "/nome resto" -> { skill, text (the prompt), note } for an enabled VeSTA skill; null otherwise (the text goes as is).
  function expand(chat, text) {
    const m = SLASH.exec(String(text || ''));
    const meta = m && lib.get(m[1]);
    if (!meta || !meta.enabled) return null;
    const { text: body, files } = lib.read(meta.name);
    const request = m[2].trim();
    const compat = meta.compat?.[chat.provider];
    lib.used(meta.name);
    changed();
    return {
      skill: meta.name,
      text: [
        'A pessoa chamou a skill /' + meta.name + ' do VeSTA. Siga as instruções dela para atender ao pedido.',
        '<skill nome="' + meta.name + '">\n' + F.parseSkill(body).body + '\n</skill>',
        files.length
          ? 'Arquivos de apoio da skill (leia com vesta_skill_file, se precisar): ' +
            files.map((f) => f.path).join(', ')
          : '',
        'Pedido: ' + (request || 'aplique esta skill agora.'),
      ]
        .filter(Boolean)
        .join('\n\n'),
      note: {
        kind: 'skill',
        label: 'Skill /' + meta.name + ' carregada',
        detail: '~' + meta.tokens + ' tokens' + (compat && compat !== 'ok' ? '. Atenção: ' + compat : ''),
      },
    };
  }

  // ---- Library -------------------------------------------------------------------------------------------------
  function set(name, patch) {
    const meta = lib.update(name, patch || {});
    changed();
    return meta;
  }
  function remove(name) {
    lib.remove(name);
    changed();
  }

  return {
    lib,
    summary,
    nativeList,
    scan,
    keep,
    adapt,
    redo,
    onChatDone,
    recover,
    draftRead,
    draftUpdate,
    saveDrafts,
    discard,
    usable,
    hasAny,
    catalogHint,
    expand,
    set,
    remove,
    read: (name) => lib.read(name),
    readFile: (name, rel) => lib.readFile(name, rel),
    used: (name) => (lib.used(name), changed()),
    root: path.resolve(root),
  };
}
const clip = (s, n) => {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

module.exports = { createSkills, SLASH };
