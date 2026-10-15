const {spawn, execFile} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function locate(name) {
  const home=os.homedir(), local=process.env.LOCALAPPDATA||path.join(home,'AppData','Local');
  const names=name==='opencode'?['opencode.exe']: [name+'.exe'];
  const candidates=(process.env.PATH||'').split(path.delimiter).flatMap(dir=>names.map(n=>path.join(dir,n)));
  candidates.push(path.join(home,'.local','bin',name+'.exe'));
  if(name==='opencode') for(const dir of [path.dirname(process.env.NODE_EXE||'C:\\Program Files\\nodejs\\node.exe'),process.env.APPDATA&&path.join(process.env.APPDATA,'npm')].filter(Boolean)) candidates.push(path.join(dir,'node_modules','opencode-ai','bin','opencode.exe'));
  if(name==='codex') { const base=path.join(local,'OpenAI','Codex','bin'); try { for(const d of fs.readdirSync(base).reverse()) candidates.push(path.join(base,d,'codex.exe')); } catch{} }
  return candidates.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile())||null;
}
function run(exe,args,options={}) {return new Promise((resolve,reject)=>{ if(!exe) return reject(new Error('Programa não encontrado')); const child=spawn(exe,args,{windowsHide:true,shell:false,...options}); child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');let stdout='',stderr=''; const timer=setTimeout(()=>{kill(child);reject(new Error('O programa demorou para responder'));},options.timeout||20000); child.stdout.on('data',b=>stdout=(stdout+b).slice(-1000000)); child.stderr.on('data',b=>stderr=(stderr+b).slice(-10000)); child.on('error',e=>{clearTimeout(timer);reject(e)}); child.on('close',code=>{clearTimeout(timer); code===0?resolve(stdout):reject(new Error(stderr||stdout||'Erro '+code))}); if(child.stdin){child.stdin.on('error',()=>{});child.stdin.end(options.input||'');}});}
function kill(child) {if(!child?.pid||child.exitCode!==null)return; if(process.platform==='win32')execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});else child.kill('SIGTERM');}
function command(chat,exe) {
  const model=chat.model?['--model',chat.model]:[];
  if(chat.provider==='codex') return {exe,args:['exec',...(chat.sessionId?['resume',chat.sessionId]:[]),'--json','--skip-git-repo-check','-c','sandbox_mode="'+(chat.mode==='edit'?'workspace-write':'read-only')+'"','-c','approval_policy="never"',...model,'-'],stdin:true};
  if(chat.provider==='claude')return {exe,args:['--print','--output-format','stream-json','--verbose','--include-partial-messages','--permission-mode',chat.mode==='edit'?'acceptEdits':'plan','--permission-prompts','none',...model,...(chat.sessionId?['--resume',chat.sessionId]:[])],stdin:true};
  return {exe,args:['run','--format','json',...(chat.model?['--model',chat.model]:[]),'--agent',chat.mode==='read'?'plan':(chat.agent||'build'),...(chat.sessionId?['--session',chat.sessionId]:[])],stdin:true};
}
function parser(provider,emit) {
  let text='',seen=new Set();
  const append=t=>{if(!t)return; text+=t;emit({type:'text',text});};
  const activity=(label,detail)=>emit({type:'activity',label,detail:String(detail||'').slice(0,3000)});
  return {get text(){return text}, accept(event){
    if(provider==='codex') {
      if(event.type==='thread.started')emit({type:'session',sessionId:event.thread_id});
      const item=event.item;
      if(item?.type==='agent_message' && ['item.completed'].includes(event.type)) append((text?'\n\n':'')+item.text);
      if(item?.type==='command_execution')activity(event.type==='item.completed'?'Comando concluído':'Executando comando',item.command);
      if(item?.type==='file_change')activity('Arquivos atualizados',(item.changes||[]).map(x=>x.path).join(', '));
      if(item?.type==='mcp_tool_call')activity('Consultando ferramenta',item.tool);
      if(event.type==='error'||event.type==='turn.failed')emit({type:'provider-error',message:event.message||event.error?.message||'O Codex não concluiu a resposta'});
    } else if(provider==='claude') {
      if(event.session_id)emit({type:'session',sessionId:event.session_id});
      if(event.type==='stream_event'&&event.event?.type==='content_block_delta'&&event.event.delta?.type==='text_delta')append(event.event.delta.text);
      if(event.type==='assistant')for(const block of event.message?.content||[]){if(block.type==='text'&&!text)append(block.text);if(block.type==='tool_use')activity('Usando '+block.name,block.input?.command||block.input?.file_path||'');}
      if(event.type==='result'){if(!text&&event.result)append(event.result);if(event.is_error)emit({type:'provider-error',message:(event.errors||[]).join('\n')||event.result||'Falha no Claude'});}
    } else {
      const sessionId=event.sessionID||event.part?.sessionID;if(sessionId)emit({type:'session',sessionId});
      if(event.type==='text') { const key=event.part?.id;if(!key||!seen.has(key)){if(key)seen.add(key);append((text?'\n\n':'')+(event.part?.text||event.text||''));} }
      if(event.type==='tool_use')activity('Usando '+event.part?.tool,event.part?.state?.title||'');
      if(event.type==='error')emit({type:'provider-error',message:event.error?.data?.message||event.error?.message||'Falha no OpenCode'});
    }
  }};
}
module.exports={locate,run,kill,command,parser};
