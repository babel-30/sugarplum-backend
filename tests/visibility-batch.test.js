const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('visibility scan deduplicates designs, preserves unrelated flags and applies to selections outside the filter',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../public/admin.js'),'utf8');
 const handlers={},elements={};
 for(const id of ['flags-scan','flags-select-visible','flags-clear-selection','flags-batch-apply','flags-batch-action','flags-selected-count'])elements[id]={addEventListener:(event,fn)=>handlers[id+event]=fn};
 elements['flags-batch-action'].value='hideOnline:true';
 const products=[{id:'a',name:'Holiday',barcodes:['ABC','XYZ'],flags:{pinToTop:true,ribbonType:'custom'}},{id:'b',name:'Other',barcodes:['DEF'],flags:{hideKiosk:true}}];
 const context={Set,document:{getElementById:id=>elements[id]},adminProducts:products,flagsTbody:{addEventListener(){},querySelectorAll:()=>[]},captureProductFlagEdits(){},applyFlagsFiltersAndRender(){},showStatus(){},flagsStatusEl:{}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  const selectedFlagProducts ='),source.indexOf('  function renderProductsTable(products)')),context);
 const input={value:'abc'};handlers['flags-scankeydown']({key:'Enter',preventDefault(){},target:input});input.value='XYZ';handlers['flags-scankeydown']({key:'Enter',preventDefault(){},target:input});
 assert.equal(elements['flags-selected-count'].textContent,'1 designs selected');
 handlers['flags-batch-applyclick']();assert.equal(products[0].flags.hideOnline,true);assert.equal(products[0].flags.pinToTop,true);assert.equal(products[0].flags.ribbonType,'custom');assert.equal(products[1].flags.hideOnline,undefined);
 elements['flags-batch-action'].value='hideOnline:false';handlers['flags-batch-applyclick']();assert.equal(products[0].flags.hideOnline,false);
 input.value='unknown';handlers['flags-scankeydown']({key:'Enter',preventDefault(){},target:input});assert.equal(elements['flags-selected-count'].textContent,'1 designs selected');
});
