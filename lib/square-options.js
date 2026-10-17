'use strict';
// Square Dashboard can return saved hex values with or without a leading #.
function normalizeColorHex(value){const raw=String(value??'').trim();return /^#?[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(raw)?'#'+raw.replace(/^#/,''):null;}
// Square item option IDs, rather than comma-separated variation names, are authoritative.
function optionIndex(objects){
 const options=new Map(),values=new Map();
 for(const o of objects){if(o.type!=='ITEM_OPTION')continue;const d=o.itemOptionData||{};options.set(o.id,{name:d.displayName||d.name||'Option',key:d.name||d.displayName||'Option'});for(const v of d.values||[])values.set(v.id,v.itemOptionValueData||{});}
 for(const o of objects)if(o.type==='ITEM_OPTION_VAL')values.set(o.id,o.itemOptionValueData||{});
 return {options,values};
}
function variationOptions(data,index){
 const options={},optionColors={};let colorHex=null;
 for(const ref of data.itemOptionValues||[]){const option=index.options.get(ref.itemOptionId),value=index.values.get(ref.itemOptionValueId);if(!option||!value?.name)continue;const label=option.name;options[label]=value.name;const hex=normalizeColorHex(value.color);if(hex){optionColors[label]=hex;if(/colou?r/i.test(option.key+' '+label))colorHex=hex;}}
 const field=pattern=>Object.entries(options).find(([k])=>pattern.test(k))?.[1]||null;
 return {options,optionColors,colorHex,color:field(/colou?r/i),size:field(/size/i),sleeve:field(/sleeve/i),garmentType:field(/^type$|garment.?type/i),printLocation:field(/^design$|print.?location/i)};
}
module.exports={optionIndex,variationOptions,normalizeColorHex};
