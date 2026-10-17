const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function load(){
 const context={window:{},document:{addEventListener(){}},URL,Intl};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/storefront/apparel-builder.js'),'utf8'),context);
 return context.window;
}
test('personalized apparel still requires text review without a separate proof',()=>{
 const w=load();
 assert(w.brApparelNeedsTextReview({requiresProof:false,requiresPersonalizationReview:true,selections:[]}));
 assert(w.brApparelNeedsTextReview({requiresProof:false,selections:[{customizable:true}]}));
 assert(w.brApparelNeedsTextReview({requiresProof:true,selections:[]}));
 assert(!w.brApparelNeedsTextReview({requiresProof:false,selections:[{customizable:false}]}));
});
test('cart retains spelling checkbox for new personalized apparel and saves its state',()=>{
 let rendered,changed,saves=0;
 const context={window:{},document:{addEventListener(){},createElement(){return {set innerHTML(v){rendered=v},querySelector(){return {addEventListener(type,fn){changed=fn}}}}}},URL,Intl};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/storefront/apparel-builder.js'),'utf8'),context);
 context.window.brApparelPreview=()=>{};
 const items=[{spellingCheckoutAccepted:false,customApparel:{requiresProof:false,requiresPersonalizationReview:true,selections:[{side:'Front',customizable:true,personalization:'A&B'}]}}];
 const preview={dataset:{cartPreview:'0'},classList:{add(){}},closest(){return {querySelector(){return {append(){}}}}}};
 context.window.brApparelCart({querySelectorAll(){return [preview]}},items,()=>saves++);
 assert(rendered.includes('type="checkbox"'));assert(rendered.includes('A&amp;B'));assert(rendered.includes('No separate proof will be sent.'));
 changed({target:{checked:true}});assert.equal(items[0].spellingCheckoutAccepted,true);assert.equal(saves,1);
});
