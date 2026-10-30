// The quest model for the main process: the pure core shared with the screens (shared/quests.cjs) plus the parts
// only the main process uses (plan.cjs, brief.cjs).
module.exports = {
  ...require('../shared/quests.cjs'),
  ...require('./plan.cjs'),
  ...require('./brief.cjs'),
};
