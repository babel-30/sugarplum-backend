'use strict';
const crypto=require('crypto'),{patchOptions}=require('./patch-options');
const statuses=['in-stock','low-stock','out-of-stock'];
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const key=(name,type)=>[name,type].map(v=>String(v||'').toLowerCase().replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ').trim()).join('|');
function migrateMaterials(config){
 const materials=(config.materials||[]).map(m=>({...m}));const existing=new Map(materials.map(m=>[key(m.name,m.type),m]));
 const patches=(config.patches||[]).map(p=>({...p,variants:patchOptions(p).map(v=>{
  if(v.materialId){if(!materials.some(m=>m.id===v.materialId))fail('Choose an existing patch material.');return {...v};}
  const name=v.name||'Default',type=v.material||'';const k=key(name,type);let m=existing.get(k);
  if(!m){m={id:crypto.randomUUID(),name,type,stockStatus:v.stockStatus||'in-stock'};materials.push(m);existing.set(k,m);}
  else if(!config.materials?.some(old=>old.id===m.id)&&statuses.indexOf(v.stockStatus)>statuses.indexOf(m.stockStatus))m.stockStatus=v.stockStatus;
  return {...v,materialId:m.id};
 })}));
 return {...config,materials,patches};
}
function resolveOptions(p,materials){return (p.variants||[]).map(v=>{const m=materials.find(m=>m.id===v.materialId);return m?{...v,name:m.name,material:m.type,stockStatus:m.stockStatus}:v;});}
function cleanMaterial(value,id){const name=String(value.name||'').trim().slice(0,100),type=String(value.type||'').trim().slice(0,100);if(!name)fail('Enter a material color name.');if(!statuses.includes(value.stockStatus))fail('Choose a valid material stock status.');return {id:id||crypto.randomUUID(),name,type,stockStatus:value.stockStatus};}
function install(app,c){
 const list=()=>c.get().materials.map(m=>({...m,assignedOptions:c.get().patches.reduce((n,p)=>n+(p.variants||[]).filter(v=>v.materialId===m.id).length,0)}));
 const route=fn=>(req,res)=>{try{fn(req,res);}catch(e){res.status(e.status||500).json({error:e.message});}};
 app.get('/admin/patch-materials',c.auth,route((req,res)=>res.json({materials:list()})));
 app.post('/admin/patch-materials',c.auth,route((req,res)=>{const cfg=c.get(),m=cleanMaterial(req.body);if(cfg.materials.some(old=>key(old.name,old.type)===key(m.name,m.type)))fail('This color and material type already exist.');c.commit({...cfg,materials:[...cfg.materials,m]});res.status(201).json({material:m,materials:list()});}));
 app.put('/admin/patch-materials/:id',c.auth,route((req,res)=>{const cfg=c.get();if(!cfg.materials.some(m=>m.id===req.params.id))fail('Material not found.',404);const m=cleanMaterial(req.body,req.params.id);if(cfg.materials.some(old=>old.id!==m.id&&key(old.name,old.type)===key(m.name,m.type)))fail('This color and material type already exist.');c.commit({...cfg,materials:cfg.materials.map(old=>old.id===m.id?m:old)});c.restock();res.json({material:m,materials:list()});}));
 app.delete('/admin/patch-materials/:id',c.auth,route((req,res)=>{const cfg=c.get(),id=req.params.id,replacement=req.body?.replacementId;if(!cfg.materials.some(m=>m.id===id))fail('Material not found.',404);const used=list().find(m=>m.id===id).assignedOptions;if(used&&(!replacement||replacement===id||!cfg.materials.some(m=>m.id===replacement)))fail(`This material is assigned to ${used} patch options. Choose a replacement material before deleting it.`,409);c.commit({...cfg,materials:cfg.materials.filter(m=>m.id!==id),patches:cfg.patches.map(p=>({...p,variants:p.variants?.map(v=>v.materialId===id?{...v,materialId:replacement}:v)}))});c.restock();res.json({ok:true,reassigned:used,materials:list()});}));
}
module.exports={migrateMaterials,resolveOptions,cleanMaterial,install};
