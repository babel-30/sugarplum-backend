'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),sharp=require('sharp'),{DatabaseSync}=require('node:sqlite');
const image=require('../lib/project-packing-image');
test('private packing photos use exact project associations and immutable shop snapshots',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'br-private-packing-')),db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE project_files(id TEXT,project_id TEXT,kind TEXT,filename TEXT); CREATE TABLE private_shops(id TEXT,project_id TEXT,items_json TEXT);');
  const context={dataDir:dir,prepare:db.prepare.bind(db)};await fs.mkdir(path.join(dir,'private-uploads'));
  for(const [id,color]of [['hat','#ff0000'],['shirt','#00ff00']]){await sharp({create:{width:30,height:30,channels:3,background:color}}).png().toFile(path.join(dir,'private-uploads',id+'.png'));db.prepare('INSERT INTO project_files VALUES(?,?,?,?)').run(id,'project','mockup',id+'.png');}
  db.prepare('INSERT INTO private_shops VALUES(?,?,?)').run('shop','project',JSON.stringify([{id:'hat-line',mockupId:'hat'},{id:'shirt-line',mockupId:'shirt'}]));
  const pixel=async buffer=>[...(await sharp(buffer).removeAlpha().raw().toBuffer()).subarray(0,3)];
  assert.deepEqual(await pixel(await image(context,{mockupId:'hat'},{channel:'quote',projectId:'project'})),[255,0,0]);
  assert.deepEqual(await pixel(await image(context,{id:'shirt-line',shopId:'shop',mockupId:'hat'},{channel:'private-shop',projectId:'project'})),[0,255,0],'snapshot association wins over a supplied field');
  assert.equal(await image(context,{mockupId:'hat'},{channel:'quote',projectId:'another-project'}),null);
  assert.equal(await image(context,{id:'absent',shopId:'shop'},{channel:'private-shop',projectId:'project'}),null);
  assert.equal(await image(context,{id:'shirt-line',shopId:'shop'},{channel:'private-shop',projectId:'another-project'}),null);
  assert.equal(await image(context,{mockupId:'hat'},{channel:'website',projectId:'project'}),null);
  db.prepare('INSERT INTO project_files VALUES(?,?,?,?)').run('art','project','artwork','hat.png');assert.equal(await image(context,{mockupId:'art'},{channel:'quote',projectId:'project'}),null);
  await fs.copyFile(path.join(dir,'private-uploads','hat.png'),path.join(dir,'outside.png'));db.prepare('INSERT INTO project_files VALUES(?,?,?,?)').run('escape','project','mockup','../outside.png');assert.equal(await image(context,{mockupId:'escape'},{channel:'quote',projectId:'project'}),null);
 }finally{db.close();await fs.rm(dir,{recursive:true,force:true});}
});
