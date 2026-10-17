const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../public/storefront/script.js'),'utf8');
const begin=source.indexOf('async function handleCheckoutClick() {'),end=source.indexOf('// ========== IMAGE MODAL (SHARED) ==========',begin);
const sessions=new Map([['spc_checkout_confirmed','1'],['spc_cart_cleared_on_thankyou','1']]);let payload,calls=0,alerts=[];
const ctx={cart:[{id:'p1',name:'Coastal Tee',type:'T-Shirts',color:'Green',size:'L',printSide:'Front',qty:2,price:24.99,squareVariationId:'v1',catalogObjectId:'v1',sku:'tee-green-l'}],API_BASE:'https://example.test',computeShipping:()=>5,console:{log(){},warn(){},error(){}},showSpcAlert:msg=>alerts.push(msg),document:{getElementById:()=>null},CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts?.detail;}},sessionStorage:{getItem:k=>sessions.get(k)||null,setItem:(k,v)=>sessions.set(k,v),removeItem:k=>sessions.delete(k)},window:{location:{href:''},dispatchEvent(){}},fetch:async(url,options)=>{calls++;assert.equal(url,'https://example.test/checkout');payload=JSON.parse(options.body);return {ok:true,json:async()=>({checkoutUrl:'https://square.example/checkout',pendingId:'pending-2'})}}};
for(const [name,value] of Object.entries({Name:'Test Customer',Email:'test@example.test',Phone:'',Address1:'1 Test Street',Address2:'',City:'Biloxi',State:'MS',Zip:'39530'}))ctx['checkout'+name+'Input']={value};
vm.createContext(ctx);vm.runInContext(source.slice(begin,end),ctx);
(async()=>{
 await ctx.handleCheckoutClick();assert.equal(payload.cart[0].price,2499);assert.equal(payload.cart[0].quantity,2);assert.equal(payload.cart[0].catalogObjectId,'v1');assert.equal(payload.shippingTotalCents,500);assert.equal(payload.customer.state,'MS');assert.equal(sessions.get('spc_pending_checkout_id'),'pending-2');assert(!sessions.has('spc_checkout_confirmed'));assert(!sessions.has('spc_cart_cleared_on_thankyou'));assert.equal(ctx.window.location.href,'https://square.example/checkout');
 ctx.checkoutNameInput.value='';await ctx.handleCheckoutClick();assert.equal(calls,1);assert(alerts.at(-1).includes('name'));
 const nameFields={'checkout-first-name':{value:' Mary Jane '},'checkout-last-name':{value:' de la Cruz '}};
 ctx.document.getElementById=id=>nameFields[id]||null;
 await ctx.handleCheckoutClick();assert.equal(payload.customer.firstName,'Mary Jane');assert.equal(payload.customer.lastName,'de la Cruz');assert.equal(payload.customer.name,'Mary Jane de la Cruz');
 const beforeMissingFirst=calls;nameFields['checkout-first-name'].value='';await ctx.handleCheckoutClick();assert.equal(calls,beforeMissingFirst,'Last name alone cannot bypass first-name validation');
 for(const [hostname,port,wanted] of [['127.0.0.1','5500','http://127.0.0.1:3000'],['localhost','5500','http://localhost:3000'],['localhost','3000','http://localhost:3000'],['brackishroots.com','','https://brackishroots.com']]){
  const protocol=hostname==='brackishroots.com'?'https:':'http:',origin=protocol+'//'+hostname+(port?':'+port:'');const c={window:{location:{hostname,port,protocol,origin}},console:{log(){}}};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/storefront/config.js'),'utf8')+'\nglobalThis.resolved=API_BASE;',c);assert.equal(c.resolved,wanted);
 }
 console.log('PASS: checkout cents/quantity/variation/customer/shipping payload; new checkout resets prior confirmation flags; missing-name validation; local and future-domain backend routing. No live requests made.');
})().catch(e=>{console.error(e);process.exit(1)});
