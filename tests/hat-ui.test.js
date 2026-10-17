const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
class Element {
 constructor(tag,attrs={},text=''){this.tagName=tag;this.attrs={...attrs};this._text=text;this.children=[];this.parent=null;this.events={};this.style={};this.value='';this.disabled=false;this.hidden=false;this.clientWidth=600;this.clientHeight=600;this.naturalWidth=1200;this.naturalHeight=800;}
 get className(){return this.attrs.class||''} set className(v){this.attrs.class=v}
 get classList(){const node=this;return {contains(c){return node.className.split(/\s+/).includes(c)},add(...cs){node.className=[...new Set([...node.className.split(/\s+/).filter(Boolean),...cs])].join(' ')},remove(...cs){node.className=node.className.split(/\s+/).filter(c=>!cs.includes(c)).join(' ')},toggle(c,force){let add=force===undefined?!this.contains(c):force;add?this.add(c):this.remove(c);return add}}}
 get dataset(){const d={};for(const [k,v]of Object.entries(this.attrs))if(k.startsWith('data-'))d[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;return d}
 setAttribute(k,v){this.attrs[k]=String(v)} getAttribute(k){return this.attrs[k]??null} removeAttribute(k){delete this.attrs[k]}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}set textContent(v){this._text=String(v);this.children=[]}
 get src(){return this.attrs.src||''} set src(v){this.attrs.src=v}
 appendChild(c){this.children.push(c);c.parent=this;return c}append(...cs){cs.forEach(c=>this.appendChild(c))}replaceChildren(...cs){this._text='';this.children=[];this.append(...cs)}
 addEventListener(name,fn){(this.events[name]??=[]).push(fn)}async fire(name,props={}){for(const fn of this.events[name]||[])await fn({target:this,preventDefault(){},...props})}
 all(){return this.children.flatMap(c=>[c,...c.all()])}
 matches(selector){if(selector[0]==='#')return this.attrs.id===selector.slice(1);if(selector[0]==='.')return this.classList.contains(selector.slice(1));if(selector[0]==='['){let m=selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);return !!m&&Object.hasOwn(this.attrs,m[1])&&(m[2]===undefined||this.attrs[m[1]]===m[2])}return this.tagName===selector}
 querySelectorAll(s){return this.all().filter(c=>c.matches(s))}querySelector(s){return this.querySelectorAll(s)[0]||null}closest(s){return this.matches(s)?this:this.parent?.closest(s)||null}
 scrollIntoView(){}focus(){doc.activeElement=this}showModal(){this.open=true}close(){this.open=false}getBoundingClientRect(){return {left:0,right:600,top:0,bottom:600}}
 cloneNode(deep){let n=new Element(this.tagName,this.attrs,this._text);n.style={...this.style};if(deep)n.append(...this.children.map(c=>c.cloneNode(true)));return n}
}
function build(json){let el=new Element(json.tag,json.attrs,json.text);el.append(...json.children.map(build));return el}
let root=build(JSON.parse(fs.readFileSync(path.join(__dirname,'hat-dom.json'))));


