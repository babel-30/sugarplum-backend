'use strict';
const crypto=require('crypto'),H=require('./helpers'),{patchOptions}=require('./patch-options');
module.exports=(app,c)=>{
 c.db.exec(`CREATE TABLE IF NOT EXISTS restock_subscriptions(id INTEGER PRIMARY KEY,source TEXT NOT NULL,item_id TEXT NOT NULL,variant_id TEXT NOT NULL,email TEXT NOT NULL,token TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'WAITING',UNIQUE(source,item_id,variant_id,email));`);
 function item(source,id,variantId){
  if(source==='patch'){const p=c.patches().find(p=>p.id===id&&p.active!==false),v=p&&patchOptions(p).find(v=>v.id===variantId);return v?{label:p.name+' — '+v.name+(v.material?' / '+v.material:''),available:v.stockStatus!=='out-of-stock',link:'/hats.html?mode=build'}:null;}
  if(source==='apparel'){const d=c.designs?.().find(d=>d.id===id&&d.active);return d&&variantId==='default'?{label:d.name,available:d.stockStatus!=='out-of-stock',link:'/apparel.html?mode=build'}:null;}
  if(source==='square'){const p=c.products().find(p=>p.id===id&&!p.privateOnly&&!c.flags(p.id).hideOnline),v=p?.variations?.find(v=>v.id===variantId);return v?{label:p.name+' — '+[v.color||v.name,v.size].filter(Boolean).join(' / '),available:p.fulfillmentMode==='made-to-order'||Number(v.quantity)>0,link:p.category==='Blank Apparel'?'/apparel.html?mode=build&garment='+encodeURIComponent(p.id):p.category==='Hat Blanks'?'/hats.html?mode=build&hat='+encodeURIComponent(p.id):'/product.html?id='+encodeURIComponent(p.id)}:null;}
  return null;
 }
 function check(){const now=new Date().toISOString();c.db.prepare("UPDATE restock_subscriptions SET status='EXPIRED' WHERE status='WAITING' AND created_at<?").run(new Date(Date.now()-90*86400000).toISOString());const waiting=c.db.prepare("SELECT * FROM restock_subscriptions WHERE status='WAITING'").all();
  for(const row of waiting){const product=item(row.source,row.item_id,row.variant_id);if(!product?.available)continue;c.db.transaction(()=>{c.queue('restock:'+row.token,row.email,c.settings().businessName+' — Back in stock',`${product.label} is available again.\n\nShop: ${c.settings().siteUrl+product.link}\nAvailability can change; this notification does not reserve stock.\n\nStop this alert: ${c.settings().siteUrl}/stock-alert.html#${row.token}`);c.db.prepare("UPDATE restock_subscriptions SET status='NOTIFIED' WHERE id=? AND status='WAITING'").run(row.id);})();}
 }
 const attempts=new Map();
 app.post('/stock-alerts',c.route(async(req,res)=>{const key=req.ip,n=(attempts.get(key)||{count:0,until:0});if(n.until<Date.now()){n.count=0;n.until=Date.now()+3600000;}n.count++;attempts.set(key,n);if(attempts.size>10000)for(const [k,v]of attempts)if(v.until<Date.now())attempts.delete(k);if(n.count>20)H.fail('Too many requests. Please try again later',429);
  const b=req.body||{};if(b.consent!==true)H.fail('Confirm you want this stock notification');const email=H.safeEmail(b.email).toLowerCase();await c.refresh();const product=item(b.source,b.itemId,b.variantId);if(!product)H.fail('This option is unavailable',404);if(product.available)H.fail('This option is already in stock. Refresh the page',409);
  c.db.prepare(`INSERT INTO restock_subscriptions(source,item_id,variant_id,email,token,created_at,status) VALUES(?,?,?,?,?,?,'WAITING') ON CONFLICT(source,item_id,variant_id,email) DO UPDATE SET token=excluded.token,created_at=excluded.created_at,status='WAITING'`).run(b.source,b.itemId,b.variantId,email,crypto.randomBytes(24).toString('hex'),new Date().toISOString());res.json({ok:true,message:'We’ll email you once when this exact option is back in stock.'});
 }));
 app.post('/stock-alerts/unsubscribe',c.route((req,res)=>{const token=H.text(req.body?.token,100);c.db.prepare("UPDATE restock_subscriptions SET status='CANCELLED' WHERE token=?").run(token);res.json({ok:true});}));
 app.get('/admin/stock-alerts',c.requireAdmin,(req,res)=>res.json(c.db.prepare('SELECT source,item_id,variant_id,status,COUNT(*) AS count FROM restock_subscriptions GROUP BY source,item_id,variant_id,status').all().map(row=>({...row,name:item(row.source,row.item_id,row.variant_id)?.label||'Removed option'}))));
 return {check};
};
