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
// The AI Memory MCP server is registered per launch (flags/env), never in ~/.claude, ~/.codex or the global OpenCode config.
const MEMORY_SERVER='omphalos-memory',MEMORY_TOKEN_ENV='OMPHALOS_MEMORY_TOKEN';
function memoryTools(provider,endpoint){
  if(!endpoint)return {args:[],env:{}};
  const env={[MEMORY_TOKEN_ENV]:endpoint.token};
  // The token travels by environment; each CLI expands it into the Authorization header itself.
  if(provider==='claude')return {env,args:['--mcp-config',JSON.stringify({mcpServers:{[MEMORY_SERVER]:{type:'http',url:endpoint.mcp,headers:{Authorization:'Bearer ${'+MEMORY_TOKEN_ENV+'}'}}}}),'--allowedTools','mcp__'+MEMORY_SERVER]};
  if(provider==='codex'){const key='mcp_servers.'+MEMORY_SERVER+'.';return {env,args:['-c',key+'url="'+endpoint.mcp+'"','-c',key+'bearer_token_env_var="'+MEMORY_TOKEN_ENV+'"','-c',key+'default_tools_approval_mode="approve"']};}
  return {args:[],env:{...env,OPENCODE_CONFIG_CONTENT:JSON.stringify({mcp:{[MEMORY_SERVER]:{type:'remote',url:endpoint.mcp,enabled:true,oauth:false,headers:{Authorization:'Bearer {env:'+MEMORY_TOKEN_ENV+'}'}}}})}};
}
// Tells the agent which scope is its own: tool calls without workspace/project would land in the server's default (inbox).
function memoryHint(projectId){
  const project=projectId||'inbox';
  return 'Você tem acesso à memória compartilhada do Omphalos pelas ferramentas MCP do servidor "'+MEMORY_SERVER+'" (AI Memory). Nelas, sempre passe workspace "omphalos" e project "'+project+'". Use memory_query para buscar decisões e contexto de conversas anteriores quando forem relevantes, e memory_write_page para registrar decisões, fatos e lições duráveis deste projeto (caminhos como "agentes/<assunto>.md"). Não grave segredos nem trechos longos de código.';
}
function command(chat,exe,endpoint) {
  const model=chat.model?['--model',chat.model]:[];
  const mem=memoryTools(chat.provider,endpoint);
  if(chat.provider==='codex') return {exe,args:['exec',...(chat.sessionId?['resume',chat.sessionId]:[]),'--json','--skip-git-repo-check','-c','sandbox_mode="'+(chat.mode==='edit'?'danger-full-access':'read-only')+'"','-c','approval_policy="never"',...mem.args,...model,'-'],env:mem.env,stdin:true};
  if(chat.provider==='claude')return {exe,args:['--print','--output-format','stream-json','--verbose','--include-partial-messages','--permission-mode',chat.mode==='edit'?'bypassPermissions':'plan','--permission-prompts','none',...mem.args,...model,...(chat.sessionId?['--resume',chat.sessionId]:[])],env:mem.env,stdin:true};
  return {exe,args:['run','--format','json',...(chat.model?['--model',chat.model]:[]),'--agent',chat.mode==='read'?'plan':(chat.agent||'build'),...(chat.sessionId?['--session',chat.sessionId]:[])],env:mem.env,stdin:true};
}
const clip=(v,n)=>String(v==null?'':v).slice(0,n);
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
// Tool name -> visual kind of the activity card.
function toolKind(name){
  const n=String(name||'').toLowerCase();
  if(n.includes(MEMORY_SERVER)||n.includes('omphalos_memory'))return 'memory';
  if(n.startsWith('mcp__')||n.startsWith('mcp_'))return 'mcp';
  if(/^(bash|shell|powershell|command|exec)/.test(n))return 'command';
  if(/^(read|write|edit|multiedit|notebookedit|patch|apply_patch|file)/.test(n))return 'file';
  if(/^(grep|glob|list|ls|find|search|toolsearch)/.test(n))return 'search';
  if(/^(web|fetch|browser)/.test(n))return 'web';
  if(/^(todo|task_?create|task_?update)/.test(n))return 'todo';
  return 'tool';
}
// Memory tools read as "Memória · memory_query" instead of the raw MCP-qualified name.
const toolLabel=name=>{const n=String(name||'');if(toolKind(n)!=='memory')return 'Usando '+n;const i=n.lastIndexOf('memory_'),tool=i>=0?n.slice(i):n;return 'Memória · '+tool;};
const textOf=c=>typeof c==='string'?c:Array.isArray(c)?c.map(x=>typeof x==='string'?x:x?.text||'').filter(Boolean).join('\n'):c&&c.text?c.text:'';
// Strips the harness frame Claude Code wraps around a subagent report and its per-line indentation.
const unframe=s=>{const m=/The report follows:\s*\n/i.exec(s);if(!m)return s;return s.slice(m.index+m[0].length).split('\n').map(l=>l.replace(/^ {2}/,'')).join('\n');};
const summarize=v=>clip(unframe(textOf(v).replace(/^\s*\[Subagent hand-back\]\s*/i,'')).trim(),4000);
// Normalizes a rate-limit window: utilization 0..1, resetsAt in epoch milliseconds (accepts seconds, ms or ISO).
function normWindow(w){
  if(!w||typeof w!=='object')return null;
  const rawU=w.utilization??w.used_percentage??w.usedPercentage??w.usedPercent??w.percent;
  const rawR=w.resetsAt??w.resets_at??w.resetAt??w.reset_at??w.resetsAtMs;
  let u=rawU==null||rawU===''?null:Number(rawU);if(u!=null&&!Number.isFinite(u))u=null;
  if(u!=null){if(u>1)u/=100;u=Math.min(1,Math.max(0,u));}
  let r=null;if(rawR!=null&&rawR!==''){r=typeof rawR==='string'&&Number.isNaN(Number(rawR))?Date.parse(rawR):Number(rawR);if(!Number.isFinite(r))r=null;else if(r<1e11)r=Math.round(r*1000);}
  if(u==null&&r==null)return null;
  return {utilization:u,resetsAt:r};
}
function rateWindows(info){
  const out={fiveHour:null,sevenDay:null};if(!info||typeof info!=='object')return out;
  const put=(name,w)=>{const key=/five|5/i.test(name)?'fiveHour':/seven|week|7/i.test(name)?'sevenDay':null;if(!key)return;const n=normWindow(w);if(n)out[key]=n;};
  const wins=info.unifiedWindows||info.unified_windows||info.windows;
  if(wins&&typeof wins==='object')for(const [k,v] of Object.entries(wins))put(k,v);
  for(const k of ['five_hour','fiveHour','seven_day','sevenDay'])if(info[k])put(k,info[k]);
  // The top-level window only fills a gap: it often carries resetsAt without utilization.
  const type=info.rateLimitType||info.rate_limit_type;if(type){const before={...out};put(String(type),info);for(const k of ['fiveHour','sevenDay'])if(before[k])out[k]=before[k];}
  return out;
}
function parser(provider,emit) {
  let text='',seen=new Set(),subs=new Set(),gap=false;
  const append=t=>{if(!t)return; text+=t;emit({type:'text',text:t});};
  const activity=(label,detail,extra={})=>emit({type:'activity',label,detail:clip(detail,3000),kind:'tool',...extra});
  const subagent=o=>emit({type:'subagent',provider,...o});
  const cost=o=>emit({type:'cost',provider,inputTokens:num(o.inputTokens),outputTokens:num(o.outputTokens),cacheTokens:num(o.cacheTokens),costUsd:num(o.costUsd)});
  const startSub=(id,input,status,result)=>{
    subs.add(id);
    subagent({toolUseId:id,subagentType:clip(input?.subagent_type||input?.subagentType||'agent',80),label:clip(input?.description||String(input?.prompt||'').split('\n')[0],200),prompt:clip(input?.prompt,6000),status,...(result!==undefined?{result}:{})});
  };
  return {get text(){return text}, accept(event){
    if(provider==='codex') {
      if(event.type==='thread.started')emit({type:'session',sessionId:event.thread_id});
      const item=event.item;const done=event.type==='item.completed';
      if(item?.type==='agent_message' && ['item.completed'].includes(event.type)) append((text?'\n\n':'')+item.text);
      if(item?.type==='command_execution')activity(done?'Comando concluído':'Executando comando',item.command,{kind:'command',id:item.id,status:done?'done':'running'});
      if(item?.type==='file_change')activity('Arquivos atualizados',(item.changes||[]).map(x=>x.path).join(', '),{kind:'file',id:item.id,status:'done'});
      if(item?.type==='mcp_tool_call')activity(item.server===MEMORY_SERVER?toolLabel(MEMORY_SERVER+'_'+item.tool):'Consultando ferramenta',item.server===MEMORY_SERVER?item.arguments?.query||item.arguments?.path||'':[item.server,item.tool].filter(Boolean).join(' · '),{kind:item.server===MEMORY_SERVER?'memory':'mcp',id:item.id,status:done?'done':'running'});
      if(item?.type==='web_search')activity('Pesquisando na web',item.query,{kind:'web',id:item.id,status:done?'done':'running'});
      if(event.type==='turn.completed'&&event.usage)cost({inputTokens:event.usage.input_tokens,outputTokens:num(event.usage.output_tokens)+num(event.usage.reasoning_output_tokens),cacheTokens:event.usage.cached_input_tokens});
      if(event.type==='error'||event.type==='turn.failed')emit({type:'provider-error',message:event.message||event.error?.message||'O Codex não concluiu a resposta'});
    } else if(provider==='claude') {
      if(event.session_id)emit({type:'session',sessionId:event.session_id});
      // Events from inside a subagent carry parent_tool_use_id: they become live steps of its card, never main text.
      const parent=event.parent_tool_use_id;
      if(parent){
        if(!subs.has(parent))return;
        const step=s=>subagent({toolUseId:parent,step:s});
        if(event.type==='assistant')for(const block of event.message?.content||[]){
          if(block.type==='tool_use'){const i=block.input||{};step({id:block.id,kind:toolKind(block.name),label:toolLabel(block.name),detail:clip(i.command||i.file_path||i.path||i.pattern||i.url||i.query||i.description||'',300),status:'running'});}
          if(block.type==='text'&&block.text?.trim())step({id:event.message?.id+':text',kind:'text',label:'Escrevendo',detail:clip(block.text.trim(),300),status:'done'});
        }
        if(event.type==='user'&&Array.isArray(event.message?.content))for(const block of event.message.content)if(block?.type==='tool_result')step({id:block.tool_use_id,status:block.is_error?'error':'done'});
        return;
      }
      if(event.type==='stream_event'&&event.event?.type==='content_block_delta'&&event.event.delta?.type==='text_delta'){if(gap&&!/\s$/.test(text))append('\n\n');gap=false;append(event.event.delta.text);}
      if(event.type==='assistant')for(const block of event.message?.content||[]){
        if(block.type==='text'&&!text)append(block.text);
        if(block.type==='tool_use'){
          if(block.name==='Agent'||block.name==='Task'){if(!subs.has(block.id))startSub(block.id,block.input,'running');}
          else{const i=block.input||{};activity(toolLabel(block.name),i.command||i.file_path||i.path||i.pattern||i.url||i.query||i.description||'',{kind:toolKind(block.name),id:block.id,status:'running'});}
        }
      }
      if(event.type==='user'&&Array.isArray(event.message?.content))for(const block of event.message.content){
        if(block?.type==='tool_result'&&subs.has(block.tool_use_id)){
          // A backgrounded subagent only acknowledges its launch here; task_notification closes it later.
          const body=textOf(block.content);
          if(!block.is_error&&/^\s*Async agent launched/i.test(body))subagent({toolUseId:block.tool_use_id,background:true});
          else subagent({toolUseId:block.tool_use_id,status:block.is_error?'error':'done',result:summarize(block.content)});
        }
      }
      if(event.type==='system'&&subs.has(event.tool_use_id)){
        const stats=event.usage?{toolUses:num(event.usage.tool_uses),tokens:num(event.usage.total_tokens),durationMs:num(event.usage.duration_ms)}:undefined;
        if(event.subtype==='task_progress')subagent({toolUseId:event.tool_use_id,stats});
        if(event.subtype==='task_notification')subagent({toolUseId:event.tool_use_id,status:event.status==='completed'?'done':'error',result:clip(event.summary||'',4000)||undefined,stats});
      }
      // A second turn (after a background task) starts a new message: keep paragraphs apart.
      if(event.type==='stream_event'&&event.event?.type==='message_start'&&text)gap=true;
      if(event.type==='rate_limit_event'){const w=rateWindows(event.rate_limit_info);if(w.fiveHour||w.sevenDay)emit({type:'usage',provider:'claude',...w});}
      if(event.type==='result'){
        if(!text&&event.result)append(event.result);
        const u=event.usage;if(u||event.total_cost_usd!=null)cost({inputTokens:u?.input_tokens,outputTokens:u?.output_tokens,cacheTokens:num(u?.cache_read_input_tokens)+num(u?.cache_creation_input_tokens),costUsd:event.total_cost_usd});
        if(event.is_error)emit({type:'provider-error',message:(event.errors||[]).join('\n')||event.result||'Falha no Claude'});
      }
    } else {
      const sessionId=event.sessionID||event.part?.sessionID;if(sessionId)emit({type:'session',sessionId});
      if(event.type==='text') { const key=event.part?.id;if(!key||!seen.has(key)){if(key)seen.add(key);append((text?'\n\n':'')+(event.part?.text||event.text||''));} }
      if(event.type==='tool_use'){
        const part=event.part||{},st=part.state||{},id=part.callID||part.id||'';
        if(part.tool==='task'){
          const status=st.status==='error'?'error':st.status==='completed'?'done':'running';
          startSub(id,st.input||{},status,status==='running'?undefined:summarize(st.output||st.error||st.title));
        } else activity(toolLabel(part.tool),st.title||st.input?.query||st.input?.path||st.input?.command||st.input?.filePath||st.input?.pattern||'',{kind:toolKind(part.tool),id:id||undefined,status:st.status==='completed'?'done':st.status==='error'?'error':'running'});
      }
      if(event.type==='step_finish'&&event.part){const t=event.part.tokens||{};cost({inputTokens:t.input,outputTokens:num(t.output)+num(t.reasoning),cacheTokens:num(t.cache?.read)+num(t.cache?.write),costUsd:event.part.cost});}
      if(event.type==='error')emit({type:'provider-error',message:event.error?.data?.message||event.error?.message||'Falha no OpenCode'});
    }
  }};
}
// Merges a subagent event into a message's list (upsert by toolUseId), stamping start/end times.
function upsertSubagent(list,ev,now=Date.now()){
  const {type,step,...fields}=ev;for(const k of Object.keys(fields))if(fields[k]===undefined)delete fields[k];
  let rec=list.find(s=>s.toolUseId===fields.toolUseId);
  if(!rec){rec={startedAt:now,status:'running'};list.push(rec);}
  Object.assign(rec,fields);
  if(step){rec.steps=rec.steps||[];const i=rec.steps.findIndex(x=>x.id===step.id);if(i>=0)rec.steps[i]={...rec.steps[i],...step};else rec.steps.push({at:now,...step});rec.steps=rec.steps.slice(-40);}
  if(rec.status!=='running'&&!rec.endedAt)rec.endedAt=now;
  return rec;
}
// Same for generic activities carrying an id (codex emits started/completed for the same item).
function upsertActivity(list,ev){
  const {type,...a}=ev;if(a.id){const i=list.findIndex(x=>x.id===a.id);if(i>=0){list[i]={...list[i],...a};return list[i];}}
  list.push(a);return a;
}
module.exports={locate,run,kill,command,memoryTools,memoryHint,MEMORY_SERVER,parser,upsertSubagent,upsertActivity,rateWindows,normWindow};
