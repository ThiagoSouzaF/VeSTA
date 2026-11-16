// The login an AI gets from VeSTA itself, added to the environment of its chats and of its native terminal:
// Drael's key (native login or OpenCode's) and the Gemini API key saved in Conexões. The others log in on their own.
const drael = require('./drael.cjs');
const gemini = require('./gemini.cjs');

function authEnv(id, ctx) {
  if (id === 'drael') return drael.authEnv();
  if (id === 'gemini') return gemini.authEnv(ctx);
  return {};
}
module.exports = { authEnv };
