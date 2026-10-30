const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const providers = require('./providers.cjs');
const drael = require('./drael.cjs');
async function discover(ctx) {
  const entries = await Promise.all(
    ['codex', 'claude', 'drael', 'opencode'].map(async (id) => {
      const exe = providers.locate(id);
      let version = '',
        authenticated = null;
      if (exe)
        try {
          version = (await providers.run(exe, id === 'drael' ? [drael.script(exe), '--version'] : ['--version']))
            .trim()
            .split('\n')[0];
          if (id === 'codex') {
            await providers.run(exe, ['login', 'status']);
            authenticated = true;
          }
          if (id === 'claude') authenticated = !!JSON.parse(await providers.run(exe, ['auth', 'status'])).loggedIn;
        } catch {}
      return [id, { id, installed: !!exe, exe, version, authenticated }];
    })
  );
  const integrations = (ctx.integrations = Object.fromEntries(entries));
  // Codex keeps the official model list (with picker visibility) in its own cache; Claude takes aliases or full ids.
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex', 'models_cache.json'), 'utf8'));
    integrations.codex.models = (cache.models || [])
      .filter((m) => m.slug && m.visibility !== 'hide')
      .map((m) => m.slug);
  } catch {
    integrations.codex.models = [];
  }
  integrations.drael.models = ['drael-v1'];
  integrations.drael.authenticated = !!drael.authEnv().DRAEL_KEY;
  integrations.claude.models = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
  if (integrations.opencode.installed)
    try {
      integrations.opencode.models = (await providers.run(integrations.opencode.exe, ['models']))
        .split(/\r?\n/)
        .filter((l) => /^[\w.-]+\/.+/.test(l));
    } catch (e) {
      integrations.opencode.error = e.message;
    }
  return integrations;
}
module.exports = { discover };
