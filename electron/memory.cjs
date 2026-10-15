const fs = require('node:fs');
const path = require('node:path');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');
const redact = text => String(text).replace(/\b(?:sk-|dk-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/g,'[chave removida]').replace(/((?:api[_-]?key|authorization|password|senha|token)\s*[:=]\s*)[^\s,;]+/gi,'$1[removido]');
const scope = projectId => ({workspace:'omphalos', project:projectId||'inbox'});
class Memory {
  constructor(exe,dir) {this.exe=exe;this.dir=dir;this.client=null;this.pending=null;this.error=null;this.log='';}
  async connect() {
    if(this.client)return this.client;
    if(this.pending)return this.pending;
    this.pending=(async()=>{
      fs.mkdirSync(this.dir,{recursive:true});
      const config=path.join(this.dir,'config.toml');
      // FTS works offline, without downloading an embedding model or calling a cloud provider.
      if(!fs.existsSync(config))fs.writeFileSync(config,'embedding_provider = "none"\nlog_level = "warn"\n');
      const transport=new StdioClientTransport({command:this.exe,args:['--data-dir',this.dir,'serve','--transport','stdio','--workspace','omphalos','--project','inbox'],env:{...process.env,AI_MEMORY_EMBEDDING_PROVIDER:'none'},stderr:'pipe'});
      this.transport=transport;
      transport.stderr?.on('data',b=>this.log=(this.log+b).slice(-6000));
      const client=new Client({name:'omphalos',version:'0.1.0'});
      client.onclose=()=>{this.client=null};
      try {await client.connect(transport);this.client=client;this.error=null;return client;}catch(e){this.error=e.message;await transport.close().catch(()=>{});throw e;}
    })().finally(()=>{this.pending=null});
    return this.pending;
  }
  async call(name,args) {const client=await this.connect(); const result=await client.callTool({name,arguments:args},undefined,{timeout:20000}); const text=(result.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n'); if(result.isError)throw new Error(text||'Falha no AI Memory'); return text;}
  async query(query,projectId) {const terms=String(query).match(/[\p{L}\p{N}_-]{3,}/gu)?.slice(0,12)||[];if(!terms.length)return '';const expression=terms.map(t=>'"'+t.replace(/"/g,'')+'"').join(' OR ');const args={query:expression,...scope(projectId),limit:6};try{return await this.call('memory_query',args)}catch(e){if(!/project .+ not found in workspace/.test(e.message))throw e;await this.call('memory_write_page',{path:'omphalos/space.md',body:'# Espaço de trabalho\n\nEspaço de memória criado pelo Omphalos.',...scope(projectId)});return this.call('memory_query',args);}}
  async write(note) {return this.call('memory_write_page',{path:note.path,body:'# '+note.title.replace(/\n/g,' ')+'\n\n'+redact(note.body),tier:note.kind==='session'?'episodic':'semantic',tags:['omphalos',note.kind||'note'],...(note.kind==='preference'?{scope:'profile'}:scope(note.projectId))});}
  async remove(note) {return this.call('memory_delete_page',{path:note.path,...(note.kind==='preference'?{scope:'profile'}:scope(note.projectId))});}
  async close(){await this.client?.close();this.client=null;}
}
module.exports={Memory,redact,scope};
