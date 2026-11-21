'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/storefront/script.js'),'utf8');
const context={normalizePrintSide:v=>v||'',inferPrintLocationFromName:()=>''};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function kioskSelectionPhotos('),source.indexOf('function renderKiosk()')),context);
const product={image:'generic',squareVariations:[
 {color:'Black',size:'Small',printLocation:'Front',images:['black-front','black-detail']},
 {color:'Azalea',size:'Small',printLocation:'Front',image:'pink-front'},
 {color:'Azalea',size:'Large',printLocation:'Back',images:['pink-back','pink-pocket']}
]};
test('kiosk photos follow color, size and print; gallery retains selected variant photos',()=>{
 const photos=(...args)=>Array.from(context.kioskSelectionPhotos(product,...args));
 assert.deepEqual(photos('Black','Small','Front'),['black-front','black-detail']);
 assert.deepEqual(photos('Azalea','Small','Front'),['pink-front']);
 assert.deepEqual(photos('Azalea','Large','Back'),['pink-back','pink-pocket']);
 assert.deepEqual(photos('White','Small','Front'),['generic']);
});
