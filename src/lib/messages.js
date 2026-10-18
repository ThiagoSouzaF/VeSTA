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
    s = e.subagent,
    i = list.findIndex((x) => x.toolUseId === s.toolUseId);
  if (i >= 0) list[i] = { ...list[i], ...s };
  else list.push(s);
  return { ...m, subagents: list };
}
