'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(response,{pending=true}={}){
 const html=fs.readFileSync(path.join(__dirname,'../public/storefront/thank-you.html'),'utf8'),source=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
 const data=new Map(pending?[['spc_pending_checkout_id','pending-fixture']]:[]),cart=new Map([['spc_cart_v1','KEEP CART']]),timers=[],status={textContent:''},events={};let calls=0;
 const context={document:{getElementById:id=>id==='statusBox'?status:{textContent:''},addEventListener:(name,fn)=>events[name]=fn},window:{addEventListener(){},dispatchEvent(){}},location:{search:''},URLSearchParams,sessionStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},localStorage:{removeItem:k=>cart.delete(k)},setTimeout:fn=>timers.push(fn),API_BASE:'https://example.test',fetch:async()=>{calls++;return response();},console:{log(){},error(){}},CustomEvent:class{}};
 vm.createContext(context);vm.runInContext(source,context);return {context,timers,status,cart,data,calls:()=>calls};
}
test('unconfirmed checkout retries stop and never clear the cart or claim payment',async()=>{
 const f=fixture(()=>({ok:false,status:409,json:async()=>({})}));await f.context.confirmCheckout();while(f.timers.length)await f.timers.shift()();assert.equal(f.calls(),8);assert.equal(f.timers.length,0);assert.equal(f.cart.get('spc_cart_v1'),'KEEP CART');assert(!f.data.has('spc_checkout_confirmed'));assert.match(f.status.textContent,/do not pay again/);
 const missing=fixture(()=>{throw Error('Must not call checkout');},{pending:false});await missing.context.confirmCheckout();assert.equal(missing.calls(),0);assert.equal(missing.cart.get('spc_cart_v1'),'KEEP CART');assert.match(missing.status.textContent,/could not find a checkout/);
});
test('overlapping confirmation events make one request and only verified success clears the cart',async()=>{
 let release;const f=fixture(()=>new Promise(r=>release=r));const first=f.context.confirmCheckout();await f.context.confirmCheckout();assert.equal(f.calls(),1);release({ok:true,json:async()=>({ok:true})});await first;assert.equal(f.cart.size,0);assert.equal(f.data.get('spc_checkout_confirmed'),'1');assert.match(f.status.textContent,/Payment confirmed/);
});
