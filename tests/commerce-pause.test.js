'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'br-launch-pause-'));
Object.assign(process.env,{NODE_ENV:'test',DATA_DIR:temp,BR_TEST_LEGACY_IMPORT:'false',MAIL_DISABLED:'true',COMMERCE_PAUSED:'true',ADMIN_USERNAME:'fixture',ADMIN_PASSWORD:'fixture-only',SESSION_SECRET:'fixture-only',SQUARE_ENVIRONMENT:'sandbox',PUBLIC_SITE_URL:'https://brackishroots.com'});
delete process.env.SQUARE_ACCESS_TOKEN;delete process.env.SMTP_PASS;
global.__BR_CATALOG_TEST__=[];global.__BR_SQUARE_TEST__={};
const system=require('../server');let server,base;
before(async()=>{server=system.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{system.business.stop();await new Promise(r=>server.close(r));system.db.close();fs.rmSync(temp,{recursive:true,force:true});});
test('launch pause blocks customer writes before Square or request creation',async()=>{
 const before=system.db.prepare('SELECT COUNT(*) n FROM projects').get().n;
 for(const route of ['/checkout','/custom-requests','/projects/current/pay']){const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,503);assert.match((await response.json()).error,/temporarily unavailable/);}
 assert.equal(system.db.prepare('SELECT COUNT(*) n FROM projects').get().n,before);
});
