// Writes a vesta.json with a long conversation (and seeded usage) into a throwaway data dir, for UI tests and benchmarks.
const fs = require('node:fs'),
  path = require('node:path');
// A long conversation and seeded usage, written to the store before the app opens.
function seedStore(dataDir, { turns = 40 } = {}) {
  const now = Date.now(),
    day = (n) => {
      const d = new Date(now - n * 86400000),
        p = (x) => String(x).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    };
  const messages = [];
  for (let i = 0; i < turns; i++) {
    messages.push({
      id: 'u' + i,
      role: 'user',
      text: 'Pergunta número ' + i,
      createdAt: now - 1000 * (2 * turns - 2 * i),
    });
    messages.push({
      id: 'a' + i,
      role: 'assistant',
      text:
        '### Resposta ' +
        i +
        '\n\n' +
        'Um parágrafo de exemplo para ocupar espaço na conversa, com texto suficiente para quebrar linha.\n\n' +
        '- item um\n- item dois\n- item três\n\n```js\nconst x = ' +
        i +
        ';\nconsole.log(x);\n```\n',
      createdAt: now - 1000 * (2 * turns - 1 - 2 * i),
      activities: [],
      subagents: [],
      status: 'done',
      provider: 'claude',
      model: '',
    });
  }
  const chat = (id, title, msgs) => ({
    id,
    title,
    provider: 'claude',
    model: '',
    agent: '',
    projectId: null,
    mode: 'edit',
    messages: msgs,
    sessionId: null,
    createdAt: now,
    updatedAt: now,
    memory: false,
  });
  const t = (i, o, c, cost, turns = 2) => ({ inputTokens: i, outputTokens: o, cacheTokens: c, costUsd: cost, turns });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'vesta.json'),
    JSON.stringify({
      version: 2,
      settings: { memoryEnabled: false, capture: false, memoryTools: false },
      projects: [],
      chats: [
        chat('chat-long', 'Conversa longa', messages),
        chat('chat-short', 'Conversa curta', messages.slice(0, 2)),
      ],
      memories: [],
      usage: {
        rateLimit: {
          codex: {
            planType: 'plus',
            updatedAt: now,
            windows: [
              {
                id: 'primary',
                label: 'Janela de 5 horas',
                utilization: 0.42,
                resetsAt: now + 3 * 3600000,
                durationMins: 300,
              },
              {
                id: 'secondary',
                label: 'Janela semanal',
                utilization: 0.07,
                resetsAt: now + 5 * 86400000,
                durationMins: 10080,
              },
            ],
          },
          claude: {
            updatedAt: now,
            windows: [
              {
                id: 'five_hour',
                label: 'Janela de 5 horas',
                utilization: 0.91,
                resetsAt: now + 3600000,
                durationMins: 300,
              },
            ],
          },
        },
        daily: {
          [day(0)]: { claude: t(1200, 800, 5000, 0.75), codex: t(3000, 900, 100, 0), drael: t(10, 20, 0, 0.01, 1) },
          [day(2)]: { claude: t(2000, 100, 0, 1.25), opencode: t(500, 500, 0, 0, 1) },
        },
      },
    })
  );
}

module.exports = { seedStore };
