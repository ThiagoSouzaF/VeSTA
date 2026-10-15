const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { emptyUsage } = require('./usage.cjs');
const defaults = () => ({version: 2, settings: {theme: 'obsidian', accent: 'violet', memoryEnabled: true, capture: true, memoryTools: true, density: 'comfortable'}, projects: [], chats: [], memories: [], usage: emptyUsage()});
class Store {
  constructor(dir) { this.dir = dir; this.file = path.join(dir, 'omphalos.json'); fs.mkdirSync(dir, {recursive:true}); this.state = defaults(); if (fs.existsSync(this.file)) { try { const saved = JSON.parse(fs.readFileSync(this.file,'utf8')); this.state = {...this.state,...saved, settings:{...this.state.settings,...saved.settings}, usage:{...this.state.usage,...saved.usage, rateLimit:{...this.state.usage.rateLimit,...saved.usage?.rateLimit}, daily:{...saved.usage?.daily}}, version:Math.max(2,saved.version||1)}; if((saved.version||1)<2){for(const c of this.state.chats)c.mode='edit';this.save();} } catch (err) { throw new Error('Os dados do Omphalos não puderam ser lidos. O arquivo original foi preservado. '+err.message); } } }
  save() { const tmp = this.file+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.state,null,2),'utf8'); fs.renameSync(tmp,this.file); }
  chat(id) { const c = this.state.chats.find(c=>c.id===id); if(!c) throw new Error('Chat não encontrado'); return c; }
  addChat(input) { if(!['codex','claude','opencode'].includes(input.provider)) throw new Error('IA inválida'); const c = {id: randomUUID(),title:'Novo chat',provider:input.provider,model:input.model||'',agent:input.agent||'',projectId:input.projectId||null,mode:input.mode==='read'?'read':'edit',messages:[],sessionId:null,createdAt:Date.now(),updatedAt:Date.now(),memory:input.memory!==false}; this.state.chats.unshift(c); this.save(); return c; }
}
module.exports = {Store, defaults};
