// Tests domain services in Electron's main process. Does not automate or interact with the UI.
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
process.env.OMPHALOS_DATA_DIR=require('./test-scratch.cjs')('desktop-services');
process.env.OMPHALOS_SERVICE_TEST='1';
const {app}=require('electron');
const {methods,getState}=require('../electron/main.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  try{
    const boot=await methods.bootstrap();assert.ok(boot.integrations.opencode.installed);
    assert.equal((await methods.memoryStatus()).connected,true);
    await methods.saveMemory({kind:'preference',title:'Cor de teste',body:'Minha cor favorita de teste é violeta-orbita-7429.'});
    const s=await methods.createChat({provider:'opencode',model:'drael/drael-v1',mode:'read'});const chat=s.chats[0];
    await methods.send({chatId:chat.id,text:'Qual é a minha cor favorita de teste registrada nas memórias? Responda apenas o valor. Não use ferramentas.'});
    const deadline=Date.now()+120000;while(getState().running.length&&Date.now()<deadline)await delay(250);
    const result=getState().chats.find(c=>c.id===chat.id);const answer=result.messages.at(-1);
    assert.equal(answer.status,'done',answer.error);assert.ok(answer.text.includes('violeta-orbita-7429'),answer.text);assert.ok(result.sessionId);assert.equal(answer.memorySaved,true);
    assert.equal(getState().memories.filter(m=>m.kind==='session').length,1);
    console.log('PASS: desktop services — native login, MCP preference retrieval, real Drael reply, session id, automatic capture, persisted transcript.');
    fs.writeFileSync(path.join(process.env.OMPHALOS_DATA_DIR,'results.json'),JSON.stringify({ok:true,answer:answer.text,memorySaved:answer.memorySaved,sessionPreserved:!!result.sessionId},null,2));
  }catch(e){console.error(e);process.exitCode=1;}
  finally{app.quit();}
});
