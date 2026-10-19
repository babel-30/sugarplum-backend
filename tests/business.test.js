'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'brackish-tests-'));
process.env.BR_TEST_LEGACY_IMPORT='false';
// Independent fixtures: never copy the owner's settings, artwork or order data.
fs.writeFileSync(path.join(temp,'adminConfig.json'),JSON.stringify({shippingFlatRate:7.99,freeShippingThreshold:75}));
fs.writeFileSync(path.join(temp,'productConfig.json'),'{}');
fs.writeFileSync(path.join(temp,'patchesConfig.json'),JSON.stringify({patches:[{id:'test-builder-art',name:'Test Builder Artwork',imageUrl:'/test-art.png',active:true,widthInches:3,heightInches:2}]}));
Object.assign(process.env,{NODE_ENV:'test',DATA_DIR:temp,MAIL_DISABLED:'true',ADMIN_USERNAME:'test-owner',ADMIN_PASSWORD:'test-only-password',SESSION_SECRET:'test-only-session-secret',SQUARE_LOCATION_ID:'LOC',SQUARE_ENVIRONMENT:'sandbox',SQUARE_WEBHOOK_SIGNATURE_KEY:'test-signature',SQUARE_WEBHOOK_URL:'https://brackishroots.com/webhooks/square',PUBLIC_SITE_URL:'https://brackishroots.com'});
const orders=new Map(),payments=new Map(),invoices=new Map();let counter=0,checkoutBody,invoiceBody,earlyWebhook=false;
function makeOrder(body){const order={...body,id:'SQ-'+(++counter),totalMoney:{amount:body.lineItems.reduce((n,l)=>n+Number(l.quantity)*Number(l.basePriceMoney.amount),0),currency:'USD'},state:'OPEN'};orders.set(order.id,order);return order;}
function paid(orderId){const order=orders.get(orderId),payment={id:'PAY-'+orderId,status:'COMPLETED',orderId,locationId:'LOC',amountMoney:{amount:order.totalMoney.amount,currency:'USD'}};payments.set(payment.id,payment);order.tenders=[{paymentId:payment.id}];order.state='COMPLETED';return payment;}
global.__BR_CATALOG_TEST__=[{id:'premade',name:'Richardson 112PFP',category:'Hats',type:'Hats',variations:[{id:'premade-v',name:'Camo',color:'Camo',price:30,quantity:3}]},{id:'hat',name:'Richardson 112',category:'Hat Blanks',type:'Hat Blanks',image:'https://example.test/hat.png',variations:[{id:'hat-v',color:'Teal',name:'Teal',price:25,quantity:5}]},{id:'patch',name:'Coastal Patch',category:'Patches',type:'Patches',variations:[{id:'patch-v',color:'Default',price:8,quantity:10}]},{id:'print',name:'Custom Print',category:'3D',type:'3D',variations:[{id:'print-v',color:'Default',price:12,quantity:0}]},{id:'secret',name:'Private Test',category:'Apparel',variations:[{id:'secret-v',color:'White',size:'L',price:20,quantity:4}]}];
global.__BR_SQUARE_TEST__={checkoutApi:{async createPaymentLink(body){checkoutBody=body;const order=makeOrder(body.order);if(earlyWebhook){const payment=paid(order.id);await system.business.finaliseOrder(order.id,payment.id);}return {result:{paymentLink:{id:'LINK-'+order.id,orderId:order.id,url:'https://square.test/pay/'+order.id}}};}},ordersApi:{async retrieveOrder(id){return {result:{order:orders.get(id)}};},async createOrder(body){let order=[...orders.values()].find(o=>o.referenceId===body.order.referenceId);if(!order)order=makeOrder(body.order);return {result:{order}};}},paymentsApi:{async getPayment(id){return {result:{payment:payments.get(id)}};}},customersApi:{async createCustomer(){return {result:{customer:{id:'CUSTOMER'}}};}},invoicesApi:{async createInvoice(body){invoiceBody=body;let invoice=[...invoices.values()].find(i=>i.orderId===body.invoice.orderId);if(!invoice){invoice={...body.invoice,id:'INV-'+(++counter),version:0,status:'DRAFT'};invoices.set(invoice.id,invoice);}return {result:{invoice}};},async publishInvoice(id){const invoice=invoices.get(id);invoice.status='UNPAID';invoice.publicUrl='https://square.test/invoice/'+id;return {result:{invoice}};},async getInvoice(id){return {result:{invoice:invoices.get(id)}};},async cancelInvoice(id){invoices.get(id).status='CANCELED';return {result:{invoice:invoices.get(id)}};}}};
const system=require('../server');let server,base,cookie='',csrf='',project,token,mockupId,shop,shopToken;
const buyer={name:'Test Customer',email:'customer@example.test',address1:'123 Test Lane',city:'Biloxi',state:'MS',postalCode:'39530'};
async function req(url,method='GET',body,extra={},auth=false){const form=body instanceof FormData;const r=await fetch(base+url,{method,headers:{...(form?{}:{'Content-Type':'application/json'}),...(auth?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...extra},...(body!==undefined?{body:form?body:JSON.stringify(body)}:{})});let data;const type=r.headers.get('content-type')||'';if(type.includes('json'))data=await r.json();else data=Buffer.from(await r.arrayBuffer());return {status:r.status,data,headers:r.headers};}
const ph=()=>({'X-Project-Token':token});
async function webhook(id,payment){const body={event_id:id,type:'payment.updated',data:{object:{payment:{id:payment.id,status:payment.status,order_id:payment.orderId,location_id:payment.locationId}}}};const raw=JSON.stringify(body),signature=crypto.createHmac('sha256',process.env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(process.env.SQUARE_WEBHOOK_URL+raw).digest('base64');return req('/webhooks/square','POST',body,{'x-square-hmacsha256-signature':signature});}
before(async()=>{server=system.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{system.business.stop();await new Promise(r=>server.close(r));system.db.close();fs.rmSync(temp,{recursive:true,force:true});});

test('admin authentication, CSRF, persistent session, and public settings',async()=>{assert.equal((await req('/admin/business/settings')).status,401);const login=await req('/admin/login','POST',{username:'test-owner',password:'test-only-password'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.data.csrfToken;assert.equal((await req('/admin/me','GET',undefined,{},true)).data.isAdmin,true);assert.equal(system.db.prepare('SELECT COUNT(*) AS n FROM admin_sessions').get().n,1);assert.equal((await req('/admin/business/settings','PUT',{businessName:'Unsafe'}, {Cookie:cookie})).status,403);const publicConfig=await req('/store/config');assert.equal(publicConfig.data.contactEmail,'brackishroots@gmail.com');assert.equal(publicConfig.data.notificationEmail,undefined);assert.equal((await req('/','GET')).headers.get('content-type').includes('text/html'),true);});
test('authoritative totals ignore submitted prices and reject unpaid return',async()=>{const r=await req('/checkout','POST',{customer:buyer,cart:[{id:'patch',catalogObjectId:'patch-v',quantity:2,price:1}],shippingTotalCents:0});assert.equal(r.status,200);assert.equal(checkoutBody.order.lineItems[0].basePriceMoney.amount,800);assert.equal(checkoutBody.order.referenceId,r.data.pendingId);assert.ok(r.data.totals.totalCents>=1600);assert.equal((await req('/checkout/confirm','POST',{pendingId:r.data.pendingId})).status,409);assert.equal(system.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,0);const pending=system.db.prepare('SELECT * FROM pending_checkouts WHERE id=?').get(r.data.pendingId),payment=paid(pending.square_order_id);assert.equal((await webhook('event-paid',payment)).status,200);assert.equal((await webhook('event-paid',payment)).data.duplicate,true);assert.equal((await req('/checkout/confirm','POST',{pendingId:r.data.pendingId})).status,200);assert.equal(system.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1);assert.equal(system.db.prepare("SELECT COUNT(*) AS n FROM mail_queue WHERE dedupe_key LIKE 'paid-%'").get().n,2);});
test('rejects stock conflicts, mixed carts, hidden products and forged webhooks',async()=>{assert.equal((await req('/checkout','POST',{customer:buyer,cart:[{id:'premade',catalogObjectId:'premade-v',quantity:2},{id:'premade',catalogObjectId:'premade-v',quantity:2}]})).data.type,'OUT_OF_STOCK');await req('/admin/business/products/secret','PUT',{privateOnly:true}, {},true);assert.equal((await req('/store/products/secret')).status,404);assert.equal((await req('/checkout','POST',{customer:buyer,cart:[{id:'secret',catalogObjectId:'secret-v',quantity:1}]})).status,403);assert.equal((await req('/checkout','POST',{customer:buyer,cart:[{id:'patch',catalogObjectId:'patch-v',quantity:1},{id:'fake',kind:'private',quantity:1}]})).status,400);assert.equal((await req('/webhooks/square','POST',{event_id:'forged',type:'payment.updated'})).status,403);});
test('early payment notification correlates the durable checkout reference',async()=>{earlyWebhook=true;const r=await req('/checkout','POST',{customer:buyer,cart:[{id:'patch',catalogObjectId:'patch-v',quantity:1}]});earlyWebhook=false;assert.equal(r.status,200);assert.equal(system.db.prepare('SELECT status FROM pending_checkouts WHERE id=?').get(r.data.pendingId).status,'CONFIRMED');assert.equal(system.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,2);});
test('builder library and standalone Square patches are independent',async()=>{assert.equal((await req('/builder/price','POST',{id:'hat',catalogObjectId:'hat-v',customHat:{patchId:'library-art',placement:'Left'}})).status,409);const patchFile=path.join(temp,'patchesConfig.json');assert.equal(fs.existsSync(patchFile),true);await req('/admin/business/products/hat','PUT',{builderEligible:true}, {},true);await req('/admin/business/settings','PUT',{builderPricingEnabled:true,builderPatchPriceCents:500,assemblyFeeCents:300}, {},true);const existing=await req('/admin/patches','GET',undefined,{},true);assert.equal(existing.status,200);const library=existing.data.patches||existing.data;assert.ok(library.length);const libraryPatch=library[0];const result=await req('/builder/price','POST',{id:'hat',catalogObjectId:'hat-v',customHat:{patchId:libraryPatch.id,placement:'Left'}});assert.equal(result.status,200);assert.equal(result.data.priceCents,3300);assert.equal((await req('/builder/price','POST',{id:'hat',catalogObjectId:'hat-v',customHat:{patchId:'patch',placement:'Left'}})).status,409);assert.equal((await req('/store/products/patch')).data.variations[0].price,8);});
test('made-to-order products can be bought at zero tracked stock',async()=>{await req('/admin/business/products/print','PUT',{fulfillmentMode:'made-to-order',productionDays:10},{},true);assert.equal((await req('/checkout','POST',{customer:buyer,cart:[{id:'print',catalogObjectId:'print-v',quantity:2}]})).status,200);const products=await req('/products');assert.equal(products.status,200);assert.ok(products.data.some(p=>p.id==='print'));assert.ok(!products.data.some(p=>p.id==='secret'));});
test('private request artwork and unpublished quotes are protected',async()=>{const data=new FormData();data.set('name',buyer.name);data.set('email',buyer.email);data.set('description','Team logo hats and shirts');data.set('products','10 hats, teal; 10 shirts, white, M/L');data.set('productSelections',JSON.stringify([{type:'Hats',productId:'hat',variationId:'hat-v',quantity:10,notes:'League logo'}]));data.set('company','Test League');data.append('files',new Blob(['private artwork'],{type:'application/pdf'}),'logo.pdf');const r=await req('/custom-requests','POST',data);assert.equal(r.status,201);project=r.data.id;token=r.data.reviewUrl.split('#')[1];assert.equal((await req('/projects/current')).status,404);const view=await req('/projects/current','GET',undefined,ph());assert.equal(view.status,200);assert.equal(view.data.files.length,1);const file=view.data.files[0];assert.equal((await req('/projects/current/files/'+file.id,'GET',undefined,ph())).headers.get('content-disposition').startsWith('attachment'),true);assert.equal((await req('/uploads/'+file.id)).status,404);const mockups=new FormData();mockups.append('files',new Blob([Buffer.from('89504e470d0a1a0a','hex')],{type:'image/png'}),'hat-preview.png');assert.equal((await req('/admin/projects/'+project+'/mockups','POST',mockups,{},true)).status,200);const admin=await req('/admin/projects/'+project,'GET',undefined,{},true);mockupId=admin.data.files.find(f=>f.kind==='mockup').id;const q={items:[{name:'Approved Team Hat',category:'Hats',quantity:10,unitPriceCents:3000,colors:['Teal'],sizes:['One size'],mockupId}],mockupIds:[mockupId],shippingCents:1000,taxCents:0,setupCents:2000,terms:'10 days after payment',productionDays:10};assert.equal((await req('/admin/projects/'+project+'/quote','PUT',q,{},true)).status,200);const draft=await req('/projects/current','GET',undefined,ph());assert.equal(draft.data.quote,null);assert.equal(draft.data.files.some(f=>f.id===mockupId),false);assert.equal((await req('/projects/current/files/'+mockupId,'GET',undefined,ph())).status,404);const published=await req('/admin/projects/'+project+'/publish','POST',{}, {},true);token=published.data.reviewUrl.split('#')[1];assert.equal((await req('/projects/current','GET',undefined,ph())).data.quote.totalCents,33000);});
test('approvals are versioned, edits invalidate them, and shops expose only approved items',async()=>{let p=(await req('/projects/current','GET',undefined,ph())).data;assert.equal((await req('/projects/current/approve','POST',{revision:p.revision-1,accepted:true},ph())).status,409);assert.equal((await req('/projects/current/approve','POST',{revision:p.revision,accepted:true},ph())).status,200);const r=await req('/admin/projects/'+project+'/shops','POST',{name:'Test League Shop',passcode:'team-only'}, {},true);assert.equal(r.status,200);shop=r.data.id;shopToken=r.data.shopUrl.split('#')[1];assert.equal((await req('/private-shop','GET',undefined,{'X-Shop-Token':shopToken})).status,401);const sh={'X-Shop-Token':shopToken,'X-Shop-Passcode':'team-only'};const s=await req('/private-shop','GET',undefined,sh);assert.equal(s.status,200);assert.equal(s.data.items.length,1);const ownFile=system.db.prepare("SELECT id FROM project_files WHERE project_id=? AND kind='artwork'").get(project).id;assert.equal((await req('/private-shop/files/'+ownFile,'GET',undefined,sh)).status,404);assert.equal((await req('/checkout','POST',{customer:buyer,privateShopToken:shopToken,privateShopPasscode:'team-only',cart:[{kind:'private',id:s.data.items[0].id,color:'Forged',size:'One size',quantity:1}]})).status,400);const checkout=await req('/checkout','POST',{customer:buyer,privateShopToken:shopToken,privateShopPasscode:'team-only',cart:[{kind:'private',id:s.data.items[0].id,color:'Teal',size:'One size',quantity:2,price:1}]});assert.equal(checkout.status,200);assert.equal(checkoutBody.order.lineItems[0].basePriceMoney.amount,3000);assert.equal((await req('/projects/current/comments','POST',{message:'Please move the logo left'},ph())).status,200);assert.equal((await req('/private-shop','GET',undefined,sh)).status,409);assert.equal((await req('/projects/current/pay','POST',buyer,ph())).status,409);});
test('revised quote invoices are payable once and register paid production orders',async()=>{const q={items:[{name:'Final Hat',category:'Hats',quantity:10,unitPriceCents:3000,mockupId,colors:['Teal'],sizes:['One size']}],mockupIds:[mockupId],shippingCents:1000,setupCents:2000,taxCents:0,productionDays:10};await req('/admin/projects/'+project+'/quote','PUT',q,{},true);const publish=await req('/admin/projects/'+project+'/publish','POST',{}, {},true);token=publish.data.reviewUrl.split('#')[1];const p=(await req('/projects/current','GET',undefined,ph())).data;await req('/projects/current/approve','POST',{revision:p.revision,accepted:true},ph());assert.equal((await req('/projects/current/pay','POST',{},ph())).status,400);const r=await req('/projects/current/pay','POST',buyer,ph());assert.equal(r.status,200);assert.equal(invoiceBody.invoice.deliveryMethod,'EMAIL');assert.equal(invoiceBody.invoice.paymentRequests[0].dueDate,p.quote.expiresAt.slice(0,10));assert.equal((await req('/projects/current/pay','POST',buyer,ph())).data.paymentUrl,r.data.paymentUrl);assert.equal(invoices.size,1);const stored=system.db.prepare('SELECT * FROM projects WHERE id=?').get(project),invoice=invoices.get(stored.square_invoice_id);const payment=paid(invoice.orderId);assert.equal((await webhook('paid-quote',payment)).status,200);assert.equal(system.db.prepare('SELECT status FROM projects WHERE id=?').get(project).status,'PAID');const order=system.db.prepare('SELECT * FROM orders WHERE project_id=?').get(project);assert.equal(order.total_money,33000);assert.equal(JSON.parse(order.shipping_json).address1,buyer.address1);assert.equal((await req('/admin/projects/'+project+'/quote','PUT',q,{},true)).status,409);});
test('visitor tracking honors opt-in and backup includes private business data',async()=>{await req('/admin/business/settings','PUT',{analyticsEnabled:true},{},true);assert.equal((await req('/analytics/events','POST',{name:'page_view',visitorId:'anon-test',consent:false})).status,204);assert.equal(system.db.prepare('SELECT COUNT(*) AS n FROM analytics_events').get().n,0);await req('/analytics/events','POST',{name:'page_view',visitorId:'anon-test',consent:true,source:'test-campaign'});assert.equal((await req('/admin/dashboard','GET',undefined,{},true)).data.visitors,1);assert.equal((await req('/analytics/events','POST',{name:'private_artwork',consent:true})).status,400);const backup=await req('/admin/backups','POST',{}, {},true);assert.equal(backup.status,200);assert.equal(backup.data.slice(0,2).toString(),'PK');assert.equal(system.db.prepare("SELECT COUNT(*) AS n FROM mail_queue WHERE status='SENT'").get().n,0);});
test('shipping updates queue email, packing slips render, archives preserve history',async()=>{const order=system.db.prepare('SELECT id FROM orders ORDER BY id LIMIT 1').get();assert.equal((await req('/admin/orders/'+order.id,'PUT',{status:'IN_PRODUCTION'}, {},true)).status,200);assert.equal((await req('/admin/orders/'+order.id,'PUT',{status:'SHIPPED',trackingNumber:'TEST-TRACKING'}, {},true)).status,200);assert.equal(system.db.prepare("SELECT COUNT(*) AS n FROM mail_queue WHERE dedupe_key LIKE 'status:%'").get().n,2);const pdf=await req('/admin/orders/'+order.id+'/packing-slip','GET',undefined,{},true);assert.equal(pdf.status,200);assert.equal(pdf.data.slice(0,4).toString(),'%PDF');await req('/admin/orders/'+order.id,'PUT',{status:'ARCHIVED'}, {},true);const count=system.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;assert.equal((await req('/admin/orders/archive-download','GET',undefined,{},true)).status,200);assert.equal(system.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,count);});
test('verified refund notifications update net revenue and are idempotent',async()=>{const order=system.db.prepare('SELECT * FROM orders ORDER BY id LIMIT 1').get(),ledger=system.db.prepare('SELECT * FROM processed_payments WHERE local_order_id=?').get(order.id),payment=payments.get(ledger.square_payment_id);payment.refundedMoney={amount:order.total_money,currency:'USD'};const body={event_id:'refund-event',type:'refund.updated',data:{object:{refund:{id:'REFUND',payment_id:payment.id,status:'COMPLETED'}}}};const raw=JSON.stringify(body),signature=crypto.createHmac('sha256',process.env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(process.env.SQUARE_WEBHOOK_URL+raw).digest('base64');assert.equal((await req('/webhooks/square','POST',body,{'x-square-hmacsha256-signature':signature})).status,200);assert.equal(system.db.prepare('SELECT payment_status FROM orders WHERE id=?').get(order.id).payment_status,'REFUNDED');assert.equal((await req('/webhooks/square','POST',body,{'x-square-hmacsha256-signature':signature})).data.duplicate,true);});

test('sandbox category split keeps blanks in the builder and premade hats purchasable',async()=>{
 const list=(await req('/products')).data,blank=list.find(p=>p.id==='hat'),premade=list.find(p=>p.id==='premade');
 assert.equal(blank.category,'Hat Blanks');assert.equal(blank.builderEligible,true);assert.equal(premade.category,'Hats');
 await req('/admin/business/products/premade','PUT',{builderEligible:true},{},true);
 assert.equal((await req('/admin/business/catalog','GET',undefined,{},true)).data.find(p=>p.id==='premade').builderEligible,false);
 const patch=(await req('/admin/patches','GET',undefined,{},true)).data.patches[0];
 assert.equal((await req('/builder/price','POST',{id:'hat',catalogObjectId:'hat-v',customHat:{patchId:patch.id,placement:'Center'}})).status,200);
 assert.equal((await req('/builder/price','POST',{id:'premade',catalogObjectId:'premade-v',customHat:{patchId:patch.id,placement:'Center'}})).status,409);
 assert.equal((await req('/checkout','POST',{customer:buyer,cart:[{id:'hat',catalogObjectId:'hat-v',quantity:1}]})).status,409);
 assert.equal((await req('/checkout','POST',{customer:buyer,cart:[{id:'premade',catalogObjectId:'premade-v',quantity:1}]})).status,200);
});
test('per-patch customer price and attachment charge drive sandbox totals and follow defaults when cleared',async()=>{
 const hat=global.__BR_CATALOG_TEST__.find(p=>p.id==='hat'),oldPrice=hat.variations[0].price;hat.variations[0].price=20;
 try{
  await req('/admin/business/settings','PUT',{builderPricingEnabled:true,builderPatchPriceCents:600,assemblyFeeCents:50},{},true);
  let library=(await req('/admin/patches','GET',undefined,{},true)).data.patches,p=library[0];
  const price=()=>req('/builder/price','POST',{id:'hat',catalogObjectId:'hat-v',customHat:{patchId:p.id,placement:'Center'}});
  library[0]={...p,customerPriceCents:null,attachmentFeeCents:null};assert.equal((await req('/admin/patches','PUT',{patches:library},{},true)).status,200);
  assert.equal((await price()).data.priceCents,2650);
  library[0].customerPriceCents=1000;await req('/admin/patches','PUT',{patches:library},{},true);assert.equal((await price()).data.priceCents,3050);
  await req('/admin/business/settings','PUT',{assemblyFeeCents:100},{},true);assert.equal((await price()).data.priceCents,3100);
  library[0].attachmentFeeCents=150;await req('/admin/patches','PUT',{patches:library},{},true);assert.equal((await price()).data.priceCents,3150);
  await req('/admin/business/settings','PUT',{assemblyFeeCents:200},{},true);assert.equal((await price()).data.priceCents,3150,'Explicit patch attachment charge stays fixed');
  library[0].customerPriceCents=null;library[0].attachmentFeeCents=null;await req('/admin/patches','PUT',{patches:library},{},true);assert.equal((await price()).data.priceCents,2800);
  library[0].customerPriceCents=-1;assert.equal((await req('/admin/patches','PUT',{patches:library},{},true)).status,400);assert.equal((await price()).data.priceCents,2800,'Invalid update changes nothing');
  const stored=(await req('/admin/patches','GET',undefined,{},true)).data.patches[0];assert.equal(stored.customerPriceCents,null);assert.equal(stored.attachmentFeeCents,null);
 }finally{hat.variations[0].price=oldPrice;}
});
test('patch colors price independently, unavailable colors block purchase, and restock alerts queue exactly once',async()=>{
 const hat=global.__BR_CATALOG_TEST__.find(p=>p.id==='hat'),old=hat.variations[0].price;hat.variations[0].price=20;
 try{await req('/admin/business/settings','PUT',{builderPricingEnabled:true,builderPatchPriceCents:600,assemblyFeeCents:50},{},true);
 let library=(await req('/admin/patches','GET',undefined,{},true)).data.patches,p=library[0];p.customerPriceCents=null;p.attachmentFeeCents=null;p.variants=[{id:'brown',name:'Brown / Black',material:'Leatherette',stockStatus:'out-of-stock',imageUrl:'/test-brown.png',customerPriceCents:null,attachmentFeeCents:null},{id:'gold',name:'Black / Gold',material:'Leatherette',stockStatus:'in-stock',imageUrl:'/test-gold.png',customerPriceCents:1000,attachmentFeeCents:null}];
 assert.equal((await req('/admin/patches','PUT',{patches:library},{},true)).status,200);
 const price=id=>req('/builder/price','POST',{id:'hat',catalogObjectId:'hat-v',customHat:{patchId:p.id,patchVariantId:id,placement:'Center'}});
 assert.equal((await price('brown')).status,409);const gold=await price('gold');assert.equal(gold.data.priceCents,3050);assert.equal(gold.data.customHat.patchVariantName,'Black / Gold');assert.equal((await price('fake')).status,409);
 const subscribe=id=>req('/stock-alerts','POST',{source:'patch',itemId:p.id,variantId:id,email:'stock@example.test',consent:true});assert.equal((await subscribe('gold')).status,409);assert.equal((await subscribe('brown')).status,200);assert.equal((await subscribe('brown')).status,200);
 assert.equal(system.db.prepare("SELECT COUNT(*) AS n FROM restock_subscriptions WHERE status='WAITING'").get().n,1);
 const row=system.db.prepare("SELECT * FROM restock_subscriptions WHERE email='stock@example.test'").get();
 const brownMaterial=(await req('/admin/patch-materials','GET',undefined,{},true)).data.materials.find(m=>m.name==='Brown / Black');await req('/admin/patch-materials/'+brownMaterial.id,'PUT',{...brownMaterial,stockStatus:'low-stock'},{},true);assert.equal((await price('brown')).data.priceCents,2650);
 system.business.checkRestocks();assert.equal(system.db.prepare("SELECT COUNT(*) AS n FROM mail_queue WHERE dedupe_key LIKE 'restock:%'").get().n,1);assert.equal(system.db.prepare('SELECT status FROM restock_subscriptions WHERE id=?').get(row.id).status,'NOTIFIED');
 const publicP=(await req('/patches')).data.patches[0];assert.equal(publicP.variants[0].stockStatus,'low-stock');assert.equal(publicP.variants[1].stockStatus,'in-stock');
 await req('/admin/patch-materials/'+brownMaterial.id,'PUT',{...brownMaterial,stockStatus:'out-of-stock'},{},true);await subscribe('brown');const token=system.db.prepare('SELECT token FROM restock_subscriptions WHERE id=?').get(row.id).token;await req('/stock-alerts/unsubscribe','POST',{token});await req('/admin/patch-materials/'+brownMaterial.id,'PUT',{...brownMaterial,stockStatus:'in-stock'},{},true);assert.equal(system.db.prepare("SELECT COUNT(*) AS n FROM mail_queue WHERE dedupe_key LIKE 'restock:%'").get().n,1,'Cancelled subscription does not notify');
 }finally{hat.variations[0].price=old;}
});
test('Square color alerts check the exact variation and require customer opt-in',async()=>{
 const product=global.__BR_CATALOG_TEST__.find(p=>p.id==='premade');product.variations[0].quantity=0;const body={source:'square',itemId:'premade',variantId:'premade-v',email:'square-stock@example.test',consent:true};assert.equal((await req('/stock-alerts','POST',{...body,consent:false})).status,400);assert.equal((await req('/stock-alerts','POST',body)).status,200);product.variations[0].quantity=1;system.business.checkRestocks();system.business.checkRestocks();assert.equal(system.db.prepare("SELECT COUNT(*) AS n FROM mail_queue WHERE recipient='square-stock@example.test'").get().n,1);product.variations[0].quantity=3;
});

test('builder cart notes survive checkout and production orders; premade notes are ignored',async()=>{
 const p=(await req('/admin/patches','GET',undefined,{},true)).data.patches[0];
 const item={id:'hat',catalogObjectId:'hat-v',quantity:1,customHat:{patchId:p.id,patchVariantId:p.variants[0].id,placement:'Center'},customerNote:'  Please place the patch slightly higher.  '};
 const checkout=await req('/checkout','POST',{customer:buyer,cart:[item]});assert.equal(checkout.status,200);
 assert.ok(checkoutBody.order.lineItems[0].note.startsWith('Customer note: Please place the patch slightly higher.'));
 const pending=system.db.prepare('SELECT * FROM pending_checkouts WHERE id=?').get(checkout.data.pendingId);
 assert.equal(JSON.parse(pending.cart_json)[0].customerNote,'Please place the patch slightly higher.');
 await webhook('builder-note-paid',paid(pending.square_order_id));
 const order=system.db.prepare('SELECT * FROM orders WHERE square_order_id=?').get(pending.square_order_id);
 assert.ok(order);assert.equal(JSON.parse(order.items_json)[0].customerNote,'Please place the patch slightly higher.');const detail=await req('/admin/orders/'+order.id,'GET',undefined,{},true);assert.equal(detail.status,200);
 const pdf=await req('/admin/orders/'+order.id+'/packing-slip','GET',undefined,{},true);assert.equal(pdf.status,200);assert.equal(pdf.data.slice(0,4).toString(),'%PDF');
 assert.equal((await req('/checkout','POST',{customer:buyer,cart:[{...item,customerNote:'a'.repeat(251)}]})).status,400);
 const premade=await req('/checkout','POST',{customer:buyer,cart:[{id:'premade',catalogObjectId:'premade-v',quantity:1,customerNote:'Ignore this'}]});assert.equal(premade.status,200);
 const plain=system.db.prepare('SELECT cart_json FROM pending_checkouts WHERE id=?').get(premade.data.pendingId);assert.equal(JSON.parse(plain.cart_json)[0].customerNote,undefined);
});

test('shared material stock, edits, reassignment, restock alerts and persistence span every design',async()=>{
 assert.equal((await req('/admin/patch-materials')).status,401);
 const materials=(await req('/admin/patch-materials','GET',undefined,{},true)).data.materials,brown=materials.find(m=>m.name==='Brown / Black'),gold=materials.find(m=>m.name==='Black / Gold');
 let patches=(await req('/admin/patches','GET',undefined,{},true)).data.patches;const first=patches[0];
 patches.push({...first,id:'shared-design',name:'Second shared design',variants:[{...first.variants[0],id:'second-brown',imageUrl:'/second-photo.png',customerPriceCents:750}]});
 assert.equal((await req('/admin/patches','PUT',{patches},{},true)).status,200);
 const put=status=>req('/admin/patch-materials/'+brown.id,'PUT',{...brown,stockStatus:status},{},true);
 await put('out-of-stock');let publicP=(await req('/patches')).data.patches;
 assert.equal(publicP.find(p=>p.id===first.id).variants[0].stockStatus,'out-of-stock');assert.equal(publicP.find(p=>p.id==='shared-design').variants[0].stockStatus,'out-of-stock');assert.equal(publicP.find(p=>p.id===first.id).variants[1].stockStatus,'in-stock');
 const body={id:'hat',catalogObjectId:'hat-v',customHat:{patchId:'shared-design',patchVariantId:'second-brown',placement:'Center'}};
 assert.equal((await req('/builder/price','POST',body)).status,409);assert.equal((await req('/checkout','POST',{customer:buyer,cart:[{...body,quantity:1}]})).status,409);
 for(const [itemId,variantId]of [[first.id,first.variants[0].id],['shared-design','second-brown']])assert.equal((await req('/stock-alerts','POST',{source:'patch',itemId,variantId,email:'shared-stock@example.test',consent:true})).status,200);
 await put('low-stock');assert.equal((await req('/builder/price','POST',body)).status,200);system.business.checkRestocks();assert.equal(system.db.prepare("SELECT COUNT(*) AS n FROM mail_queue WHERE recipient='shared-stock@example.test'").get().n,2);
 assert.equal((await req('/admin/patch-materials/'+brown.id,'DELETE',{}, {},true)).status,409);
 assert.equal((await req('/admin/patch-materials/'+brown.id,'PUT',{...brown,name:'Brown / Charcoal',stockStatus:'in-stock'},{},true)).status,200);
 publicP=(await req('/patches')).data.patches;assert.equal(publicP.find(p=>p.id==='shared-design').variants[0].name,'Brown / Charcoal');
 const deleted=await req('/admin/patch-materials/'+brown.id,'DELETE',{replacementId:gold.id},{},true);assert.equal(deleted.status,200);assert.equal(deleted.data.reassigned,2);
 const second=(await req('/patches')).data.patches.find(p=>p.id==='shared-design').variants[0];assert.equal(second.materialId,gold.id);assert.equal(second.customerPriceCents,750);assert.equal(new URL(second.imageUrl,'http://test').searchParams.get('asset'),'/second-photo.png');assert.equal(second.id,'second-brown');
 const stored=JSON.parse(fs.readFileSync(path.join(temp,'patchesConfig.json')));assert(!stored.materials.some(m=>m.id===brown.id));assert.equal(stored.patches.find(p=>p.id==='shared-design').variants[0].materialId,gold.id);
 patches=(await req('/admin/patches','GET',undefined,{},true)).data.patches;patches[0].variants[0].materialId='nonexistent';assert.equal((await req('/admin/patches','PUT',{patches},{},true)).status,400);
 assert.equal((await req('/admin/patch-materials','POST',{name:'Black/Gold',type:'leatherette',stockStatus:'in-stock'},{},true)).status,400);
 const added=await req('/admin/patch-materials','POST',{name:'Silver / Black',type:'UV',stockStatus:'in-stock'},{},true);assert.equal(added.status,201);assert.equal((await req('/admin/patch-materials/'+added.data.material.id,'DELETE',{}, {},true)).status,200);
});
test('packing PDFs embed thumbnails, builder overlays and notes, and paginate long orders',async()=>{
 const sharp=require('sharp'),dir=path.join(temp,'uploads','patches');fs.mkdirSync(dir,{recursive:true});
 const svg=body=>Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">'+body+'</svg>');
 await sharp(svg('<rect width="600" height="400" fill="white"/><path d="M140 280 Q130 100 300 95 Q470 100 460 280Z" fill="#222"/><ellipse cx="300" cy="280" rx="205" ry="35" fill="#111"/>')).png().toFile(path.join(dir,'packing-hat.png'));
 await sharp(svg('<rect width="600" height="400" fill="white"/><path d="M210 60 L140 90 L80 160 L170 200 L190 160 L190 350 L410 350 L410 160 L430 200 L520 160 L460 90 L390 60 Q300 140 210 60" fill="#9f3434"/>')).png().toFile(path.join(dir,'packing-shirt.png'));
 await sharp({create:{width:120,height:80,channels:4,background:'#c88b41'}}).png().toFile(path.join(dir,'packing-patch.png'));
 const built={name:'Richardson 112',qty:1,sku:'HAT-112-BLK',color:'Black',image:'/uploads/patches/packing-hat.png',customerNote:'Please place the patch slightly higher.',customHat:{patchName:'Coastal Badge',patchVariantName:'Brown / Black',patchMaterial:'Leatherette',placement:'Center',patchImage:'/uploads/patches/packing-patch.png',preview:{hatImage:'/uploads/patches/packing-hat.png',patchImage:'/uploads/patches/packing-patch.png',patch:{widthInches:3,heightInches:2}}}};
 const shirt={name:'Coastal Shirt',qty:2,sku:'TEE-RED-L',color:'Red',size:'L',printSide:'Front',image:'/uploads/patches/packing-shirt.png'},missing={name:'Legacy item without a photo',qty:1};
 const create=items=>Number(system.db.prepare('INSERT INTO orders(customer_name,customer_email,status,items_json,total_money,currency,created_at,shipping_json) VALUES(?,?,?,?,?,?,?,?)').run('Test Customer','buyer@example.test','PAID',JSON.stringify(items),4949,'USD',new Date().toISOString(),JSON.stringify({address1:'123 Test Lane',city:'Biloxi',state:'MS',zip:'39530'})).lastInsertRowid);
 const single=await req('/admin/orders/'+create([built,shirt,missing])+'/packing-slip','GET',undefined,{},true);assert.equal(single.status,200);assert((single.data.toString('latin1').match(/\/Subtype \/Image/g)||[]).length>=4,'Photo and barcode image objects must be embedded');
 const many=await req('/admin/orders/'+create(Array.from({length:12},(_,i)=>({...built,name:'Builder hat '+(i+1),customerNote:'Long production note. '.repeat(11)})))+'/packing-slip','GET',undefined,{},true);assert.equal(many.status,200);assert((many.data.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>=3);
 if(process.env.BR_PACKING_QA_DIR){fs.mkdirSync(process.env.BR_PACKING_QA_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.BR_PACKING_QA_DIR,'packing-thumbnails.pdf'),single.data);fs.writeFileSync(path.join(process.env.BR_PACKING_QA_DIR,'packing-multiple-pages.pdf'),many.data);}
});
test('new apparel orders confirm spelling without proofs; legacy proofs retain production holds',async()=>{
 const sharp=require('sharp'),bytes=await sharp({create:{width:400,height:500,channels:4,background:'#336650'}}).png().toBuffer();
 global.__BR_CATALOG_TEST__.push({id:'blank-apparel',name:'Blank Coastal Tee',category:'Blank Apparel',type:'T-Shirts',image:'/assets/brackish-roots-logo.png',variations:[{id:'tee-white-l',name:'White / L',color:'White',size:'L',price:12,quantity:8,images:['/assets/brackish-roots-logo.png']},{id:'tee-black-l',name:'Black / L',color:'Black',size:'L',price:12,quantity:8,images:['/assets/brackish-roots-logo.png']}]});
 await req('/admin/business/products/blank-apparel','PUT',{builderEligible:true},{},true);
 let fd=new FormData();fd.append('file',new Blob([bytes],{type:'image/png'}),'design.png');
 const upload=await req('/admin/apparel-designs/upload','POST',fd,{},true);assert.equal(upload.status,200);
 const design={id:'personal-design',name:'Coastal Name',imageUrl:upload.data.imageUrl,active:true,customizable:true,forceUppercase:true,previewPlacements:{Front:{left:46,top:40,width:36},Back:{left:52,top:43,width:51},Pocket:{left:64,top:30,width:17}},fieldLabel:'First name',maxCharacters:20,blockedColors:['White'],categories:['Coastal','Names'],locations:['Pocket','Front','Back','Front & Back'],prices:{pocket:400,front:800,back:900}};
 assert.equal((await req('/admin/apparel-designs','PUT',{enabled:true,defaults:{pocket:500,front:800,back:800},categories:['Coastal','Names'],designs:[design]},{},true)).status,200);
 const second={...design,id:'second-design',name:'Another design'};
 assert.equal((await req('/admin/apparel-designs/'+second.id,'PUT',second,{},true)).status,200);
 assert.equal((await req('/admin/apparel-designs/'+design.id,'PUT',{...design,name:'Saved individually'},{},true)).status,200);
 let designState=(await req('/admin/apparel-designs','GET',undefined,{},true)).data;
 assert.equal(designState.designs.find(d=>d.id===second.id).name,'Another design');
 assert.equal((await req('/admin/apparel-categories','POST',{name:'New Category'},{},true)).status,200);
 assert.equal((await req('/admin/apparel-categories/Coastal','DELETE',undefined,{},true)).status,200);
 designState=(await req('/admin/apparel-designs','GET',undefined,{},true)).data;
 assert.equal(designState.designs.length,2);assert(!designState.categories.includes('Coastal'));assert(designState.designs.every(d=>!d.categories.includes('Coastal')&&d.categories.includes('Names')));
 assert.equal((await req('/admin/apparel-designs/'+second.id,'DELETE',undefined,{},true)).status,200);
 await req('/admin/apparel-designs/'+design.id,'PUT',design,{},true);
 const input={id:'blank-apparel',catalogObjectId:'tee-black-l',customApparel:{location:'Front & Back',selections:[{side:'Front',designId:design.id,personalization:'Willow'},{side:'Back',designId:design.id,personalization:'Brennon'}]}};
 assert.equal((await req('/apparel/price','POST',{...input,catalogObjectId:'tee-white-l'})).status,409);
 const price=await req('/apparel/price','POST',input);assert.equal(price.status,200);assert.equal(price.data.priceCents,2900);assert.deepEqual(price.data.customApparel.selections[0].previewPlacement,{left:46,top:40,width:36});assert.deepEqual(price.data.customApparel.selections[1].previewPlacement,{left:52,top:43,width:51});assert.equal(price.data.customApparel.selections[0].personalization,'WILLOW');assert.equal(price.data.customApparel.selections[1].personalization,'BRENNON');
 assert.equal((await req('/checkout','POST',{customer:buyer,cart:[input]})).status,409);
 const cartItem={...input,quantity:1,price:1,customApparel:{...input.customApparel,reviewAccepted:true,checkoutAccepted:true,reviewToken:price.data.reviewToken},customerNote:'Please check the sleeve seam.'};
 for(const missing of ['reviewAccepted','checkoutAccepted'])assert.equal((await req('/checkout','POST',{customer:buyer,cart:[{...cartItem,customApparel:{...cartItem.customApparel,[missing]:false}}]})).status,409);
 const altered={...cartItem,customApparel:{...cartItem.customApparel,selections:[{side:'Front',designId:design.id,personalization:'Changed'},{side:'Back',designId:design.id,personalization:'Brennon'}]}};
 assert.equal((await req('/checkout','POST',{customer:buyer,cart:[altered]})).status,409);
 const checkout=await req('/checkout','POST',{customer:buyer,cart:[cartItem]});assert.equal(checkout.status,200);assert.equal(checkoutBody.order.lineItems[0].basePriceMoney.amount,2900);
 const newPending=system.db.prepare('SELECT * FROM pending_checkouts WHERE id=?').get(checkout.data.pendingId);
 const newCustom=JSON.parse(newPending.cart_json)[0].customApparel;
 assert.equal(newCustom.requiresProof,false);assert.equal(newCustom.requiresPersonalizationReview,true);
 assert.equal(newCustom.spellingApproval.text[0].text,'WILLOW');
 await webhook('apparel-paid',paid(newPending.square_order_id));
 const newOrder=system.db.prepare('SELECT * FROM orders WHERE square_order_id=?').get(newPending.square_order_id);
 assert.equal(newOrder.status,'PAID','New personalized orders do not wait for a separate proof');
 assert.equal(system.db.prepare('SELECT COUNT(*) AS n FROM paid_proofs WHERE order_id=?').get(newOrder.id).n,0);
 assert.equal((await req('/admin/orders/'+newOrder.id,'PUT',{status:'IN_PRODUCTION'},{},true)).status,200);
 const confirmation=system.db.prepare('SELECT message FROM mail_queue WHERE dedupe_key=?').get('paid-customer:'+newPending.square_order_id);
 assert(!confirmation.message.includes('proof will be sent'),'New confirmation emails must not promise a proof');
 // Retained pre-change pending snapshots still follow the existing proof workflow.
 const legacyCheckout=await req('/checkout','POST',{customer:buyer,cart:[cartItem]});assert.equal(legacyCheckout.status,200);
 const pending=system.db.prepare('SELECT * FROM pending_checkouts WHERE id=?').get(legacyCheckout.data.pendingId);
 const legacyItems=JSON.parse(pending.cart_json);legacyItems[0].customApparel.requiresProof=true;delete legacyItems[0].customApparel.requiresPersonalizationReview;
 system.db.prepare('UPDATE pending_checkouts SET cart_json=? WHERE id=?').run(JSON.stringify(legacyItems),pending.id);
 await webhook('legacy-apparel-paid',paid(pending.square_order_id));
 const order=system.db.prepare('SELECT * FROM orders WHERE square_order_id=?').get(pending.square_order_id);assert.equal(order.status,'AWAITING_PROOF');assert.equal(JSON.parse(order.items_json)[0].customApparel.spellingApproval.text[0].text,'WILLOW');
 assert.equal((await req('/admin/orders/'+order.id,'PUT',{status:'IN_PRODUCTION'},{},true)).status,409);
 const proof=(await req('/admin/paid-proofs','GET',undefined,{},true)).data.find(p=>p.order_id===order.id);assert.ok(proof);assert.equal(proof.snapshot.customApparel.selections.length,2);
 fd=new FormData();fd.append('files',new Blob([bytes],{type:'image/png'}),'finished-proof.png');
 assert.equal((await req('/admin/paid-proofs/'+proof.id+'/files','POST',fd,{},true)).status,200);
 const sent=await req('/admin/paid-proofs/'+proof.id+'/publish','POST',{}, {},true);const proofToken=sent.data.reviewUrl.split('#')[1],headers={'X-Proof-Token':proofToken};
 const review=(await req('/proof/current','GET',undefined,headers)).data;
 const image=await req('/proof/current/files/'+review.files[0].id,'GET',undefined,headers);assert.equal(image.status,200);assert.notDeepEqual(image.data,bytes,'Proof delivery must watermark the image');assert.equal((await req('/proof/current/files/'+review.files[0].id)).status,404);
 assert.equal((await req('/proof/current/approve','POST',{revision:review.revision-1,accepted:true,spellingAccepted:true},headers)).status,409);
 assert.equal((await req('/proof/current/approve','POST',{revision:review.revision,accepted:true},headers)).status,400);
 assert.equal((await req('/proof/current/changes','POST',{message:'Please move the name higher.'},headers)).status,200);
 assert.equal((await req('/proof/current/approve','POST',{revision:review.revision,accepted:true,spellingAccepted:true},headers)).status,409);
 fd=new FormData();fd.append('files',new Blob([bytes],{type:'image/png'}),'revised.png');await req('/admin/paid-proofs/'+proof.id+'/files','POST',fd,{},true);
 assert.equal((await req('/proof/current','GET',undefined,headers)).status,404,'Old proof link invalidated');
 const newer=await req('/admin/paid-proofs/'+proof.id+'/publish','POST',{}, {},true),newHeaders={'X-Proof-Token':newer.data.reviewUrl.split('#')[1]},newProof=(await req('/proof/current','GET',undefined,newHeaders)).data;
 await req('/proof/current/approve','POST',{revision:newProof.revision,accepted:true,spellingAccepted:true},newHeaders);
 assert.equal(system.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'PAID');
 assert.equal((await req('/admin/orders/'+order.id,'PUT',{status:'IN_PRODUCTION'},{},true)).status,200);
 assert.equal((await req('/admin/paid-proofs/'+proof.id+'/files','POST',fd,{},true)).status,409,'Production proof cannot be revised');
 const publicDesigns=(await req('/apparel-designs')).data;assert(publicDesigns.designs[0].imageUrl.includes('/media/photo?'));const watermarked=await req(publicDesigns.designs[0].imageUrl);assert.equal(watermarked.status,200);assert.notDeepEqual(watermarked.data,bytes);
 const original=fs.readFileSync(path.join(temp,'apparel-artwork',path.basename(upload.data.imageUrl)));assert.deepEqual(original,bytes,'Original artwork preserved');
 assert.equal((await req('/media/photo?asset=https://example.test/a.png&sig=forged')).status,403);
 assert.equal((await req('/media/resolve','POST',{source:'http://169.254.169.254/latest/meta-data'})).status,404);
 assert.equal((await req('/admin/orders/'+order.id+'/packing-slip','GET',undefined,{},true)).status,200);
 assert.equal((await req('/checkout','POST',{customer:buyer,cart:[{id:'blank-apparel',catalogObjectId:'tee-black-l',quantity:1}]})).status,409);
});
test('custom quote requests accept ten files and remain unpaid before proof approval',async()=>{
 const fd=new FormData();for(const [k,v]of Object.entries({name:buyer.name,email:buyer.email,description:'Hats and apparel for a team',products:'5 hats and 5 shirts'}))fd.set(k,v);
 for(let i=0;i<10;i++)fd.append('files',new Blob(['Original artwork '+i],{type:'application/pdf'}),'art-'+i+'.pdf');
 const request=await req('/custom-requests','POST',fd);assert.equal(request.status,201);const row=system.db.prepare('SELECT * FROM projects WHERE id=?').get(request.data.id);assert.equal(row.status,'REQUESTED');assert.equal(row.payment_url,null);assert.equal(system.db.prepare('SELECT COUNT(*) AS n FROM project_files WHERE project_id=?').get(row.id).n,10);
});

test('Square shipping prefill preserves separate names and supports older full-name clients',async()=>{
 const customer={...buyer,name:'ignored legacy value',firstName:'Mary Jane',lastName:'de la Cruz'};
 const result=await req('/checkout','POST',{customer,cart:[{id:'patch',catalogObjectId:'patch-v',quantity:1}]});assert.equal(result.status,200);
 const a=checkoutBody.prePopulatedData.buyerAddress;assert.equal(a.firstName,'Mary Jane');assert.equal(a.lastName,'de la Cruz');assert.equal(a.addressLine1,buyer.address1);
 assert.equal(system.db.prepare('SELECT customer_name FROM pending_checkouts WHERE id=?').get(result.data.pendingId).customer_name,'Mary Jane de la Cruz');
 const legacy=await req('/checkout','POST',{customer:buyer,cart:[{id:'patch',catalogObjectId:'patch-v',quantity:1}]});assert.equal(legacy.status,200);
 assert.equal(checkoutBody.prePopulatedData.buyerAddress.firstName,'Test');assert.equal(checkoutBody.prePopulatedData.buyerAddress.lastName,'Customer');
});

test('custom request catalog keeps zero-stock choices separate and admin controls survive refresh',async()=>{
 assert.equal((await req('/admin/custom-order-options')).status,401);
 const hat=global.__BR_CATALOG_TEST__.find(p=>p.id==='hat');
 global.__BR_CATALOG_TEST__.push({id:'request-only-tee',name:'Request Only Tee',category:'Blank Apparel',variations:[{id:'request-blue-xl',colorHex:'#2255aa',optionColors:{Color:'#2255aa'},name:'Blue / XL',garmentType:'T-Shirt',color:'Blue',size:'XL',sleeve:'SS',quantity:0,price:12,options:{Color:'Blue',Type:'T-Shirt',Size:'XL',Sleeve:'SS'}},{id:'request-green-m',name:'Green / M',garmentType:'T-Shirt',color:'Green',size:'M',sleeve:'SS',quantity:2,price:12}]});
 const initial=(await req('/admin/custom-order-options','GET',undefined,{},true)).data;
 assert(initial.products.find(p=>p.id==='request-only-tee').variations.some(v=>!v.inStock));
 const settings={products:[{id:'hat',enabled:true,disabledVariationIds:[]},{id:'request-only-tee',enabled:true,disabledVariationIds:[]}],allowHelp:true};
 assert.equal((await req('/admin/custom-order-options','PUT',settings,{Cookie:cookie})).status,403);
 assert.equal((await req('/admin/custom-order-options','PUT',settings,{},true)).status,200);
 let choices=(await req('/custom-order-options')).data;
 const tee=choices.products.find(p=>p.id==='request-only-tee');assert.equal(tee.variations.length,2);assert.equal(tee.variations[0].type,'T-Shirt');assert.equal(tee.variations[0].color,'Blue');assert.equal(tee.variations[0].colorHex,'#2255aa');assert.deepEqual(tee.variations[0].optionColors,{Color:'#2255aa'});assert.equal(tee.variations[1].colorHex,null);assert.equal(tee.variations[0].inStock,undefined);assert(!tee.variations.some(v=>v.color==='Teal'));
 const selections=[{type:'T-Shirt',productId:tee.id,variationId:'request-blue-xl',quantity:12,style:'FORGED NAME',color:'FORGED COLOR',notes:'School logo'},{type:'Hats',productId:hat.id,variationId:'hat-v',quantity:5}];
 const submit=rows=>req('/custom-requests','POST',{name:buyer.name,email:buyer.email,description:'Isolated custom catalog test',productSelections:JSON.stringify(rows),groupShop:'true'});
 const created=await submit(selections);assert.equal(created.status,201);
 const project=(await req('/admin/projects/'+created.data.id,'GET',undefined,{},true)).data;
 assert.equal(project.request.requestedProducts.length,2);assert.equal(project.request.requestedProducts[0].color,'Blue');assert.equal(project.request.requestedProducts[0].style,'Request Only Tee');assert.equal(project.request.requestedProducts[0].quantity,12);assert.equal(project.request.groupShop,true);assert(project.request.products.includes('Blue'));assert(!project.request.products.includes('FORGED'));
 assert.equal((await submit([{...selections[0],quantity:0}])).status,400);
 assert.equal((await submit([{...selections[0],type:'Hats'}])).status,409);
 await req('/admin/custom-order-options','PUT',{products:[{id:tee.id,enabled:true,disabledVariationIds:['request-blue-xl']}]},{},true);
 assert.equal((await submit(selections)).status,409);choices=(await req('/custom-order-options')).data;assert.equal(choices.products.find(p=>p.id===tee.id).variations.length,1);
 await req('/admin/custom-order-options','GET',undefined,{},true);const refreshed=await req('/admin/custom-order-options?refresh=true','GET',undefined,{},true);assert.equal(refreshed.status,200);assert.equal(refreshed.data.products.find(p=>p.id===tee.id).variations[0].enabled,false);
 global.__BR_CATALOG_TEST__.push({id:'new-after-save',name:'New import',category:'Hat Blanks',builderEligible:true,variations:[{id:'new-var',quantity:3}]});await req('/admin/business/products/new-after-save','PUT',{builderEligible:true},{},true);assert(!(await req('/custom-order-options')).data.products.some(p=>p.id==='new-after-save'));
 await req('/admin/custom-order-options','PUT',{products:[{id:'hat',enabled:false,disabledVariationIds:[]}]},{},true);assert(!(await req('/custom-order-options')).data.products.some(p=>p.id==='hat'));
 assert.equal((await submit([{help:true,quantity:3,notes:'Help choose a hoodie'}])).status,201);
 await req('/admin/custom-order-options','PUT',{products:[],allowHelp:false},{},true);assert.equal((await submit([{help:true,quantity:3,notes:'Help choose a hoodie'}])).status,409);
 assert.equal(project.status,'REQUESTED');assert.equal(system.db.prepare('SELECT COUNT(*) AS n FROM orders WHERE project_id=?').get(created.data.id).n,0);
});

test('email status and queue retries report held delivery without sending or rewriting old rows',async()=>{
 assert.equal((await req('/admin/mail-status')).status,401);
 const state=await req('/admin/mail-status','GET',undefined,{},true);assert.equal(state.status,200);assert.equal(state.data.paused,true);assert.equal(state.data.enabled,false);assert.equal(state.data.maxAttempts,8);assert.deepEqual(Object.keys(state.data).sort(),['configured','enabled','maxAttempts','paused']);
 const legacyId=Number(system.db.prepare("INSERT INTO mail_queue(dedupe_key,recipient,subject,message,status,attempts,last_error,created_at) VALUES('test-exhausted-legacy','test@example.test','Fixture','Fixture','PENDING',8,'Fixture error',?)").run(new Date().toISOString()).lastInsertRowid);
 const sentId=Number(system.db.prepare("INSERT INTO mail_queue(dedupe_key,recipient,subject,message,status,attempts,created_at) VALUES('test-already-accepted','test@example.test','Fixture','Fixture','SENT',0,?)").run(new Date().toISOString()).lastInsertRowid);
 const queue=await req('/admin/mail-queue','GET',undefined,{},true);assert.equal(queue.data.find(r=>r.id===legacyId).status,'FAILED');assert.equal(system.db.prepare('SELECT status FROM mail_queue WHERE id=?').get(legacyId).status,'PENDING');
 assert.equal((await req('/admin/mail-queue/'+legacyId+'/retry','POST',{}, {Cookie:cookie})).status,403);
 const retry=await req('/admin/mail-queue/'+legacyId+'/retry','POST',{}, {},true);assert.equal(retry.status,200);assert.equal(retry.data.held,true);const held=system.db.prepare('SELECT status,attempts,last_error,next_attempt FROM mail_queue WHERE id=?').get(legacyId);assert.equal(held.status,'PENDING');assert.equal(held.attempts,0);assert.equal(held.last_error,null);assert.equal(held.next_attempt,0);
 assert.equal((await req('/admin/mail-queue/'+sentId+'/retry','POST',{}, {},true)).status,409);assert.equal((await req('/admin/mail-queue/99999999/retry','POST',{}, {},true)).status,404);assert.equal(system.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='mail-retry' AND entity_id=?").get(String(legacyId)).n,1);
 const dashboard=await req('/admin/dashboard','GET',undefined,{},true);assert.equal(dashboard.data.integrations.mailPaused,true);assert.equal(dashboard.data.integrations.mailEnabled,false);
});

test('fulfillment cannot forge payment or refund and protects unpaid and refunded orders',async()=>{
 const now=new Date().toISOString();
 const insert=system.db.prepare('INSERT INTO orders(customer_name,status,payment_status,total_money,currency,created_at,updated_at,items_json) VALUES(?,?,?,?,?,?,?,?)');
 const legacy=Number(insert.run('Legacy fixture','PENDING','PAID',1000,'USD',now,now,'[]').lastInsertRowid);
 const before=system.db.prepare('SELECT * FROM orders WHERE id=?').get(legacy);
 for(const status of ['PAID','REFUNDED','IN_PRODUCTION','READY','SHIPPED'])assert.equal((await req('/admin/orders/'+legacy,'PUT',{status},{},true)).status,409,status);
 assert.deepEqual(system.db.prepare('SELECT * FROM orders WHERE id=?').get(legacy),before);
 assert.equal((await req('/admin/orders/'+legacy,'GET',undefined,{},true)).data.paymentStatus,'UNVERIFIED');
 assert.equal((await req('/admin/orders','GET',undefined,{},true)).data.orders.find(o=>o.id===legacy).paymentStatus,'UNVERIFIED');
 const paidId=Number(insert.run('Paid fixture','PAID','PAID',1000,'USD',now,now,'[]').lastInsertRowid);
 system.db.prepare('INSERT INTO processed_payments(square_order_id,square_payment_id,local_order_id,created_at) VALUES(?,?,?,?)').run('GUARD-ORDER','GUARD-PAYMENT',paidId,now);
 assert.equal((await req('/admin/orders/'+paidId,'PUT',{trackingNumber:'fixture'},{},true)).status,200);
 assert.equal((await req('/admin/orders/'+paidId,'PUT',{status:'IN_PRODUCTION'},{},true)).status,200);
 assert.equal((await req('/admin/orders/'+paidId,'PUT',{status:'PAID'},{},true)).status,409);
 assert.equal((await req('/admin/orders/'+paidId,'PUT',{status:'REFUNDED'},{},true)).status,409);
 assert.equal((await req('/admin/orders/'+paidId,'PUT',{status:'CANCELLED'},{},true)).status,200);
 assert.equal(system.db.prepare('SELECT payment_status FROM orders WHERE id=?').get(paidId).payment_status,'PAID');
 system.db.prepare("UPDATE orders SET payment_status='PARTIALLY_REFUNDED',refunded_cents=200 WHERE id=?").run(paidId);
 assert.equal((await req('/admin/orders/'+paidId,'PUT',{status:'READY'},{},true)).status,200);
 const detail=(await req('/admin/orders/'+paidId,'GET',undefined,{},true)).data;assert.equal(detail.paymentStatus,'PARTIALLY_REFUNDED');assert.equal(detail.refundedCents,200);
 system.db.prepare("UPDATE orders SET payment_status='REFUNDED',status='REFUNDED',refunded_cents=1000 WHERE id=?").run(paidId);
 for(const status of ['IN_PRODUCTION','READY','SHIPPED'])assert.equal((await req('/admin/orders/'+paidId,'PUT',{status},{},true)).status,409);
 assert.equal((await req('/admin/orders/'+paidId,'PUT',{trackingNumber:'historical tracking'},{},true)).status,200);
 assert.equal((await req('/admin/orders/'+paidId,'PUT',{status:'ARCHIVED'},{},true)).status,200);
 assert.equal(system.db.prepare('SELECT refunded_cents FROM orders WHERE id=?').get(paidId).refunded_cents,1000);
});

test('bad delivery locations are rejected before checkout or custom request records change',async()=>{
 const pendingBefore=system.db.prepare('SELECT COUNT(*) n FROM pending_checkouts').get().n;
 for(const patch of [{state:'ZZ'},{postalCode:'3956'},{city:''}])assert.equal((await req('/checkout','POST',{customer:{...buyer,...patch},cart:[{id:'hat',catalogObjectId:'hat-v',qty:1}]})).status,400);
 assert.equal(system.db.prepare('SELECT COUNT(*) n FROM pending_checkouts').get().n,pendingBefore);
 const projectsBefore=system.db.prepare('SELECT COUNT(*) n FROM projects').get().n;
 assert.equal((await req('/custom-requests','POST',{...buyer,city:'Test city',state:'MS',postalCode:'bad',products:'Hat request'})).status,400);
 assert.equal((await req('/custom-requests','POST',{...buyer,city:'',state:'MS',postalCode:'39565',products:'Hat request'})).status,400);
 assert.equal(system.db.prepare('SELECT COUNT(*) n FROM projects').get().n,projectsBefore);
});

test('manual sourcing splits stock and on-order items and guards Square adjustments with durable idempotency',async()=>{
 const stock=new Map([['hat-v',8]]),bodies=new Map();let writes=0,reads=0,loseResponse=false;
 global.__BR_SQUARE_TEST__.inventoryApi={async batchRetrieveInventoryCounts(body){reads++;return {result:{counts:body.catalogObjectIds.map(id=>({catalogObjectId:id,locationId:'LOC',state:'IN_STOCK',quantity:String(stock.get(id)||0)}))}};},async batchChangeInventory(body){writes++;if(bodies.has(body.idempotencyKey)){assert.deepEqual(body,bodies.get(body.idempotencyKey));return {result:{counts:[]}};}bodies.set(body.idempotencyKey,structuredClone(body));for(const change of body.changes){assert.equal(change.type,'ADJUSTMENT');assert.equal(change.adjustment.fromState,'IN_STOCK');assert.equal(change.adjustment.toState,'SOLD');assert.equal(change.adjustment.locationId,'LOC');const id=change.adjustment.catalogObjectId;stock.set(id,stock.get(id)-Number(change.adjustment.quantity));}if(loseResponse){loseResponse=false;throw Error('Simulated lost Square response');}return {result:{counts:[]}};}};
 const key=()=>crypto.randomUUID(),payload={targetType:'project',targetId:project,rows:[{mode:'STOCK',variationId:'hat-v',quantity:3,note:'Use blanks on hand'},{mode:'ON_ORDER',variationId:'hat-v',quantity:7,note:'Supplier shipment'}],idempotencyKey:key()};
 assert.equal((await req('/admin/sourcing')).status,401);assert.equal((await req('/admin/sourcing','POST',payload,{Cookie:cookie})).status,403);
 assert.equal((await req('/admin/sourcing','POST',payload,{},true)).status,200);assert.equal(stock.get('hat-v'),5);assert.equal(writes,1);
 assert.equal((await req('/admin/sourcing','POST',payload,{},true)).data.duplicate,true);assert.equal(writes,1);
 let history=(await req('/admin/sourcing','GET',undefined,{},true)).data;const batch=history.batches.find(b=>b.id===payload.idempotencyKey);assert.equal(batch.rows[1].mode,'ON_ORDER');assert.equal(batch.rows[1].quantity,7);assert.equal(batch.status,'APPLIED');assert.equal(history.targets.some(t=>t.type==='project'&&t.id===project),true);
 const shortage={...payload,idempotencyKey:key(),rows:[{mode:'STOCK',variationId:'hat-v',quantity:3},{mode:'STOCK',variationId:'hat-v',quantity:3}]};assert.equal((await req('/admin/sourcing','POST',shortage,{},true)).status,409);assert.equal(writes,1);assert.equal(system.db.prepare('SELECT id FROM production_sourcing WHERE id=?').get(shortage.idempotencyKey),undefined);
 const onOrder={...payload,idempotencyKey:key(),rows:[{mode:'ON_ORDER',description:'Supplier patch sheets',quantity:2}]};assert.equal((await req('/admin/sourcing','POST',onOrder,{},true)).status,200);assert.equal(writes,1);
 assert.equal((await req('/admin/sourcing/'+onOrder.idempotencyKey+'/received/0','POST',{}, {},true)).status,200);assert.equal((await req('/admin/sourcing/'+onOrder.idempotencyKey+'/received/0','POST',{}, {},true)).status,200);assert.equal(writes,1);assert.equal(system.db.prepare('SELECT COUNT(*) n FROM sourcing_receipts WHERE batch_id=?').get(onOrder.idempotencyKey).n,1);
 const uncertain={...payload,idempotencyKey:key(),rows:[{mode:'STOCK',variationId:'hat-v',quantity:2}]};loseResponse=true;assert.equal((await req('/admin/sourcing','POST',uncertain,{},true)).status,502);assert.equal(stock.get('hat-v'),3);assert.equal(system.db.prepare('SELECT status FROM production_sourcing WHERE id=?').get(uncertain.idempotencyKey).status,'SUBMITTING');
 assert.equal((await req('/admin/sourcing','POST',{...onOrder,idempotencyKey:key()}, {},true)).status,409);assert.equal((await req('/admin/sourcing','POST',{...uncertain,rows:[{mode:'STOCK',variationId:'hat-v',quantity:1}]},{},true)).status,409);
 const readsBefore=reads;assert.equal((await req('/admin/sourcing','POST',uncertain,{},true)).status,200);assert.equal(reads,readsBefore);assert.equal(stock.get('hat-v'),3);assert.equal(writes,3);assert.equal(bodies.size,2);
 assert.equal((await req('/admin/sourcing','POST',{...payload,idempotencyKey:key(),targetType:'order',targetId:'999999'}, {},true)).status,400);
 assert.equal((await req('/admin/sourcing','POST',{...payload,idempotencyKey:key(),rows:[{mode:'STOCK',variationId:'hat-v',quantity:0}]},{},true)).status,400);
});

test('retired test mail is excluded from delivery history and cannot be requeued',async()=>{
 const id=Number(system.db.prepare("INSERT INTO mail_queue(dedupe_key,recipient,subject,message,status,created_at) VALUES('retired-fixture','test@example.test','Retired fixture','Fixture','RETIRED',?)").run(new Date().toISOString()).lastInsertRowid);
 assert.equal((await req('/admin/mail-queue','GET',undefined,{},true)).data.some(r=>r.id===id),false);assert.equal((await req('/admin/mail-queue/'+id+'/retry','POST',{}, {},true)).status,409);assert.equal(system.db.prepare('SELECT status FROM mail_queue WHERE id=?').get(id).status,'RETIRED');
});

test('attention summary is admin-only and contains counts without customer records',async()=>{assert.equal((await req('/admin/attention')).status,401);const r=await req('/admin/attention','GET',undefined,{},true);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert(r.data.updatedAt);assert(Number.isSafeInteger(r.data.sections.orders.count));assert(Object.values(r.data.sections).every(v=>Number.isSafeInteger(v.count)&&v.count>=0&&typeof v.label==='string'));assert(!JSON.stringify(r.data).includes(buyer.email));});

test('stale calculator/editor revision cannot overwrite a changed quote',async()=>{const id='calculator-stale-fixture',quote=JSON.stringify({revision:2,items:[{id:'line',name:'Untouched',quantity:2,unitPriceCents:1800}]});system.db.prepare("INSERT INTO projects(id,token_hash,customer_json,request_json,status,revision,quote_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(id,'calculator-fixture-token','{}','{}','DRAFT',2,quote,new Date().toISOString(),new Date().toISOString());try{const response=await req('/admin/projects/'+id+'/quote','PUT',{expectedRevision:1,items:[{id:'line',name:'Stale calculator',quantity:2,unitPriceCents:100}]},{},true);assert.equal(response.status,409);assert.equal(system.db.prepare('SELECT quote_json FROM projects WHERE id=?').get(id).quote_json,quote);}finally{system.db.prepare('DELETE FROM projects WHERE id=?').run(id);}});
