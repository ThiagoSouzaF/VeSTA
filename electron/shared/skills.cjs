// "/nome" of VeSTA skills inside a message, shared by the main process (what goes to the AI) and the composer (the
// "/" menu). Pure: no require.

const MAX_MENTIONS = 5;
const NAME = '[a-z0-9][a-z0-9-]{0,63}';
// A mention starts the message or follows a space, and ends at a space, a punctuation mark or the end: "src/app" and
// "https://x/y" are not mentions.
const MENTION = new RegExp('(^|\\s)/(' + NAME + ')(?=[\\s.,;:!?)]|$)', 'g');

// The skills mentioned in a message, in order and without repeats; isSkill(name) says which names are skills.
function mentions(text, isSkill) {
  const out = [];
  for (const m of String(text || '').matchAll(MENTION)) {
    const name = m[2];
    if (!out.includes(name) && isSkill(name)) out.push(name);
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

// The "/letras" being typed at the caret: { start, end, query }, or null when the caret is not at the end of one.
function slashAt(text, caret) {
  const src = String(text || '');
  const at = caret == null ? src.length : caret;
  if (at < src.length && !/\s/.test(src[at])) return null;
  const m = /(^|\s)\/([a-z0-9-]*)$/i.exec(src.slice(0, at));
  if (!m) return null;
  const start = m.index + m[1].length;
  return { start, end: at, query: m[2].toLowerCase() };
}

// Puts "/nome " where the token was; returns the new text and where the caret goes.
function completeSlash(text, token, name) {
  const src = String(text || '');
  const after = src.slice(token.end).replace(/^\s+/, '');
  const head = src.slice(0, token.start) + '/' + name + ' ';
  return { text: head + after, caret: head.length };
}

module.exports = { mentions, slashAt, completeSlash, MAX_MENTIONS };
