// Permission requests from agents (and their subagents) waiting for the user's answer, plus the per-chat
// "always allow" rules. Provider drivers call ask(); the UI answers through answer().
const { randomUUID } = require('node:crypto');
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
// Codex wraps commands as `"...powershell.exe" -Command '<cmd>'`: show and match the inner command.
function plainCommand(command) {
  const s = String(command || '').trim();
  const m = /powershell(?:\.exe)?"?\s+(?:-NoProfile\s+)?-Command\s+(['"])([\s\S]*)\1\s*$/i.exec(s);
  return (m ? m[2] : s).trim();
}
// "Always in this chat" covers the same program for commands (`npm …`), or the whole tool otherwise.
function ruleFor({ tool, command }) {
  if (command) {
    const word = plainCommand(command)
      .split(/\s+/)[0]
      .replace(/^["']|["']$/g, '')
      .split(/[\\/]/)
      .pop()
      .toLowerCase();
    if (word) return { key: 'cmd:' + word, label: 'comandos "' + word + ' …"' };
  }
  const name = String(tool || 'ferramenta').toLowerCase();
  return {
    key: 'tool:' + name,
    label: name === 'edit' || name === 'write' ? 'edições de arquivo' : 'a ferramenta ' + tool,
  };
}
class Permissions {
  // onUpdate(chatId, record) persists and broadcasts; rules(chatId) returns that chat's saved rule list (mutable).
  constructor({ onUpdate, rules }) {
    this.onUpdate = onUpdate;
    this.rules = rules;
    this.pending = new Map();
  }
  ask(chatId, request) {
    const rule = ruleFor(request);
    const record = {
      id: randomUUID(),
      chatId,
      provider: request.provider,
      tool: clip(request.tool, 80),
      title: clip(request.title, 200),
      command: request.command ? clip(plainCommand(request.command), 4000) : '',
      detail: clip(request.detail, 4000),
      subagent: request.subagent ? clip(request.subagent, 200) : '',
      rule: rule.label,
      createdAt: Date.now(),
      status: 'pending',
    };
    const saved = this.rules(chatId);
    if (saved?.includes(rule.key)) {
      record.status = 'auto';
      record.answeredAt = Date.now();
      this.onUpdate(chatId, record);
      return Promise.resolve({ allow: true, always: true });
    }
    this.onUpdate(chatId, record);
    return new Promise((resolve) => this.pending.set(record.id, { record, rule, resolve }));
  }
  // decision: 'once' | 'always' | 'deny'
  answer(id, decision) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    const allow = decision === 'once' || decision === 'always';
    if (decision === 'always') {
      const saved = this.rules(p.record.chatId);
      if (saved && !saved.includes(p.rule.key)) saved.push(p.rule.key);
    }
    Object.assign(p.record, {
      status: allow ? (decision === 'always' ? 'always' : 'allowed') : 'denied',
      answeredAt: Date.now(),
    });
    this.onUpdate(p.record.chatId, p.record);
    p.resolve({
      allow,
      always: decision === 'always',
      message: allow ? undefined : 'O usuário negou esta ação no VeSTA.',
    });
    return true;
  }
  // A stopped or finished response leaves nothing waiting: pending requests are denied.
  cancelChat(chatId, reason = 'cancelled') {
    for (const [id, p] of this.pending)
      if (p.record.chatId === chatId) {
        this.pending.delete(id);
        Object.assign(p.record, { status: reason, answeredAt: Date.now() });
        this.onUpdate(chatId, p.record);
        p.resolve({ allow: false, message: 'A resposta foi interrompida.' });
      }
  }
  waiting(chatId) {
    return [...this.pending.values()].filter((p) => p.record.chatId === chatId).map((p) => p.record);
  }
}
module.exports = { Permissions, ruleFor, plainCommand };
