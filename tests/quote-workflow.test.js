'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const workflow=require('../public/quote-workflow');
const H=require('../lib/helpers');
test('request-to-quote seed retains distinct hat and shirt combinations without inventing prices',()=>{
 const request={requestedProducts:[{productId:'hat',type:'Hats',style:'Richardson 112',color:'Black / White',size:'One size',quantity:6,notes:'Left patch',options:{Color:'Black / White',Size:'One size'}},{productId:'tee',type:'T-Shirt',style:'Bella Canvas',color:'Red',size:'M',sleeve:'SS',quantity:12,options:{Type:'T-Shirt',Sleeve:'SS',Color:'Red',Size:'M',Finish:'Soft'}},{productId:'tee',type:'T-Shirt',style:'Bella Canvas',color:'Red',size:'XL',quantity:2}]};
 const rows=workflow.initialItems({request});assert.equal(rows.length,3);assert.equal(rows[0].category,'Hats');assert.equal(rows[1].category,'Apparel');assert.equal(rows[0].quantity,6);assert.equal(rows[1].quantity,12);assert.equal(rows[2].quantity,2);assert.deepEqual(rows.map(r=>r.sizes),[['One size'],['M'],['XL']]);assert.deepEqual(rows[0].colors,['Black / White']);assert.match(rows[0].description,/Left patch/);assert.match(rows[1].description,/Finish: Soft/);assert.match(rows[1].description,/Sleeve: SS/);assert(rows.every(r=>r.unitPriceCents===undefined));assert.equal(rows[1].sourceProductId,'tee');
 const existing=[{name:'Already approved',unitPriceCents:1800,quantity:18}];assert.equal(workflow.initialItems({request,quote:{items:existing}}),existing);assert.deepEqual(workflow.initialItems({request:{products:'Legacy request'}}),[{}]);
});
test('shipping validates US delivery fields and preserves ZIP+4 and leading zeros',()=>{
 for(const state of ['MS','DC','PR','AP'])assert.doesNotThrow(()=>H.validateShippingAddress({address1:'1 Test Street',city:'Test city',state,postalCode:'00501-1234'}));
 for(const patch of [{state:'ZZ'},{state:'Mississippi'},{postalCode:'123'},{postalCode:'123456'},{city:''},{address1:''}])assert.throws(()=>H.validateShippingAddress({address1:'1 Test Street',city:'Test city',state:'MS',postalCode:'39565',...patch}),{status:400});
 assert.doesNotThrow(()=>H.validateShippingLocation({city:'Test city',state:'ms',postalCode:'00501'}));
});

test('group-shop swatches require a reliable Square product and one configured color code',()=>{
 const {quoteColors}=require('../lib/quote-colors');
 const catalog=[{id:'tee',category:'Blank Apparel',variations:[{color:'Red',colorHex:'ff0000',quantity:0},{color:'Red',colorHex:'#ff0000'},{color:'Mystery',colorHex:null},{color:'Ambiguous',colorHex:'111111'},{color:'Ambiguous',colorHex:'222222'}]}];
 const item={name:'Custom shirt',sourceProductId:'tee',category:'Apparel',colors:['Red','Mystery','Ambiguous','Black / White']};
 assert.deepEqual(quoteColors(item,{},catalog),{Red:'#ff0000'});assert.deepEqual(quoteColors({...item,category:'Hats'},{},catalog),{});assert.deepEqual(quoteColors({...item,sourceProductId:''},{},catalog),{});
 const legacy={requestedProducts:[{style:'Custom shirt',productId:'tee'}]};assert.deepEqual(quoteColors({...item,sourceProductId:''},legacy,catalog),{Red:'#ff0000'});
 assert.deepEqual(quoteColors({...item,sourceProductId:''},{requestedProducts:[...legacy.requestedProducts,{style:'Custom shirt',productId:'other'}]},catalog),{});
 const sanitized=H.quoteItems([{...item,quantity:1,unitPriceCents:1800}])[0];assert.equal(sanitized.sourceProductId,'tee');assert.equal(sanitized.unitPriceCents,1800);
});


test('size order is human-readable and stocked hats initially choose an available color',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');const context={window:{},URL,document:{currentScript:{src:'https://example.test/variation-options.js'},head:{append(){}},createElement(){return {};}}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/storefront/variation-options.js'),'utf8'),context);
 const ui=context.window.BrackishVariations;assert.deepEqual(['2XL','L','XS','XL','M','S','3XL'].sort(ui.compareSizes),['XS','S','M','L','XL','2XL','3XL']);assert.deepEqual(['12','2','10'].sort(ui.compareSizes),['2','10','12']);
 const colors=['Sold out','Available'],hat={collection:'Hats',squareVariations:[{color:'Sold out',quantity:0},{color:'Available',quantity:3}]};assert.equal(ui.defaultColor(hat,colors),'Available');assert.equal(ui.defaultColor({...hat,fulfillmentMode:'made-to-order'},colors),'Sold out');assert.equal(ui.defaultColor({...hat,collection:'Blank Apparel'},colors),'Sold out');assert.deepEqual(colors,['Sold out','Available']);assert.equal(ui.defaultColor({collection:'Hats',variations:[]},[]),'');
});
