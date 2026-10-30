// Merges parser events (activities, subagents) into a stored assistant message.
const { capList, MAX_STEPS, MAX_ACTIVITIES } = require('../../shared/tasks.cjs');

// Merges a subagent event into a message's list (upsert by toolUseId), stamping start/end times.
// Steps carry their own startedAt/endedAt; old steps beyond MAX_STEPS are folded into `stepsDropped`.
function upsertSubagent(list, ev, now = Date.now()) {
  const { type, step, ...fields } = ev;
  for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
  let rec = list.find((s) => s.toolUseId === fields.toolUseId);
  if (!rec) {
    rec = { startedAt: now, status: 'running' };
    list.push(rec);
  }
  Object.assign(rec, fields);
  if (step) {
    rec.steps = rec.steps || [];
    const i = rec.steps.findIndex((x) => x.id === step.id);
    if (i >= 0) rec.steps[i] = stamp({ ...rec.steps[i], ...step }, now);
    else rec.steps.push(stamp({ at: now, startedAt: now, ...step }, now));
    const dropped = capList(rec.steps, MAX_STEPS);
    if (dropped) rec.stepsDropped = (rec.stepsDropped || 0) + dropped;
  }
  if (rec.status !== 'running' && !rec.endedAt) rec.endedAt = now;
  if (rec.status === 'running') delete rec.endedAt;
  return rec;
}
// Start/end bookkeeping shared by activities and steps.
function stamp(a, now) {
  if (a.status && a.status !== 'running') a.endedAt = a.endedAt || now;
  else if (a.status === 'running') delete a.endedAt;
  return a;
}
// Same for generic activities carrying an id (codex emits started/completed for the same item).
function upsertActivity(list, ev, now = Date.now()) {
  const { type, ...a } = ev;
  for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k];
  if (a.id) {
    const i = list.findIndex((x) => x.id === a.id);
    if (i >= 0) {
      list[i] = stamp({ ...list[i], ...a }, now);
      return list[i];
    }
  }
  const rec = stamp({ startedAt: now, ...a }, now);
  list.push(rec);
  return rec;
}
// Applies an activity/subagent parser event to a stored assistant message and returns the stream event to send
// to the renderer (or null for other event types). Long runs keep every running task; only old finished ones are
// folded into "+N anteriores". A subagent event carries only the step that changed.
function applyToMessage(message, event, now = Date.now()) {
  if (event.type === 'activity') {
    message.activities = message.activities || [];
    const activity = upsertActivity(message.activities, event, now);
    message.activitiesDropped = (message.activitiesDropped || 0) + capList(message.activities, MAX_ACTIVITIES);
    return { type: 'activity', messageId: message.id, activity };
  }
  if (event.type === 'subagent') {
    message.subagents = message.subagents || [];
    const rec = upsertSubagent(message.subagents, event, now),
      { steps, ...fields } = rec,
      step = event.step && (steps || []).find((x) => x.id === event.step.id);
    return { type: 'subagent', messageId: message.id, subagent: { ...fields, ...(step ? { step } : {}) } };
  }
  return null;
}
module.exports = { upsertSubagent, upsertActivity, applyToMessage, stamp };
