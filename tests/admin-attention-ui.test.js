'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('menu badges show full counts, hide zero, and retain one accessible label when refreshed',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/admin-attention.js'),'utf8');
 const button={textContent:'Orders & Production',dataset:{},attributes:{},children:[],querySelector(){return this.children[0]||null;},append(element){this.children.push(element);},setAttribute(k,v){this.attributes[k]=v;}};
 const context=vm.createContext({document:{querySelector:()=>button,createElement:()=>({setAttribute(){}})}});
 vm.runInContext(source.slice(source.indexOf('function render('),source.indexOf('async function refresh(')),context);
 context.render({sections:{orders:{count:10,label:'Orders needing work'}}});assert.equal(button.children[0].textContent,'10');assert.equal(button.children[0].hidden,false);assert.match(button.attributes['aria-label'],/10 needing attention/);
 context.render({sections:{orders:{count:0,label:'Orders needing work'}}});assert.equal(button.children[0].hidden,true);assert.equal(button.attributes['aria-label'],'Orders & Production');
 context.render({sections:{orders:{count:123,label:'Orders needing work'}}});assert.equal(button.children.length,1);assert.equal(button.children[0].textContent,'123');assert.equal(button.children[0].hidden,false);
});
