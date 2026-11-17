export const PROVIDERS = {
  codex: {
    name: 'ChatGPT',
    engine: 'via Codex',
    letter: '✳',
    color: 'green',
    description: 'Seu login e suas instruções do Codex.',
  },
  claude: {
    name: 'Claude',
    engine: 'via Claude Code',
    letter: '✺',
    color: 'orange',
    description: 'Seu Claude, com o contexto de sempre.',
  },
  drael: {
    name: 'Drael',
    engine: 'harness nativo',
    letter: '◈',
    color: 'violet',
    description: 'Terminal oficial Drael e suas ferramentas nativas.',
  },
  opencode: {
    name: 'Drael (OpenCode)',
    engine: 'via OpenCode',
    letter: '◈',
    color: 'violet',
    description: 'A Drael que você já configurou no OpenCode.',
  },
};
export const THEME_NAMES = { ink: 'Tinta Mangá', obsidian: 'Obsidiana', aurora: 'Aurora', paper: 'Papel' };
export const THEMES = ['ink', 'obsidian', 'aurora', 'paper'];
export const empty = {
  settings: {
    theme: 'ink',
    accent: 'ember',
    background: 'rain',
    memoryEnabled: true,
    capture: true,
    fontScale: 1,
  },
  projects: [],
  chats: [],
  memories: [],
  quests: [],
  running: [],
};
export const MODEL_LABELS = {
  'claude-fable-5-2': 'Fable 5.2',
  'claude-fable-5-1': 'Fable 5.1',
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
};
