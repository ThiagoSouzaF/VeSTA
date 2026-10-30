// "vesta-app": the MCP server that lets a conversation see and change VeSTA's own preferences ("mude o tema para
// papel", "faça um backup agora"). Served by mcp-host.cjs, one token per chat. What a chat can do:
//   - read everything in Preferências (except secrets: Drive credentials, phone pairing);
//   - change appearance, memory, background-process and backup preferences (not in "Só consulta" chats);
//   - run a backup now (it also goes to Google Drive when connected) and list the backups;
//   - open Preferências at a section, for what needs the person: Google sign-in, restoring, folders, the phone.
// Restoring, the phone remote control and the Drive sign-in are never done by a chat. Each change shows a notice.
const { createMcpHost } = require('./mcp-host.cjs');
const { THEMES } = require('./store.cjs');
const B = require('./backup.cjs');

const NAME = 'vesta-app';
const BACKGROUNDS = ['none', 'ember', 'rain', 'inkrain', 'stream'];
const FOLLOW_MINUTES = [15, 30, 60, 120, 240, 480, 720];
const FOLLOW_MAX = [1, 2, 3, 5, 8, 10];
const SECTIONS = ['appearance', 'memory', 'follow', 'backup', 'remote', 'data', 'updates'];
const THEME_NAMES = { ink: 'Tinta Mangá', obsidian: 'Obsidiana', aurora: 'Aurora', paper: 'Papel' };

const bool = (description) => ({ type: 'boolean', description });
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const UPDATE = {
  theme: { type: 'string', enum: THEMES, description: 'Tema: ink (Tinta Mangá), obsidian, aurora, paper (claro).' },
  background: { type: 'string', enum: BACKGROUNDS, description: 'Fundo animado: none, ember, rain, inkrain, stream.' },
  fontScale: { type: 'number', minimum: 0.8, maximum: 1.6, description: 'Zoom do texto: 0.8 a 1.6 (1 = 100%).' },
  mascot: bool('Mostrar a mascote Vesta.'),
  memoryEnabled: bool('Usar a memória compartilhada (AI Memory) nas conversas.'),
  capture: bool('Aprender com as conversas (cada conversa vira uma sessão no AI Memory).'),
  memoryConsolidate: {
    type: 'string',
    enum: ['codex', 'off'],
    description: 'Consolidar sessões com IA (codex) ou não (off). O conteúdo vai para a OpenAI com codex.',
  },
  captureRaw: bool('Guardar também cada resposta inteira como página (modo antigo, muito volume).'),
  memoryTools: bool('As IAs podem consultar e gravar na memória por ferramentas.'),
  followMinutes: {
    type: 'integer',
    enum: FOLLOW_MINUTES,
    description: 'Acompanhar processos em segundo plano por até N minutos.',
  },
  followMax: { type: 'integer', enum: FOLLOW_MAX, description: 'Conversas acompanhadas ao mesmo tempo.' },
  backupAuto: { type: 'string', enum: Object.keys(B.INTERVALS), description: 'Backup automático: off, daily, weekly.' },
  backupKeep: { type: 'integer', enum: B.KEEP, description: 'Quantos backups manter (no computador e no Drive).' },
  backupDrive: bool('Enviar cada backup ao Google Drive (precisa estar conectado em Preferências).'),
};
const TOOLS = [
  ['vesta_settings_get', 'Preferências atuais do VeSTA, com os valores aceitos por vesta_settings_update.', obj()],
  [
    'vesta_settings_update',
    'Altera preferências do VeSTA. Mande só o que a pessoa pediu para mudar. Para conectar o Google Drive, escolher pastas, restaurar backup ou o controle pelo celular, use vesta_open_settings: isso só a pessoa faz.',
    obj(UPDATE),
  ],
  ['vesta_backup_now', 'Faz um backup agora (.zip local e, se conectado, cópia no Google Drive).', obj()],
  ['vesta_backup_list', 'Lista os backups recentes: no computador e no Google Drive.', obj()],
  [
    'vesta_open_settings',
    'Abre a tela Preferências na seção pedida, para a pessoa fazer o que só ela pode (login no Google, restaurar, pastas, celular).',
    obj({ section: { type: 'string', enum: SECTIONS, description: 'Seção de Preferências.' } }, ['section']),
  ],
];
const READ_ONLY = ['vesta_settings_get', 'vesta_backup_list', 'vesta_open_settings'];

function snapshot(ctx) {
  const s = ctx.store.state.settings;
  const backup = ctx.backups?.status() || {};
  const cloud = backup.cloud || {};
  return {
    aparencia: {
      theme: s.theme,
      themeName: THEME_NAMES[s.theme] || s.theme,
      background: s.background,
      fontScale: s.fontScale,
      mascot: s.mascot !== false,
    },
    memoria: {
      memoryEnabled: s.memoryEnabled,
      capture: s.capture !== false,
      memoryConsolidate: s.memoryConsolidate,
      captureRaw: !!s.captureRaw,
      memoryTools: s.memoryTools !== false,
    },
    segundoPlano: { followMinutes: s.followMinutes, followMax: s.followMax },
    backup: {
      backupAuto: backup.auto,
      backupKeep: backup.keep,
      backupDrive: backup.drive,
      pasta: backup.folder,
      ultimo: backup.lastAt ? new Date(backup.lastAt).toISOString() : null,
      googleDrive: { configurado: !!cloud.configured, conectado: !!cloud.connected, conta: cloud.email || '' },
    },
    controleRemoto: { ligado: !!ctx.store.state.remote?.enabled, observacao: 'Só pela tela Preferências.' },
    valoresAceitos: Object.fromEntries(
      Object.entries(UPDATE).map(([k, v]) => [k, v.enum || (v.type === 'number' ? [v.minimum, v.maximum] : v.type)])
    ),
  };
}

