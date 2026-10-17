'use strict';
const hex=value=>{const raw=String(value||'').trim().replace(/^#/,'');return /^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(raw)?'#'+raw.toLowerCase():null;};
// Only an explicit product ID, or one unambiguous original request snapshot, can supply a color.
function quoteColors(item,request,products){
 if(item.category!=='Apparel')return {};
 const candidates=(request?.requestedProducts||[]).filter(r=>r.style===item.name&&r.productId);
 const ids=[...new Set(candidates.map(r=>r.productId))];
 const productId=item.sourceProductId||(ids.length===1?ids[0]:null);
 const product=products.find(p=>p.id===productId);if(!product||!['Blank Apparel','Apparel'].includes(product.category))return {};
 return Object.fromEntries((item.colors||[]).flatMap(color=>{const matching=(product.variations||[]).filter(v=>v.color===color),codes=[...new Set(matching.map(v=>hex(v.colorHex)).filter(Boolean))];return codes.length===1?[[color,codes[0]]]:[];}));
}
module.exports={quoteColors};
