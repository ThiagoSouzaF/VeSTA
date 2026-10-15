const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {spawn, execFileSync} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const redact = text => String(text).replace(/\b(?:sk-|dk-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/g,'[chave removida]').replace(/((?:api[_-]?key|authorization|password|senha|token)\s*[:=]\s*)[^\s,;]+/gi,'$1[removido]');
const scope = projectId => ({workspace:'omphalos', project:projectId||'inbox'});
const freePort = () => new Promise((resolve,reject)=>{const s=net.createServer();s.unref();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});
const wait = ms => new Promise(r=>setTimeout(r,ms));
// One HTTP server owns the data dir (ai-memory refuses a second `serve` on it); the app and every agent it launches share it.
class Memory {
  constructor(exe,dir) {this.exe=exe;this.dir=dir;this.client=null;this.server=null;this.endpoint=null;this.pending=null;this.error=null;this.log='';}
  async start() {
    if(this.server&&this.server.exitCode===null&&this.endpoint)return this.endpoint;
    fs.mkdirSync(this.dir,{recursive:true});
    const config=path.join(this.dir,'config.toml');
    // FTS works offline, without downloading an embedding model or calling a cloud provider.
    if(!fs.existsSync(config))fs.writeFileSync(config,'embedding_provider = "none"\nlog_level = "warn"\n');
    const pidFile=path.join(this.dir,'vesta-server.pid');reapOrphan(pidFile);
    const port=await freePort(),token=randomBytes(24).toString('hex'),url='http://127.0.0.1:'+port;
    // Loopback only, and a per-run bearer token keeps other local processes out of the store.
    const server=spawn(this.exe,['--data-dir',this.dir,'serve','--transport','http','--bind','127.0.0.1:'+port,'--workspace','omphalos','--project','inbox'],{env:{...process.env,AI_MEMORY_EMBEDDING_PROVIDER:'none',AI_MEMORY_AUTH_TOKEN:token},windowsHide:true,stdio:['ignore','pipe','pipe']});
    this.server=server;try{fs.writeFileSync(pidFile,String(server.pid));}catch{}
    const logs=b=>this.log=(this.log+b).slice(-6000);server.stdout.on('data',logs);server.stderr.on('data',logs);
    server.on('exit',()=>{if(this.server===server){this.server=null;this.endpoint=null;this.client=null;}});
    for(let i=0;i<100&&server.exitCode===null;i++){try{if((await fetch(url+'/healthz')).ok){this.endpoint={url,mcp:url+'/mcp',token};return this.endpoint;}}catch{}await wait(150);}
    stop(server);throw new Error(this.log.trim().split('\n').pop()||'O AI Memory não iniciou');
  }
  async connect() {
    if(this.client&&this.server)return this.client;
    if(this.pending)return this.pending;
    this.pending=(async()=>{
      const {mcp,token}=await this.start();
      const transport=new StreamableHTTPClientTransport(new URL(mcp),{requestInit:{headers:{Authorization:'Bearer '+token}}});
      const client=new Client({name:'vesta',version:'0.1.0'});
      client.onclose=()=>{if(this.client===client)this.client=null};
      try {await client.connect(transport);this.client=client;this.error=null;return client;}catch(e){this.error=e.message;await transport.close().catch(()=>{});throw e;}
    })().finally(()=>{this.pending=null});
    return this.pending;
  }
  // Address and credential handed to agents; starts the server when needed.
  async agentEndpoint() {await this.connect();return this.endpoint;}
  async call(name,args) {const client=await this.connect(); const result=await client.callTool({name,arguments:args},undefined,{timeout:20000}); const text=(result.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n'); if(result.isError)throw new Error(text||'Falha no AI Memory'); return text;}
  // A fresh project has no wiki yet: memory_query/memory_status fail until its first page exists.
  async ensureProject(projectId) {try{await this.call('memory_status',scope(projectId));}catch(e){if(!/not found in workspace/.test(e.message))throw e;await this.call('memory_write_page',{path:'omphalos/space.md',body:'# Espaço de trabalho\n\nEspaço de memória criado pelo VeSTA.',...scope(projectId)});}}
  async query(query,projectId) {const terms=String(query).match(/[\p{L}\p{N}_-]{3,}/gu)?.slice(0,12)||[];if(!terms.length)return '';const expression=terms.map(t=>'"'+t.replace(/"/g,'')+'"').join(' OR ');const args={query:expression,...scope(projectId),limit:6};try{return await this.call('memory_query',args)}catch(e){if(!/project .+ not found in workspace/.test(e.message))throw e;await this.ensureProject(projectId);return this.call('memory_query',args);}}
  async write(note) {return this.call('memory_write_page',{path:note.path,body:'# '+note.title.replace(/\n/g,' ')+'\n\n'+redact(note.body),tier:note.kind==='session'?'episodic':'semantic',tags:['omphalos',note.kind||'note'],...(note.kind==='preference'?{scope:'profile'}:scope(note.projectId))});}
  async remove(note) {return this.call('memory_delete_page',{path:note.path,...(note.kind==='preference'?{scope:'profile'}:scope(note.projectId))});}
  // The server is stopped synchronously first: before-quit does not wait for this promise.
  async close(){const server=this.server,client=this.client;this.client=null;this.server=null;this.endpoint=null;if(server)stop(server);await client?.close().catch(()=>{});}
}
// The server is a direct child (no shell), so kill() ends it at once, even during app quit.
function stop(child){if(child?.pid&&child.exitCode===null)try{child.kill();}catch{}}
// Unlike the old stdio server, an HTTP server outlives a crashed app and would keep the data-dir lock: end the one we left behind.
function reapOrphan(file){
  let pid;try{pid=Number(fs.readFileSync(file,'utf8'));}catch{return;}
  if(!Number.isInteger(pid)||pid<=0||pid===process.pid)return;
  try{process.kill(pid,0);}catch{return;}
  if(process.platform==='win32'){try{if(!/ai-memory/i.test(execFileSync('tasklist.exe',['/FI','PID eq '+pid,'/FO','CSV','/NH'],{windowsHide:true,encoding:'utf8'})))return;}catch{return;}}
  try{process.kill(pid);}catch{}
  for(let i=0;i<40;i++){try{process.kill(pid,0);}catch{return;}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);}
}
module.exports={Memory,redact,scope};
