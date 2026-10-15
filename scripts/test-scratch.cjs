const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
module.exports=name=>fs.mkdtempSync(path.join(os.tmpdir(),'omphalos-'+name+'-'));
