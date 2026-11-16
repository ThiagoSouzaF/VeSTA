const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const providers = require('./providers.cjs');
const drael = require('./drael.cjs');
const gemini = require('./gemini.cjs');
const { PROVIDER_IDS } = require('../shared/quests.cjs');

// How to ask a CLI its version: Drael and Gemini are Node scripts run by a node.exe.
function versionCall(id, exe) {
  if (id === 'drael') return { exe, args: [drael.script(exe), '--version'] };
  if (id === 'gemini') return gemini.launch(exe, ['--version']);
  return { exe, args: ['--version'] };
}
async function discover(ctx) {
  const entries = await Promise.all(
    PROVIDER_IDS.map(async (id) => {
      const exe = providers.locate(id);
      let version = '',
        authenticated = null;
      if (exe)
        try {
          const v = versionCall(id, exe);
          version = (await providers.run(v.exe, v.args)).trim().split('\n')[0];
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
  integrations.gemini.models = gemini.MODELS;
  if (integrations.gemini.installed) integrations.gemini.authenticated = gemini.authenticated();
  integrations.drael.authenticated = !!drael.authEnv().DRAEL_KEY;
  integrations.claude.models = ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
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
