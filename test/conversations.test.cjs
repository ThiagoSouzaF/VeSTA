const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../electron/store.cjs');
const {switchProvider,handoff}=require('../electron/conversations.cjs');
test('switch preserves messages and authors, resets session, model and remembered permissions',()=>{
  const s=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'vesta-switch-')));
  const c=s.addChat({provider:'codex',model:'original',mode:'ask'});
  c.sessionId='codex-session';c.permissionRules=['cmd:npm'];c.messages=[{role:'user',text:'Question'},{role:'assistant',status:'done',text:'Answer'}];
  assert.equal(switchProvider(c,'drael'),true);assert.equal(c.mode,'read');assert.equal(c.sessionId,null);assert.equal(c.model,'');assert.deepEqual(c.permissionRules,[]);
  assert.equal(c.messages[1].provider,'codex');assert.equal(c.messages[1].model,'original');assert.equal(c.messages.length,2);
  c.messages.push({role:'assistant',status:'done',provider:'drael',text:'Drael answer'});
  switchProvider(c,'opencode');assert.equal(c.model,'drael/drael-v1');assert.equal(c.messages[2].provider,'drael');
  switchProvider(c,'codex');assert.equal(c.sessionId,null);assert.equal(c.handoffPending,true);s.save();
  const restored=new Store(s.dir).chat(c.id);assert.equal(restored.provider,'codex');assert.equal(restored.messages[1].provider,'codex');assert.equal(restored.providerHistory[0].sessionId,'codex-session');
});
test('invalid or oversized switches fail before mutations; same provider is a no-op',()=>{
  const c={provider:'claude',sessionId:'keep',messages:[],model:'x'};
  assert.equal(switchProvider(c,'claude'),false);assert.equal(c.sessionId,'keep');assert.throws(()=>switchProvider(c,'invalid'),/inválida/);
  c.messages=[{role:'user',text:'x'.repeat(120001)}];assert.throws(()=>switchProvider(c,'codex'),/120 mil/);assert.equal(c.provider,'claude');assert.equal(c.sessionId,'keep');
});
test('handoff transfers completed text with attribution, excludes partial failures and preserves current prompt',()=>{
  const prompt=handoff([{role:'user',text:'marker 7429'},{role:'assistant',text:'OK',provider:'claude',status:'done'},{role:'assistant',text:'partial failure',status:'error'}],'current prompt');
  assert.match(prompt,/marker 7429/);assert.match(prompt,/claude/);assert.doesNotMatch(prompt,/partial failure/);assert.ok(prompt.endsWith('current prompt'));
});
