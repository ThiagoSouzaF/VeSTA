import tasks from '../../electron/shared/tasks.cjs';

export function patchMessage(m, e) {
  if (e.type === 'text') return { ...m, text: m.text + e.text };
  if (e.type === 'permission') {
    const list = [...(m.permissions || [])],
      i = list.findIndex((x) => x.id === e.permission.id);
    if (i >= 0) list[i] = { ...list[i], ...e.permission };
    else list.push(e.permission);
    return { ...m, permissions: list };
  }
  if (e.type === 'activity') {
    const list = [...(m.activities || [])],
      a = e.activity,
      i = a.id ? list.findIndex((x) => x.id === a.id) : -1;
    if (i >= 0) list[i] = { ...list[i], ...a };
    else list.push(a);
    return { ...m, activities: list };
  }
  const list = [...(m.subagents || [])],
    { step, ...fields } = e.subagent,
    i = list.findIndex((x) => x.toolUseId === fields.toolUseId);
  let rec = i >= 0 ? { ...list[i], ...fields } : fields;
  // A subagent event carries only the step that changed; the steps already shown are kept.
  if (step) {
    const steps = [...(rec.steps || [])],
      j = steps.findIndex((x) => x.id === step.id);
    if (j >= 0) steps[j] = { ...steps[j], ...step };
    else steps.push(step);
    const dropped = tasks.capList(steps, tasks.MAX_STEPS);
    rec = { ...rec, steps, ...(dropped ? { stepsDropped: (rec.stepsDropped || 0) + dropped } : {}) };
  }
  if (i >= 0) list[i] = rec;
  else list.push(rec);
  return { ...m, subagents: list };
}
