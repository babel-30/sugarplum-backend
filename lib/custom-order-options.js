'use strict';
const H=require('./helpers');
function productType(product,variation){
 if(/hat/i.test(product.category||''))return 'Hats';
 if(variation.garmentType)return String(variation.garmentType);
 if(/apparel|shirt|hoodie/i.test(product.category||''))return 'Apparel';
 if(product.category==='3D')return '3D Prints';
 return String(product.category||'Other');
}
function catalog(products,state){
 return products.map(p=>{
  const rule=state?.rules?.[p.id];
  const enabled=rule?.enabled??(!state&&['Hat Blanks','Blank Apparel'].includes(p.category)&&p.builderEligible===true&&!p.privateOnly&&!p.flags?.hideOnline);
  const variations=(p.variations||p.squareVariations||[]).map(v=>({id:v.id,type:productType(p,v),name:v.name||'Default',color:v.color||'',colorHex:v.colorHex||null,optionColors:v.optionColors||{},size:v.size||(/hat/i.test(p.category||'')?'One size':''),garmentType:v.garmentType||'',sleeve:v.sleeve||'',options:v.options||{},enabled:!(rule?.disabledVariationIds||[]).includes(v.id),inStock:Number(v.quantity)>0}));
  return {id:p.id,name:p.name,category:p.category||'Other',enabled,variations};
 });
}
module.exports=function mount(app,c){
 const previous=c.db.prepare('SELECT value_json FROM business_settings WHERE key=?').get('custom-order-options');
 let state=previous?JSON.parse(previous.value_json):null;
 const current=()=>catalog(c.products(),state);
 const offered=()=>current().filter(p=>p.enabled).map(p=>({...p,variations:p.variations.filter(v=>v.enabled)})).filter(p=>p.variations.length);
 const publicCatalog=()=>({products:offered().map(p=>({id:p.id,name:p.name,variations:p.variations.map(({enabled,inStock,...v})=>v)})),allowHelp:state?.allowHelp===true});
 app.get('/custom-order-options',c.route(async(req,res)=>{await c.refresh();res.set('Cache-Control','no-store');res.json(publicCatalog());}));
 app.get('/admin/custom-order-options',c.auth,c.route(async(req,res)=>{await c.refresh(req.query.refresh==='true');res.set('Cache-Control','no-store');res.json({products:current(),allowHelp:state?.allowHelp===true,updatedAt:state?.updatedAt||null});}));
 app.put('/admin/custom-order-options',c.auth,c.route((req,res)=>{
  if(!Array.isArray(req.body.products)||req.body.products.length>5000)H.fail('Choose the products to offer for custom requests');
  // Materialize current defaults once; newly discovered products thereafter require opt-in.
  const rules={...Object.fromEntries(current().map(p=>[p.id,{enabled:p.enabled,disabledVariationIds:p.variations.filter(v=>!v.enabled).map(v=>v.id)}])),...state?.rules};
  for(const rule of req.body.products){const p=current().find(p=>p.id===rule.id);if(!p)H.fail('Refresh Square and choose an existing product',409);
   if(typeof rule.enabled!=='boolean'||!Array.isArray(rule.disabledVariationIds)||rule.disabledVariationIds.some(id=>!p.variations.some(v=>v.id===id)))H.fail('Choose valid Square product options');
   rules[p.id]={enabled:rule.enabled,disabledVariationIds:[...new Set(rule.disabledVariationIds)]};
  }
  const next={rules,allowHelp:req.body.allowHelp===undefined?state?.allowHelp===true:req.body.allowHelp===true,updatedAt:H.now()};
  c.db.prepare('INSERT OR REPLACE INTO business_settings VALUES(?,?)').run('custom-order-options',JSON.stringify(next));state=next;
  res.json({products:current(),allowHelp:state.allowHelp,updatedAt:state.updatedAt});
 }));
 function selections(input){
  if(input===undefined)return null; // Existing requests/clients keep their free-form format.
  let rows;try{rows=typeof input==='string'?JSON.parse(input):input;}catch{H.fail('Check your requested products');}
  if(!Array.isArray(rows)||!rows.length||rows.length>30)H.fail('Add between 1 and 30 requested products');
  return rows.map(r=>{
   const quantity=H.integer(r.quantity,1,10000,'requested quantity'),notes=H.text(r.notes,500);
   if(r.help===true){if(state?.allowHelp!==true)H.fail('Choose a listed product',409);if(!notes)H.fail('Describe the product you need help choosing');return {help:true,type:'Help me choose',quantity,notes};}
   const p=offered().find(p=>p.id===r.productId),v=p?.variations.find(v=>v.id===r.variationId&&v.type===r.type);
   if(!v)H.fail('A requested option changed. Refresh the page and choose the product again.',409);
   return {productId:p.id,variationId:v.id,type:v.type,style:p.name,color:v.color,size:v.size,garmentType:v.garmentType,sleeve:v.sleeve,options:v.options,quantity,notes};
  });
 }
 function describe(rows){return rows.map(r=>r.help?`${r.quantity} × Help me choose: ${r.notes}`:`${r.quantity} × ${r.type}: ${r.style}; ${[r.color&&'Color: '+r.color,r.size&&'Size: '+r.size,r.sleeve&&'Sleeve: '+r.sleeve].filter(Boolean).join('; ')}${r.notes?'; '+r.notes:''}`).join('\n');}
 return {selections,describe};
};
module.exports.catalog=catalog;
module.exports.productType=productType;
