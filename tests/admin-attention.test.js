'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{summarize}=require('../lib/admin-attention');
test('attention badges count actionable work and deduplicate stock variations and shared materials',()=>{
 const raw=new DatabaseSync(':memory:'),db={prepare:raw.prepare.bind(raw)};
 try{
  raw.exec(`CREATE TABLE orders(id INTEGER,status TEXT,payment_status TEXT);CREATE TABLE projects(status TEXT);CREATE TABLE paid_proofs(order_id INTEGER,status TEXT);CREATE TABLE production_sourcing(status TEXT);CREATE TABLE mail_queue(status TEXT,attempts INTEGER);`);
  const order=raw.prepare('INSERT INTO orders VALUES(?,?,?)');for(const [id,status,payment]of [[1,'PAID','PAID'],[2,'SHIPPED','PAID'],[3,'IN_PRODUCTION','PARTIALLY_REFUNDED'],[4,'REFUNDED','REFUNDED'],[5,'CANCELLED','PAID'],[6,'AWAITING_PROOF','PAID']])order.run(id,status,payment);
  for(const state of ['REQUESTED','CHANGES_REQUESTED','DRAFT','REVIEW','PAID','APPROVED'])raw.prepare('INSERT INTO projects VALUES(?)').run(state);
  for(const [id,status]of [[1,'DRAFT'],[6,'CHANGES_REQUESTED'],[2,'DRAFT'],[4,'DRAFT'],[1,'REVIEW'],[1,'APPROVED']])raw.prepare('INSERT INTO paid_proofs VALUES(?,?)').run(id,status);
  for(const state of ['SUBMITTING','APPLIED'])raw.prepare('INSERT INTO production_sourcing VALUES(?)').run(state);
  for(const [status,attempts]of [['SENT',0],['RETIRED',8],['PENDING',0],['PENDING',1],['PENDING',8],['FAILED',8]])raw.prepare('INSERT INTO mail_queue VALUES(?,?)').run(status,attempts);
  const products=[{variations:[{id:'a',inventoryTracked:true,quantity:0},{id:'a',inventoryTracked:true,quantity:0},{id:'b',inventoryTracked:true,quantity:-1},{id:'c',inventoryTracked:false,quantity:0},{id:'d',inventoryTracked:true,quantity:4},{id:'unknown',inventoryTracked:true,quantity:null}]},{fulfillmentMode:'made-to-order',variations:[{id:'e',inventoryTracked:true,quantity:0}]}];
  const patches=[{id:'patch',variants:[{materialId:'shared',stockStatus:'out-of-stock'}]},{id:'other',variants:[{materialId:'shared',stockStatus:'out-of-stock'}]},{id:'inactive',active:false,variants:[{materialId:'unused',stockStatus:'out-of-stock'}]}];
  const counts=summarize(db,products,patches);assert.deepEqual(Object.fromEntries(Object.entries(counts).map(([id,data])=>[id,data.count])),{orders:3,projects:3,inventory:2,patches:1,'paid-proofs':2,sourcing:1,mail:3});
  raw.exec("UPDATE orders SET status='SHIPPED';UPDATE projects SET status='PAID';UPDATE paid_proofs SET status='APPROVED';UPDATE production_sourcing SET status='APPLIED';UPDATE mail_queue SET status='SENT';");assert(Object.values(summarize(db,[],[])).every(section=>section.count===0));
 }finally{raw.close();}
});
