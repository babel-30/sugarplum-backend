'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {imagesFor,show}=require('../public/storefront/product-gallery');
test('selected variation retains Square photo order and never mixes other product colors',()=>{
  assert.deepEqual(imagesFor({images:['back-black','pocket-black','back-black',null,'']},{image:'sand'}),['back-black','pocket-black']);
  assert.deepEqual(imagesFor({image:'sage'},{image:'sand'}),['sage']);
  assert.deepEqual(imagesFor({images:[]},{image:'fallback'}),['fallback']);
});
test('thumbnail selection changes the main photo; switching variations resets to first photo',()=>{
  const doc={createElement(tag){return {tag,children:[],attributes:{},ownerDocument:doc,append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},setAttribute(k,v){this.attributes[k]=v;}};}};
  const container=doc.createElement('div');
  show(container,{name:'Black',images:['black-back','black-pocket']},{name:'Shirt'});
  const [main,caption,controls]=container.children;
  assert.equal(main.src,'black-back');assert.equal(controls.children.length,2);
  controls.children[1].onclick();assert.equal(main.src,'black-pocket');assert.equal(caption.textContent,'Photo 2 of 2');assert.equal(controls.children[1].attributes['aria-pressed'],'true');
  show(container,{name:'Sage',images:['sage-back','sage-pocket']},{name:'Shirt'});
  assert.equal(container.children[0].src,'sage-back');
  show(container,{image:'single'},{name:'Shirt'});assert.equal(container.children[2].children.length,0);
});