const domEvents={},windowEvents={},data=new Map([['spc_cart_v1','[{"id":"old-shirt","qty":2,"price":10}]']]);
const doc={activeElement:null,getElementById(id){return root.querySelector('#'+id)},querySelector:s=>root.querySelector(s),querySelectorAll:s=>root.querySelectorAll(s),createElement:tag=>new Element(tag),addEventListener:(name,fn)=>(domEvents[name]??=[]).push(fn)};
const products=[{id:'premade',name:'Richardson 112PFP',collection:'Hats',builderEligible:true,squareVariations:[{id:'premade-v',quantity:3,price:30,color:'Camo'}]},{id:'hat-1',name:'Richardson 112',collection:'Hat Blanks',builderEligible:true,squareVariations:[{id:'var-1',color:'Black/Grey',availableQty:5,quantity:5,price:24.99,images:['/front.png','/angle.png','/back.png']},{id:'soldout-1',color:'Camo',quantity:0,price:24.99,images:['/camo.png']},{id:'var-2',color:'Forest',quantity:2,price:25.99,images:['/forest.png']}]},{id:'hat-hidden',name:'Hidden',collection:'Hat Blanks',flags:{hideOnline:true},squareVariations:[]}];
const patch={categories:['Fishing','Coastal'],id:'patch-1',name:'MS Outdoors',imageUrl:'/patch.png',widthInches:3,heightInches:2};
const win={spcProducts:products,location:{href:'http://127.0.0.1:5500/hats.html',search:''},history:{replaceState(){}},matchMedia(){return {matches:false,addEventListener(){}}},addEventListener:(name,fn)=>(windowEvents[name]??=[]).push(fn),dispatchEvent(e){for(const fn of windowEvents[e.type]||[])fn(e)}};
const alerts=[];let calls=[],purchased=null;win.brAddConfiguredHat=(hat,variation,custom,price)=>{purchased={hat,variation,custom,price};};
const context={window:win,document:doc,localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},API_BASE:'https://example.test',URL,URLSearchParams,Intl,AbortSignal,ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},CustomEvent:class{constructor(type,args={}){this.type=type;this.detail=args.detail}},showSpcAlert:msg=>alerts.push(msg),fetch:async url=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('/store/config')?{builderPricingEnabled:true}:url.endsWith('/builder/price')?{priceCents:3300}:{patches:[patch,...Array.from({length:25},(_,i)=>({id:'extra'+i,name:'Other '+i,categories:i===24?[]:['Fishing'],active:true}))],categories:['Fishing','Coastal','Faith']}}}};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/storefront/hats.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/storefront/brackish-ui.js'),'utf8'),context);
const get=id=>doc.getElementById(id);const click=id=>get(id).fire('click');
(async()=>{
 for(const fn of domEvents.DOMContentLoaded)await fn();
 assert.equal(doc.querySelector('[data-br-cart-count]').textContent,'2');
 await doc.querySelector('.br-menu-toggle').fire('click');assert(doc.querySelector('.br-nav').classList.contains('is-open'));
 assert.equal(get('hat-builder-hat-options').children.length,1,'Hidden hats must not appear');
 assert(get('hat-builder-next-patch').disabled);
 await get('hat-builder-hat-options').children[0].fire('click');assert(!get('hat-builder-next-patch').disabled);
 assert.equal(get('hat-builder-color-options').tagName,'select','Colors use a native dropdown');
 assert.equal(get('hat-builder-color-options').children[1].disabled,true,'Sold-out colors disabled');
 get('hat-builder-color-options').value='var-2';await get('hat-builder-color-options').fire('change');
 assert.equal(get('hat-builder-selected-color').textContent,'Forest');assert(get('hat-builder-stock').textContent.includes('2'));assert.equal(get('hat-builder-hat-image').src,'https://example.test/forest.png');
 get('hat-builder-color-options').value='soldout-1';await get('hat-builder-color-options').fire('change');assert.equal(get('hat-builder-color-options').value,'var-2','Disabled colors cannot change the selected variation');
 get('hat-builder-color-options').value='var-1';await get('hat-builder-color-options').fire('change');

 await click('hat-builder-next-patch');assert(calls.includes('https://example.test/patches'),'Patches use configured backend');
 assert(!get('hat-builder-patch-section').classList.contains('hidden'));assert(get('hat-builder-step-hat').classList.contains('hidden'));
 assert.equal(get('hat-builder-patch-options').children.length,12,'Browse All shows designs immediately');assert(get('hat-builder-patch-categories').children[0].classList.contains('active'));assert.equal(get('hat-builder-patch-categories').children[0].getAttribute('aria-pressed'),'true');
 const category=n=>get('hat-builder-patch-categories').children.find(b=>b.textContent===n);
 assert(!category('Faith'),'Hide empty categories');
 await category('Coastal').fire('click');assert(category('Coastal').classList.contains('active'));assert(!category('Browse All').classList.contains('active'));assert.equal(get('hat-builder-patch-options').children.length,1);
 await get('hat-builder-patch-options').children[0].fire('click');
 await category('Fishing').fire('click');assert.equal(get('hat-builder-patch-options').children.length,12);assert(get('hat-builder-patch-pages').textContent.includes('25 designs'));assert.equal(get('hat-builder-selected-patch').textContent,'MS Outdoors');
 await category('Browse All').fire('click');assert(get('hat-builder-patch-pages').textContent.includes('26 designs'));assert.equal(get('hat-builder-patch-options').children.length,12);
 get('hat-builder-patch-pages').children[2].onclick();get('hat-builder-patch-pages').children[2].onclick();assert.equal(get('hat-builder-patch-options').children.length,2);
 get('hat-builder-patch-search').value='Other 24';await get('hat-builder-patch-search').fire('input');assert.equal(get('hat-builder-patch-options').children.length,1,'Uncategorized patch searchable in Browse All');
 get('hat-builder-patch-search').value='';await get('hat-builder-patch-search').fire('input');await category('Coastal').fire('click');
 await get('hat-builder-patch-options').children[0].fire('click');await click('hat-builder-next-preview');
 assert(!get('hat-builder-step-preview').classList.contains('hidden'));assert(!get('hat-builder-patch-image').classList.contains('hidden'));
 assert.equal(get('hat-builder-patch-image').style.width,'24%');assert(Math.abs(parseFloat(get('hat-builder-patch-image').style.height)-15.111111)<.00001,'Overlay fits the letterboxed photo');
 await doc.querySelectorAll('.hat-placement-button')[1].fire('click');assert.equal(get('hat-builder-patch-image').style.left,'64%','Wearer left maps to viewer right');
 assert.equal(get('hat-builder-photo-options'),null,'Builder has only the front view');assert(!get('hat-builder-patch-image').classList.contains('hidden'));assert.equal(get('hat-builder-hat-image').src,'https://example.test/front.png');
 await click('hat-builder-enlarge');assert(get('hat-builder-preview-dialog').open);assert.equal(get('hat-builder-large-stage').children.length,2);await click('hat-builder-close-preview');assert(!get('hat-builder-preview-dialog').open);
 await click('hat-builder-next-cart');assert(!get('hat-builder-step-cart').classList.contains('hidden'));assert.equal(get('hat-builder-request'),null,'Stocked builder does not request a quote');
 await new Promise(r=>setImmediate(r));await click('hat-builder-purchase');assert.equal(purchased.price,3300);assert.equal(purchased.custom.patchId,'patch-1');await click('hat-builder-add-cart');let saved=JSON.parse(data.get('br_hat_design_v1'));assert.equal(saved.patchId,'patch-1');assert.equal(saved.placement,'Left');assert.equal(saved.variationId,'var-1');assert.equal(data.get('spc_cart_v1'),'[{"id":"old-shirt","qty":2,"price":10}]','Custom design must not overwrite cart or charge a blank hat');
 await click('hat-builder-back-preview');await click('hat-builder-back-patch');await click('hat-builder-back-hat');assert(!get('hat-builder-step-hat').classList.contains('hidden'));
 await click('hat-mode-shop');assert(get('hat-build-mode').classList.contains('hidden'));assert(!get('hat-shop-mode').classList.contains('hidden'));
 let tools=win.BrackishHatTools;assert.equal(tools.qty({quantity:null,stock:3}),3);assert.equal(tools.qty({quantity:0,stock:3}),0);assert.equal(tools.qty({inventoryCount:8}),8);
 const center=tools.geometry('Richardson 112',patch,'Center',1,1),left=tools.geometry('Richardson 112',patch,'Left',1,1),right=tools.geometry('Richardson 112',patch,'Right',1,1);assert.equal(center.left,50);assert.equal(left.left,64);assert.equal(right.left,36);
 const portrait=tools.geometry('Richardson 112',patch,'Center',.5,1);assert.equal(portrait.width,12);assert.equal(portrait.left,50);
 get('hat-builder-patch-search').value='missing';await get('hat-builder-patch-search').fire('input');assert.equal(get('hat-builder-patch-options').children.length,0);assert(get('hat-builder-patch-loading').textContent.includes('No patch designs'));
 win.dispatchEvent({type:'spc-products-ready',detail:{products:[],error:true}});assert(get('hat-builder-hat-loading').textContent.includes('couldn’t load'));assert.equal(get('br-catalog-retry').hidden,false);
 console.log('PASS: mobile menu and cart badge; all four builder steps/back buttons; hidden/sold-out products; configured patch API; letterbox geometry and wearer placement; front-only overlay; zoom; search; saved design/request metadata; original cart preservation; catalog failures.');
})().catch(e=>{console.error(e);process.exit(1)});
