// IPC surface of the quests: thin wrappers over the engine (created once the store is ready).
const NAMES = [
  'createQuest',
  'updateQuest',
  'replan',
  'startQuest',
  'pauseQuest',
  'resumeQuest',
  'cancelQuest',
  'retryStep',
  'skipStep',
  'deleteQuest',
];
function questMethods(ctx) {
  return Object.fromEntries(
    NAMES.map((name) => [
      name,
      (args) => {
        ctx.quests[name](args || {});
        return ctx.state();
      },
    ])
  );
}
module.exports = { questMethods };
