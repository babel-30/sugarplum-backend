'use strict';
function normalizeCategoryName(raw) {
 const n=String(raw||'').toLowerCase().trim();if(!n)return null;
 if (/\bblank[\s_-]*apparel\b|\bapparel[\s_-]*blanks?\b/.test(n))return 'Blank Apparel';
 if (/\bhat[\s_-]*blanks?\b|\bblank[\s_-]*hats?\b/.test(n))return 'Hat Blanks';
 if(n.includes('apparel')||n.includes('shirt')||n.includes('clothing'))return 'Apparel';
 if(n.includes('patch'))return 'Patches';
 if(n.includes('hat')||n.includes('caps')||n.includes('beanie'))return 'Hats';
 if(n.includes('3d')||n.includes('3-d')||n.includes('prints')||n.includes('print'))return '3D';
 return raw;
}
function resolveItemCategory(item,names) {
 const data=item?.itemData||{};
 const ids=[...new Set([data.reportingCategory?.id,...(Array.isArray(data.categories)?data.categories.map(c=>c?.id):[]),data.categoryId].filter(Boolean))];
 // Blanks stay exclusive to the builder even if also assigned to a general Hats category.
 const selected=ids.find(id=>normalizeCategoryName(names[id])==='Hat Blanks'||normalizeCategoryName(names[id])==='Blank Apparel')||ids.find(id=>names[id])||null;
 const raw=selected?names[selected]||null:null;
 return {categoryId:selected,categoryIds:ids,categoryRaw:raw,category:normalizeCategoryName(raw)};
}
module.exports={normalizeCategoryName,resolveItemCategory};
