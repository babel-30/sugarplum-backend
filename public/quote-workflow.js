/* Requested selections are snapshots: never replace them with today's catalog defaults. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BrackishQuoteWorkflow=api;})(typeof window==='object'?window:this,function(){
 'use strict';
 function details(row){return [...new Set([row.type,row.garmentType,row.sleeve&&'Sleeve: '+row.sleeve,...Object.entries(row.options||{}).map(([key,value])=>key+': '+value),row.notes&&'Customer notes: '+row.notes].filter(Boolean))].join(' · ');}
 function seed(request){return (request?.requestedProducts||[]).map(row=>({name:row.style||row.type||'Requested product',category:/hat/i.test(row.type)?'Hats':/patch/i.test(row.type)?'Patches':/3d/i.test(row.type)?'3D':row.help?'Other':'Apparel',quantity:row.quantity,colors:row.color?[row.color]:[],sizes:row.size?[row.size]:[],description:details(row),sourceProductId:row.productId||''}));}
 function initialItems(project){return project.quote?.items|| (seed(project.request).length?seed(project.request):[{}]);}
 return {details,seed,initialItems};
});
