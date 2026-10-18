// E2E: a real agent launched by VeSTA calls the AI Memory MCP tools on its own (query + write), in an isolated data dir.
// Usage: npx electron scripts/test-memory-agent.cjs [claude|codex|opencode] [model]
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const provider=process.argv.find(a=>['claude','codex','opencode'].includes(a))||'claude';
const model=process.argv[process.argv.indexOf(provider)+1]||(provider==='claude'?'claude-haiku-5-5':'');
const data=require('./test-scratch.cjs')('memory-agent'),projectDir=path.join(data,'projeto-e2e');
fs.mkdirSync(projectDir,{recursive:true});
// A project the chat belongs to, so the memory scope is a real projectId and not the inbox.
fs.writeFileSync(path.join(data,'vesta.json'),JSON.stringify({version:2,projects:[{id:'proj-e2e',name:'projeto-e2e',path:projectDir,createdAt:Date.now()}],chats:[],memories:[]}));
process.env.VESTA_DATA_DIR=data;process.env.VESTA_SERVICE_TEST='1';
delete process.env.CLAUDECODE;delete process.env.CLAUDE_CODE_ENTRYPOINT;
const {app}=require('electron');
const {methods,getState}=require('../electron/main.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  try{
    await methods.bootstrap();
    assert.equal((await methods.memoryStatus()).connected,true);
    await methods.saveMemory({kind:'note',projectId:'proj-e2e',title:'Codinome do lançamento',body:'O codinome interno do lançamento é farol-ametista-913.'});
    // The prompt shares no word with the note, so the automatic pre-query cannot hand the value over: only the agent's own memory_query can.
    const s=await methods.createChat({provider,model,projectId:'proj-e2e',mode:'edit',memory:true});const chat=s.chats[0];
    const marker='confirmado-'+provider+'-'+Date.now().toString(36);
    await methods.send({chatId:chat.id,text:'Tarefa de teste. 1) Chame a ferramenta memory_query do servidor MCP vesta-memory buscando pela palavra formada ao juntar "lança" e "mento", para descobrir o valor guardado. 2) Chame memory_write_page gravando a página "agentes/e2e.md" com o corpo "# E2E\\n\\nMarcador: '+marker+'". 3) Responda só o valor encontrado no passo 1. Não use outras ferramentas nem leia arquivos.'});
    const deadline=Date.now()+240000;while(getState().running.length&&Date.now()<deadline)await delay(250);
    const answer=getState().chats.find(c=>c.id===chat.id).messages.at(-1);
    const memoryCalls=answer.activities.filter(a=>a.kind==='memory'&&a.label?.startsWith('Memória · ')).map(a=>a.label+' ['+a.status+'] '+(a.detail||''));
    console.log('Atividades de memória do agente:\n  '+memoryCalls.join('\n  '));
    console.log('Resposta:',answer.text.trim().slice(0,300));
    assert.equal(answer.status,'done',answer.error);
    assert.ok(memoryCalls.some(l=>l.includes('memory_query')),'o agente não chamou memory_query');
    assert.ok(memoryCalls.some(l=>l.includes('memory_write_page')),'o agente não chamou memory_write_page');
    assert.ok(answer.text.includes('farol-ametista-913'),'resposta sem o valor da memória');
    const found=await methods.searchMemory({query:marker,projectId:'proj-e2e'});
    assert.ok(found.includes(marker)||/e2e/i.test(found),'página gravada pelo agente não encontrada no escopo do projeto: '+found.slice(0,500));
    console.log('PASS: '+provider+' consultou e gravou no AI Memory sozinho, no escopo vesta/proj-e2e.');
  }catch(e){console.error('FAIL:',e.message);process.exitCode=1;}
  finally{app.quit();}
});
