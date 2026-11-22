// A skill's health, checked when it is brought into VeSTA (from another AI, GitHub, a file or pasted) and again on the
// adapted text. Principles from NVIDIA SkillEvaluator's static tier, ported to plain checks with no model, no key and
// no network: hidden Unicode, secrets, commands that pull unpinned code or pipe a download into a shell, text that
// asks to skip permissions, a description that does not say when to use the skill, a body too large, and a
// description so close to another skill's that the AI may pick the wrong one.
// -> [{ id, level: 'risk' | 'warn' | 'tip', text, where? }]. A secret's value never leaves this module.
const F = require('./format.cjs');

const MAX_TOKENS = 5000;
const HIDDEN = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/gu;
// Most specific first: an Anthropic key also starts with "sk-".
const SECRETS = [
  ['chave da Anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['chave da OpenAI', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ['token do GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['chave da AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['chave do Google', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['token do Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['chave da NVIDIA', /\bnvapi-[A-Za-z0-9_-]{20,}/],
  ['chave privada', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
];
const PIPE_TO_SHELL =
  /\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|iex|Invoke-Expression|python3?)\b/i;
const SKIP_RULES =
  /ignore (?:all |any )?(?:the )?(?:previous|prior|above) instructions|ignore as instruções anteriores|--dangerously-skip-permissions|--dangerously-bypass-approvals|\bbypassPermissions\b|--yolo\b/i;
const PRIVATE_PATHS = /~[\\/]\.ssh\b|\bid_(?:rsa|ed25519)\b|\.aws[\\/]credentials|\.netrc\b|Login Data\b/;
const RUNNER = /\b(npx|bunx|pnpm dlx|uvx|pipx run)\s+((?:-[-\w=]+\s+)*)([@\w][\w./@^~-]*)/g;
const TRIGGER = /\b(?:use|usar|use-a|quando|sempre que|ao pedir|when|whenever)\b/i;

// "pkg@1.2.3" and "@scope/pkg@1" are pinned; "pkg", "pkg@latest" and "@scope/pkg" are not.
const pinned = (spec) => /^(?:@[^/@\s]+\/)?[^@\s]+@(?!latest\b|next\b)[\w.^~-]+$/.test(spec);

function unpinned(text) {
  const out = [];
  for (const m of text.matchAll(RUNNER)) {
    if (/(?:^|\s)(?:-p|--package)(?:\s|=|$)/.test(m[2])) continue; // the package is named by a flag: not judged
    if (!pinned(m[3])) out.push(m[1] + ' ' + m[3]);
  }
  return [...new Set(out)];
}

function duplicateKeys(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text).replace(/^﻿/, ''));
  if (!m) return [];
  const seen = new Set(),
    dup = new Set();
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z][\w-]*):/.exec(line)?.[1];
    if (k) (seen.has(k) ? dup : seen).add(k);
  }
  return [...dup];
}

const words = (s) =>
  new Set(
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
  );
function similarity(a, b) {
  const A = words(a),
    B = words(b);
  if (A.size < 4 || B.size < 4) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

// skill: { name, text, files?: [{ path, text }] }; others: [{ name, description }] already in the library.
function checkSkill(skill, { others = [] } = {}) {
  const found = [];
  const add = (id, level, text, where) => found.push(where ? { id, level, text, where } : { id, level, text });
  const docs = [
    { path: 'SKILL.md', text: String(skill.text || '') },
    ...(skill.files || []).filter((f) => typeof f.text === 'string'),
  ];

  for (const d of docs) {
    const hidden = (d.text.replace(/^﻿/, '').match(HIDDEN) || []).length;
    if (hidden)
      add(
        'hidden-unicode',
        'risk',
        hidden + ' caractere(s) invisível(is): podem esconder instruções que você não vê na tela.',
        d.path
      );
    const secret = SECRETS.find(([, re]) => re.test(d.text));
    if (secret) add('secret', 'risk', 'Parece ter um segredo no texto (' + secret[0] + ').', d.path);
    if (PIPE_TO_SHELL.test(d.text))
      add('pipe-to-shell', 'risk', 'Baixa um script da internet e roda direto no terminal.', d.path);
    if (SKIP_RULES.test(d.text))
      add('skip-rules', 'risk', 'Pede para ignorar instruções anteriores ou pular permissões.', d.path);
    if (PRIVATE_PATHS.test(d.text))
      add('private-paths', 'warn', 'Cita arquivos de credenciais (chaves SSH, AWS ou senhas salvas).', d.path);
    const loose = unpinned(d.text);
    if (loose.length)
      add(
        'unpinned',
        'warn',
        'Roda pacote sem versão fixa (' + loose.slice(0, 3).join(', ') + (loose.length > 3 ? '…' : '') + ').',
        d.path
      );
  }

  const { data } = F.parseSkill(skill.text);
  const desc = String(data.description || '').trim();
  if (!desc) add('no-description', 'warn', 'Sem descrição: no modo automático a IA não sabe quando usar a skill.');
  else if (desc.length < 20) add('short-description', 'warn', 'Descrição curta demais para a IA saber quando usar.');
  else if (desc.length > 1024) add('long-description', 'warn', 'Descrição com mais de 1.024 caracteres: é cortada.');
  if (desc && !TRIGGER.test(desc.slice(0, 80)))
    add('trigger', 'tip', 'A descrição não diz logo no começo quando usar a skill ("Use quando…").');
  const dup = duplicateKeys(skill.text);
  if (dup.length) add('duplicate-keys', 'warn', 'Campo repetido no cabeçalho (' + dup.join(', ') + ').');
  const size = F.tokens(skill.text);
  if (size > MAX_TOKENS)
    add('large', 'warn', 'Grande (~' + size + ' tokens a cada uso): o detalhe cabe melhor nos arquivos de apoio.');

  const twin = others
    .filter((o) => o.name !== skill.name && desc)
    .map((o) => ({ name: o.name, s: similarity(desc, o.description) }))
    .sort((a, b) => b.s - a.s)[0];
  if (twin && twin.s >= 0.5)
    add('lookalike', 'warn', 'Descrição parecida com a de /' + twin.name + ': a IA pode escolher a errada.');

  const order = { risk: 0, warn: 1, tip: 2 };
  return found.sort((a, b) => order[a.level] - order[b.level]);
}

const count = (found, level) => found.filter((f) => f.level === level).length;

module.exports = { checkSkill, count, unpinned, similarity, MAX_TOKENS };
