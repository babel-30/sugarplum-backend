'use strict';

// Queue before downloading or decoding: simultaneous large mockups can exceed
// the small production instance's memory even when each image is valid.
module.exports=function({maxBytes=16*1024*1024,ttl=300000}={}){
 let tail=Promise.resolve(),size=0;
 const cache=new Map();
 return function(key,work){
  const task=tail.then(async()=>{
   const hit=key&&cache.get(key);
   if(hit&&hit.expires>Date.now()){
    cache.delete(key);cache.set(key,hit);return hit.bytes;
   }
   if(hit){cache.delete(key);size-=hit.bytes.length;}
   const bytes=await work();
   if(key&&Buffer.isBuffer(bytes)&&bytes.length<=maxBytes){
    while(size+bytes.length>maxBytes&&cache.size){
     const oldest=cache.keys().next().value;
     size-=cache.get(oldest).bytes.length;cache.delete(oldest);
    }
    cache.set(key,{bytes,expires:Date.now()+ttl});size+=bytes.length;
   }
   return bytes;
  });
  tail=task.catch(()=>{});
  return task;
 };
};
