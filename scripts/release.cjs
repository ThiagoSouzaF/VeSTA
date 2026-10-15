// Builds the NSIS installer and publishes it as a GitHub Release, which installed copies pick up on their next start.
// Usage: npm run release [-- --skip-build]
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const {REPO,locateGh,readLatestYml}=require('../electron/updater.cjs');
const root=path.join(__dirname,'..');
const sh=(cmd,args,opts={})=>execFileSync(cmd,args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],...opts}).trim();
const fail=msg=>{console.error('release: '+msg);process.exit(1);};
const version=require('../package.json').version,tag='v'+version;
const gh=locateGh();if(!gh)fail('GitHub CLI (gh) não encontrado.');
if(sh('git',['status','--porcelain']))fail('há mudanças não commitadas.');
sh('git',['fetch','--quiet','--tags','origin']);
const head=sh('git',['rev-parse','HEAD']);let upstream='';try{upstream=sh('git',['rev-parse','@{u}']);}catch{}
// The release tag points at the pushed commit, so the published build always matches the repo.
if(head!==upstream)fail('o commit atual não está no GitHub. Faça push antes de publicar.');
let exists=true;try{sh(gh,['release','view',tag,'-R',REPO]);}catch{exists=false;}
if(exists)fail(tag+' já foi publicada. Aumente a versão no package.json.');
if(!process.argv.includes('--skip-build'))execFileSync(process.platform==='win32'?'npm.cmd':'npm',['run','installer'],{cwd:root,stdio:'inherit',shell:process.platform==='win32'});
const yml=path.join(root,'release','latest.yml');if(!fs.existsSync(yml))fail('release/latest.yml não foi gerado.');
const meta=readLatestYml(fs.readFileSync(yml,'utf8'));
if(meta.version!==version)fail('latest.yml é da versão '+meta.version+', mas o package.json está em '+version+'.');
const setup=path.join(root,'release',meta.path);if(!fs.existsSync(setup))fail(meta.path+' não encontrado.');
let previous='';try{previous=sh('git',['describe','--tags','--abbrev=0','HEAD^']);}catch{}
const notes=sh('git',['log','--pretty=- %s',...(previous?[previous+'..HEAD']:['-1'])])||'- '+tag;
console.log(sh(gh,['release','create',tag,setup,yml,'-R',REPO,'--target',head,'--title','Omphalos '+version,'--notes',notes]));
console.log('Publicado '+tag+'. As cópias instaladas vão oferecer a atualização na próxima abertura.');