// methods: the app's own operations (saveSettings, backupSettings, backupNow), so a chat changes exactly what the
// screen changes, with the same validation.
function createAppMcp(ctx, { methods }) {
  const getMethods = typeof methods === 'function' ? methods : () => methods;
  const chatOf = (chatId) => ctx.store.state.chats.find((c) => c.id === chatId) || null;
  // Every chat the person talks to; quest step chats are driven by the quest, not by a person.
  const authorize = (chatId) => {
    const chat = chatOf(chatId);
    if (!chat || ctx.store.state.settings.chatSettings === false) return null;
    if (chat.questId && chat.questRole !== 'lead') return null;
    return chat;
  };
  const notice = (chat, text) => ctx.emit({ type: 'notice', message: '“' + (chat.title || 'Conversa') + '” ' + text });
  const handlers = {
    vesta_settings_get: () => snapshot(ctx),
    vesta_settings_update: async (chat, a) => {
      const m = getMethods();
      const before = snapshot(ctx);
      const app = {},
        backup = {};
      for (const [k, v] of Object.entries(a)) {
        const def = UPDATE[k];
        if (def.enum && !def.enum.includes(v))
          throw Object.assign(new Error(k + ': valor não aceito'), { userSafe: true });
        if (def.type === 'boolean' && typeof v !== 'boolean')
          throw Object.assign(new Error(k + ': use true/false'), { userSafe: true });
        if (k.startsWith('backup')) backup[k[6].toLowerCase() + k.slice(7)] = v;
        else app[k] = v;
      }
      if (!Object.keys(app).length && !Object.keys(backup).length)
        throw Object.assign(new Error('Nada para mudar'), { userSafe: true });
      if (Object.keys(app).length) m.saveSettings(app);
      if (Object.keys(backup).length) m.backupSettings(backup);
      const after = snapshot(ctx);
      const changed = Object.keys(a).filter((k) => JSON.stringify(find(before, k)) !== JSON.stringify(find(after, k)));
      if (changed.length)
        notice(chat, 'mudou: ' + changed.map((k) => k + ' → ' + JSON.stringify(find(after, k))).join(', '));
      return { ok: true, alterado: Object.fromEntries(changed.map((k) => [k, find(after, k)])), preferencias: after };
    },
    vesta_backup_now: async (chat) => {
      notice(chat, 'pediu um backup.');
      const r = await ctx.backups.run('chat');
      return {
        ok: true,
        arquivo: r.file,
        tamanhoBytes: r.size,
        conversas: r.counts.chats,
        paginasDeMemoria: r.counts.wikiPages,
        ...(r.memoryError ? { avisoMemoria: r.memoryError } : {}),
        googleDrive: r.drive
          ? { enviado: r.drive.name }
          : ctx.backups.status().driveError || 'não conectado ou desligado',
      };
    },
    vesta_backup_list: async () => {
      const status = ctx.backups.status();
      let drive = null;
      if (status.cloud?.connected)
        try {
          drive = (await ctx.drive.list()).slice(0, 10).map((f) => ({
            nome: f.name,
            tamanhoBytes: f.size,
            em: new Date(f.createdAt).toISOString(),
            computador: f.computer,
          }));
        } catch (e) {
          drive = 'erro: ' + e.message;
        }
      return {
        pasta: status.folder,
        computador: status.backups.map((b) => ({
          nome: b.name,
          tamanhoBytes: b.size,
          em: new Date(b.mtime).toISOString(),
        })),
        googleDrive: drive || 'não conectado',
      };
    },
    vesta_open_settings: (chat, a) => {
      ctx.emit({ type: 'open-settings', section: a.section });
      return { ok: true, aberto: 'Preferências → ' + a.section };
    },
  };
  return createMcpHost({
    name: NAME,
    tools: TOOLS,
    authorize,
    // "Só consulta" chats see the preferences and can open the screen, but change nothing.
    visible: (chat) => (chat && chat.mode === 'read' ? READ_ONLY : null),
    call: (chat, name, args) => handlers[name](chat, args),
  });
}
// The value of a setting key inside snapshot().
function find(snap, key) {
  for (const group of Object.values(snap)) if (group && typeof group === 'object' && key in group) return group[key];
  return undefined;
}

// Line added to the prompt of chats that have the server.
function appHint(mode) {
  return mode === 'read'
    ? 'Pelas ferramentas do servidor "' +
        NAME +
        '" você pode consultar as preferências do VeSTA e abrir a tela Preferências; neste modo, não altere nada.'
    : 'Pelas ferramentas do servidor "' +
        NAME +
        '" você pode consultar e mudar as preferências do VeSTA (aparência, memória, segundo plano e backup) e fazer backups, quando a pessoa pedir. Não mude preferências por conta própria.';
}

module.exports = { createAppMcp, appHint, TOOLS, NAME, UPDATE, SECTIONS, READ_ONLY };
