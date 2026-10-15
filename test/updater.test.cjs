const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {newer,readLatestYml,verify,installKind}=require('../electron/updater.cjs');
test('only a strictly higher version is an update',()=>{
  assert.equal(newer('0.1.4','0.1.3'),true);assert.equal(newer('v0.2.0','0.1.9'),true);assert.equal(newer('0.1.10','0.1.9'),true);
  assert.equal(newer('0.1.3','0.1.3'),false);assert.equal(newer('0.1.2','0.1.3'),false);assert.equal(newer('','0.1.3'),false);
});
const yml=(file,sha,version='0.1.4')=>'version: '+version+'\nfiles:\n  - url: '+file+'\n    sha512: '+sha+'\n    size: 3\npath: '+file+'\nsha512: '+sha+"\nreleaseDate: '2026-10-15T14:08:54.011Z'\n";
test('latest.yml gives the installer path, hash and version',()=>{assert.deepEqual(readLatestYml(yml('Omphalos-Setup-0.1.4.exe','abc==')),{version:'0.1.4',path:'Omphalos-Setup-0.1.4.exe',sha512:'abc=='});});
test('the downloaded installer must match latest.yml',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omphalos-upd-'));const file='Omphalos-Setup-0.1.4.exe';fs.writeFileSync(path.join(dir,file),'exe');
  const sha=crypto.createHash('sha512').update('exe').digest('base64');
  fs.writeFileSync(path.join(dir,'latest.yml'),yml(file,sha));assert.equal(await verify(dir,'0.1.4'),path.join(dir,file));
  await assert.rejects(verify(dir,'0.1.5'),/esperado 0\.1\.5/);
  fs.writeFileSync(path.join(dir,'latest.yml'),yml(file,crypto.createHash('sha512').update('outro').digest('base64')));await assert.rejects(verify(dir),/não confere/);
  fs.writeFileSync(path.join(dir,'latest.yml'),yml('../fora.exe',sha));await assert.rejects(verify(dir),/inválido/);
});
test('dev runs never self-update',()=>{assert.equal(installKind({isPackaged:false}),'dev');});
test('every Electron main-process file parses',()=>{const {spawnSync}=require('node:child_process');const dir=path.join(__dirname,'../electron');for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.cjs'))){const r=spawnSync(process.execPath,['--check',path.join(dir,f)],{encoding:'utf8'});assert.equal(r.status,0,f+': '+r.stderr);}});
