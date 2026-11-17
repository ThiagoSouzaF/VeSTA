// The login an AI gets from VeSTA itself, added to the environment of its chats and of its native terminal:
// Drael's key (native login or OpenCode's). The others log in on their own.
const drael = require('./drael.cjs');

function authEnv(id) {
  return id === 'drael' ? drael.authEnv() : {};
}
module.exports = { authEnv };
