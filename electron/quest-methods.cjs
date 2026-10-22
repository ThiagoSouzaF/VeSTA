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
// Like the others, but the renderer also needs the id of the chat it should open.
const questChat = (ctx) => (args) => ({ chatId: ctx.quests.questChat(args || {}), state: ctx.state() });
function questMethods(ctx) {
  return {
    ...Object.fromEntries(
      NAMES.map((name) => [
        name,
        (args) => {
          ctx.quests[name](args || {});
          return ctx.state();
        },
      ])
    ),
    questChat: questChat(ctx),
  };
}
module.exports = { questMethods };
