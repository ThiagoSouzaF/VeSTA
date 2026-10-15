const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {command,parser,memoryTools,memoryHint,MEMORY_SERVER}=require('../electron/providers.cjs');
const {Memory}=require('../electron/memory.cjs');
const endpoint={url:'http://127.0.0.1:50001',mcp:'http://127.0.0.1:50001/mcp',token:'secret-token-value'};
test('without an endpoint no provider gets memory tools',()=>{for(const provider of ['claude','codex','opencode']){const c=command({provider,mode:'edit'},'x.exe');assert.ok(!c.args.join(' ').includes(MEMORY_SERVER));assert.ok(!Object.keys(c.env).some(k=>k.startsWith('VESTA_')||k==='OPENCODE_CONFIG_CONTENT'));}});
test('memory tools are registered per launch and the token never goes on the command line',()=>{
  const claude=command({provider:'claude',mode:'edit'},'claude.exe',endpoint);
  const config=JSON.parse(claude.args[claude.args.indexOf('--mcp-config')+1]);
  assert.equal(config.mcpServers[MEMORY_SERVER].url,endpoint.mcp);assert.equal(config.mcpServers[MEMORY_SERVER].type,'http');
  assert.ok(claude.args.includes('mcp__'+MEMORY_SERVER));
  const codex=command({provider:'codex',mode:'edit',sessionId:'s1'},'codex.exe',endpoint);
  assert.ok(codex.args.includes('mcp_servers.'+MEMORY_SERVER+'.url="'+endpoint.mcp+'"'));assert.equal(codex.args[0],'app-server');assert.equal(codex.resume,'s1');
  const opencode=command({provider:'opencode',mode:'edit'},'opencode.exe',endpoint);
  assert.equal(JSON.parse(opencode.env.OPENCODE_CONFIG_CONTENT).mcp[MEMORY_SERVER].url,endpoint.mcp);
  for(const c of [claude,codex,opencode]){assert.ok(!c.args.join(' ').includes(endpoint.token));assert.equal(c.env.VESTA_MEMORY_TOKEN,endpoint.token);}
  assert.ok(!opencode.env.OPENCODE_CONFIG_CONTENT.includes(endpoint.token));
});
test('memory hint names the chat scope',()=>{assert.match(memoryHint('p-1'),/project "p-1"/);assert.match(memoryHint(null),/project "inbox"/);assert.match(memoryHint(null),/workspace "omphalos"/);});
test('memory tool calls show as memory activities in every provider',()=>{
  const ev=[];parser('claude',e=>ev.push(e)).accept({type:'assistant',message:{content:[{type:'tool_use',id:'t1',name:'mcp__'+MEMORY_SERVER+'__memory_query',input:{query:'auth'}}]}});
  assert.equal(ev[0].kind,'memory');assert.equal(ev[0].label,'Memória · memory_query');assert.equal(ev[0].detail,'auth');
  const cx=[];parser('codex',e=>cx.push(e)).accept({method:'item/completed',params:{item:{id:'i1',type:'mcpToolCall',server:MEMORY_SERVER,tool:'memory_write_page',status:'completed',arguments:{path:'agentes/x.md'}}}});
  assert.equal(cx[0].kind,'memory');assert.equal(cx[0].label,'Memória · memory_write_page');
  const oc=[];parser('opencode',e=>oc.push(e)).accept({type:'tool_use',part:{tool:MEMORY_SERVER+'_memory_query',callID:'c1',state:{status:'completed',input:{}}}});
  assert.equal(oc[0].kind,'memory');
  assert.equal(memoryTools('claude',null).args.length,0);
});
const exe=path.join(__dirname,'../runtime/ai-memory.exe');
test('one HTTP server is shared by the app and an outside MCP client',{skip:!fs.existsSync(exe)&&'ai-memory.exe ausente',timeout:60000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omphalos-mem-'));const m=new Memory(exe,dir);
  try{
    const ep=await m.agentEndpoint();assert.match(ep.mcp,/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const denied=await fetch(ep.mcp,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
    assert.equal(denied.status,401);
    await m.ensureProject('proj-x');
    // An agent-side client writes; the app's own query sees it, because both talk to the same server.
    const {Client}=require('@modelcontextprotocol/sdk/client/index.js');const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const agent=new Client({name:'agent',version:'1'});await agent.connect(new StreamableHTTPClientTransport(new URL(ep.mcp),{requestInit:{headers:{Authorization:'Bearer '+ep.token}}}));
    const w=await agent.callTool({name:'memory_write_page',arguments:{path:'agentes/zebra.md',body:'# Zebra\n\nDecisão: usar a palavra quimera42 como marcador.',workspace:'omphalos',project:'proj-x'}});assert.ok(!w.isError,JSON.stringify(w));
    await agent.close();
    assert.match(await m.query('quimera42','proj-x'),/zebra/i);
    assert.equal(fs.readFileSync(path.join(dir,'vesta-server.pid'),'utf8'),String(m.server.pid));
  }finally{await m.close();}
  // A server left behind by a crashed run is reaped on the next start instead of holding the data-dir lock.
  const first=new Memory(exe,dir);await first.agentEndpoint();const orphan=first.server;orphan.removeAllListeners('exit');first.server=null;first.client=null;first.endpoint=null;
  const second=new Memory(exe,dir);try{await second.agentEndpoint();assert.notEqual(second.server.pid,orphan.pid);assert.match(await second.query('quimera42','proj-x'),/zebra/i);}finally{await second.close();try{orphan.kill()}catch{}}
});
