'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const queue=require('../lib/photo-work');
test('photo work serializes image loads and reuses queued duplicate results',async()=>{
 const run=queue();let active=0,peak=0,calls=0;
 const work=async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;return Buffer.from('image');};
 const result=await Promise.all([run('a',work),run('b',work),run('a',work)]);
 assert.equal(peak,1);assert.equal(calls,2);assert.equal(result[0],result[2]);
});
test('photo cache evicts by byte budget and failed work does not block queue',async()=>{
 const run=queue({maxBytes:4});let calls=0;
 const work=async()=>{calls++;return Buffer.from('1234');};
 await run('a',work);await run('b',work);await run('a',work);assert.equal(calls,3);
 await assert.rejects(run('error',async()=>{throw Error('decode');}));
 assert.equal((await run('c',work)).toString(),'1234');
});
