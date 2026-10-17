'use strict';
const {optionalCents}=require('./patch-pricing');
function patchOptions(p) {
 if(!Array.isArray(p.variants)||!p.variants.length)return [{id:'default',name:'Default',material:'',imageUrl:p.imageUrl,stockStatus:'in-stock',customerPriceCents:null,attachmentFeeCents:null}];
 return p.variants;
}
function cleanPatchOptions(value,p) {
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||!value.length||value.length>50)throw Object.assign(new Error('Each patch needs 1 to 50 color/material options.'),{status:400});
 const seen=new Set();
 return value.map(v=>{const id=String(v.id||'').trim(),name=String(v.name||'').trim().slice(0,100),material=String(v.material||'').trim().slice(0,100),imageUrl=String(v.imageUrl||p.imageUrl||'').trim();
 if(!id||seen.has(id)||!name)throw Object.assign(new Error('Every patch option needs a unique ID and a color name.'),{status:400});seen.add(id);
 if(!v.materialId&&!['in-stock','low-stock','out-of-stock'].includes(v.stockStatus))throw Object.assign(new Error('Choose a valid patch option stock status.'),{status:400});
 if(!(imageUrl.startsWith('/')&&!imageUrl.startsWith('//')&&!imageUrl.includes('..'))&&!/^https?:\/\//i.test(imageUrl))throw Object.assign(new Error('Upload a photo or use a valid image URL for each color.'),{status:400});
 return {id,name,material,...(v.materialId?{materialId:String(v.materialId)}:{}),imageUrl,stockStatus:v.stockStatus||'in-stock',customerPriceCents:optionalCents(v.customerPriceCents,'Color patch price'),attachmentFeeCents:optionalCents(v.attachmentFeeCents,'Color attachment charge')};
 });
}
module.exports={patchOptions,cleanPatchOptions};
