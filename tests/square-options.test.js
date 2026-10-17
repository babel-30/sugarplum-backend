'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{optionIndex,variationOptions}=require('../lib/square-options');
test('Square named options override positional names, preserve every dimension and validate hex colors',()=>{
 const defs=[['color','Color','Antique Heliconia','#af0068'],['type','Type','T-Shirt'],['sleeve','Sleeve','LS'],['size','Size','2X'],['design','Design','Front & Back']].map(([id,name,value,color])=>({id,type:'ITEM_OPTION',itemOptionData:{name,values:[{id:id+'-value',itemOptionValueData:{name:value,color}}]}}));
 const result=variationOptions({name:'Unreliable variation label',itemOptionValues:defs.map(d=>({itemOptionId:d.id,itemOptionValueId:d.id+'-value'}))},optionIndex(defs));
 assert.deepEqual(result.options,{Color:'Antique Heliconia',Type:'T-Shirt',Sleeve:'LS',Size:'2X',Design:'Front & Back'});assert.equal(result.colorHex,'#af0068');assert.equal(result.sleeve,'LS');assert.equal(result.size,'2X');assert.equal(result.printLocation,'Front & Back');
 defs[0].itemOptionData.values[0].itemOptionValueData.color='red;position:fixed';assert.equal(variationOptions({itemOptionValues:[{itemOptionId:'color',itemOptionValueId:'color-value'}]},optionIndex(defs)).colorHex,null);
});

test('Square Dashboard hex codes without a hash normalize without inventing missing colors',()=>{
 const {normalizeColorHex}=require('../lib/square-options');
 for(const [input,expected] of [['ff0000','#ff0000'],['DD74A1','#DD74A1'],['AA0061','#AA0061'],['#af0068','#af0068'],['ff000080','#ff000080'],['#ff000080','#ff000080'],[undefined,null],[null,null],['',null],['red',null],['fff',null],['red;position:fixed',null]])assert.equal(normalizeColorHex(input),expected);
 const index=optionIndex([{type:'ITEM_OPTION',id:'color',itemOptionData:{name:'Color',showColors:true,values:[{id:'azalea',itemOptionValueData:{name:'Azalea',color:'DD74A1'}},{id:'empty',itemOptionValueData:{name:'Unconfigured'}}]}}]);
 const parsed=variationOptions({itemOptionValues:[{itemOptionId:'color',itemOptionValueId:'azalea'}]},index);assert.equal(parsed.colorHex,'#DD74A1');assert.deepEqual(parsed.optionColors,{Color:'#DD74A1'});
 const missing=variationOptions({itemOptionValues:[{itemOptionId:'color',itemOptionValueId:'empty'}]},index);assert.equal(missing.colorHex,null);assert.deepEqual(missing.optionColors,{});
});
