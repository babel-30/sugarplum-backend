'use strict';

function summarize(db,products,patches){
 const count=(sql)=>Number(db.prepare(sql).get().n);
 const variants=new Set();for(const product of products){if(product.fulfillmentMode==='made-to-order')continue;for(const v of product.variations||[]){if(v.id&&v.inventoryTracked===true&&v.quantity!=null&&v.quantity!==''&&Number.isFinite(Number(v.quantity))&&Number(v.quantity)<=0)variants.add(v.id);}}
 const materials=new Set();for(const patch of patches){if(patch.active===false)continue;for(const v of patch.variants||[])if(v.stockStatus==='out-of-stock')materials.add(v.materialId||patch.id+':'+v.id);}
 return {
  orders:{count:count("SELECT COUNT(*) n FROM orders WHERE status IN ('PENDING','PAID','AWAITING_PROOF','IN_PRODUCTION','READY') AND COALESCE(payment_status,'')!='REFUNDED'"),label:'Orders awaiting fulfillment, proof work, or payment verification'},
  projects:{count:count("SELECT COUNT(*) n FROM projects WHERE status IN ('REQUESTED','DESIGNING','DRAFT','CHANGES_REQUESTED')"),label:'Custom requests or quotes needing preparation or customer-requested changes'},
  inventory:{count:variants.size,label:'Square-tracked variations out of stock (each size/color counts once; made-to-order products excluded)'},
  patches:{count:materials.size,label:'Out-of-stock patch materials used by active designs (shared materials count once)'},
  'paid-proofs':{count:count("SELECT COUNT(*) n FROM paid_proofs p JOIN orders o ON o.id=p.order_id WHERE p.status IN ('DRAFT','CHANGES_REQUESTED') AND o.status NOT IN ('SHIPPED','ARCHIVED','CANCELLED','REFUNDED') AND COALESCE(o.payment_status,'')!='REFUNDED'"),label:'Paid item proofs needing preparation or changes; proofs awaiting customer approval excluded'},
  sourcing:{count:count("SELECT COUNT(*) n FROM production_sourcing WHERE status='SUBMITTING'"),label:'Stock submissions awaiting Square confirmation; retry the original saved submission'},
  mail:{count:count("SELECT COUNT(*) n FROM mail_queue WHERE status='FAILED' OR (status='PENDING' AND attempts>0)"),label:'Failed emails or pending emails with a failed delivery attempt; retired and held unattempted messages excluded'}
 };
}
module.exports=function mount(app,{db,auth,route,products,patches}){
 app.get('/admin/attention',auth,route((req,res)=>{res.set('Cache-Control','private, no-store');res.json({updatedAt:new Date().toISOString(),sections:summarize(db,products(),patches())});}));
};
module.exports.summarize=summarize;
