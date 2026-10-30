// The part of a backup that opens anywhere, without VeSTA: every conversation, the preferences and the AI Memory wiki
// as Markdown files, plus the LEIA-ME that explains the archive.
const fs = require('node:fs'),
  path = require('node:path');
const { slug } = require('../util/text.cjs');

const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode', drael: 'Drael' };
const when = (t) => (t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

function chatMarkdown(chat, projectName) {
  // Answers given before a switch of AI carry their own provider and model; the others are the chat's current ones.
  const author = (m) => {
    if (m.role === 'user') return 'Você';
    const provider = m.provider || chat.provider,
      model = m.model || (provider === chat.provider ? chat.model : '');
    return (PROVIDER_NAMES[provider] || provider) + (model ? ' (' + model + ')' : '');
  };
  const head = [
    '# ' + (chat.title || 'Conversa'),
    '',
    '- IA: ' + (PROVIDER_NAMES[chat.provider] || chat.provider) + (chat.model ? ' · ' + chat.model : ''),
    '- Projeto: ' + projectName,
    '- Criada em: ' + when(chat.createdAt),
    ...(chat.updatedAt ? ['- Última mensagem: ' + when(chat.updatedAt)] : []),
  ];
  const body = (chat.messages || [])
    .filter((m) => m.text || m.attachments?.length || m.error)
    .map((m) =>
      [
        '## ' + author(m) + ' · ' + when(m.createdAt),
        '',
        m.text || '',
        ...(m.attachments?.length ? ['', 'Anexos: ' + m.attachments.map((a) => a.name).join(', ')] : []),
        ...(m.error && m.status !== 'done' ? ['', '> ' + m.error] : []),
      ].join('\n')
    );
  return head.join('\n') + '\n\n' + body.join('\n\n') + '\n';
}

// "How you like to work": the profile the AIs learned plus the preferences and notes written in the app.
function preferencesMarkdown(state, profile) {
  const out = ['# Suas preferências', ''];
  out.push('## Aprendidas pelas IAs', '');
  if (profile === null)
    out.push('_O AI Memory não respondeu durante o backup; o arquivo restaurar/ai-memory.tar.gz as contém._');
  else if (!profile.length) out.push('_Nenhuma ainda._');
  else for (const p of profile) out.push('- **' + (p.category || 'geral') + '**: ' + p.statement.replace(/\n+/g, ' '));
  const own = (state.memories || []).filter((m) => m.kind === 'preference' || m.kind === 'note' || !m.kind);
  out.push('', '## Escritas por você', '');
  if (!own.length) out.push('_Nenhuma._');
  for (const m of own) {
    const where =
      m.kind === 'preference' ? 'todas as IAs' : state.projects.find((p) => p.id === m.projectId)?.name || 'pessoal';
    out.push('### ' + m.title + ' (' + where + ')', '', m.body || '', '');
  }
  return out.join('\n') + '\n';
}

// The AI Memory wiki is stored under <workspace-id>/<scope-id>/: each scope's _meta.md names its project.
function wikiFiles(wikiDir, projectName) {
  const files = {};
  if (!fs.existsSync(wikiDir)) return files;
  const labels = new Map();
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name),
        r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        const meta = path.join(abs, '_meta.md');
        if (fs.existsSync(meta)) {
          const m = /^project:\s*(.+)$/m.exec(fs.readFileSync(meta, 'utf8'));
          if (m) labels.set(r, slug(projectName(m[1].trim()), 40));
          else labels.set(r, null); // workspace level: dropped from the path
        }
        walk(abs, r);
      } else if (e.isFile() && e.name.endsWith('.md') && e.name !== '_meta.md') {
        const parts = r.split('/');
        const out = [];
        let prefix = '';
        for (const [i, part] of parts.entries()) {
          prefix = prefix ? prefix + '/' + part : part;
          if (i < parts.length - 1 && labels.has(prefix)) {
            const label = labels.get(prefix);
            if (label) out.push(label);
          } else out.push(part);
        }
        files['memoria-ia/' + out.join('/')] = fs.readFileSync(abs);
      }
    }
  };
  walk(wikiDir, '');
  return files;
}

function walkFiles(root, skip = () => false) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (skip(r)) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(root, '');
  return out;
}

function readme(manifest) {
  return `# Backup do VeSTA

Feito em ${when(manifest.createdAt)} pelo VeSTA ${manifest.appVersion}.

Tudo aqui abre em qualquer editor de texto, sem o VeSTA:

- **conversas/** — ${manifest.counts.chats} conversas em Markdown, uma pasta por projeto.
- **preferencias.md** — como você gosta de trabalhar: o que as IAs aprenderam e o que você escreveu.
- **memoria-ia/** — ${manifest.counts.wikiPages} páginas do AI Memory (resumos de sessões, decisões, regras e armadilhas), por projeto.

A pasta **restaurar/** serve para o VeSTA voltar a este ponto: em Preferências → Backup → "Restaurar de um backup",
escolha este .zip. O pareamento do celular não vai no backup (pareie de novo depois de restaurar).
${manifest.memoryError ? '\n> A memória (AI Memory) não respondeu durante este backup: ' + manifest.memoryError + '\n' : ''}`;
}

module.exports = { chatMarkdown, preferencesMarkdown, wikiFiles, walkFiles, readme, PROVIDER_NAMES };
