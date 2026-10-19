'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');

// Resolve only the saved order's project and exact approved item association.
// Private artwork never needs a public URL or a customer access token for printing.
module.exports=async function projectPackingImage(db,item,shipping){
 if(!['quote','private-shop'].includes(shipping?.channel)||!shipping.projectId)return null;
 try{
  let mockupId=item.mockupId;
  if(shipping.channel==='private-shop'&&item.shopId){
   const shop=db.prepare('SELECT project_id,items_json FROM private_shops WHERE id=?').get(item.shopId);
   if(!shop||shop.project_id!==shipping.projectId)return null;
   // Old paid group orders did not retain mockupId; use their immutable shop snapshot.
   const entry=JSON.parse(shop.items_json).find(entry=>entry.id===item.id);
   if(!entry)return null;
   mockupId=entry.mockupId;
  }
  if(!mockupId)return null;
  const file=db.prepare("SELECT filename FROM project_files WHERE id=? AND project_id=? AND kind='mockup'").get(mockupId,shipping.projectId);
  if(!file)return null;
  const root=await fs.realpath(path.join(db.dataDir,'private-uploads'));
  const target=await fs.realpath(path.resolve(root,file.filename));
  if(!target.startsWith(root+path.sep)||(await fs.stat(target)).size>20*1024*1024)return null;
  return await sharp(await fs.readFile(target),{limitInputPixels:40000000}).rotate().resize({width:700,height:700,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 }catch{return null;}
};
