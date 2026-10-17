(()=>{
'use strict';
const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('square-color-dropdowns.css',document.currentScript?.src||location.href).href;document.head.append(style);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hex=v=>/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(v||'')?v:null;
// Keep the native select, including its keyboard, form and disabled-option behavior.
// Rich option content progressively enhances browsers supporting base-select.
function decorate(select,variations=[],match='color'){
 if(!select)return;
 const resolve=typeof match==='function'?match:o=>variations.find(v=>(match==='id'?v.id:v.color)===o.value&&hex(v.colorHex))?.colorHex;
 let any=false;
 for(const option of select.options){const value=hex(resolve(option)),text=option.textContent;option.replaceChildren();
  if(value){any=true;const chip=document.createElement('span');chip.className='square-option-swatch';chip.style.backgroundColor=value;chip.setAttribute('aria-hidden','true');option.append(chip);}
  const name=document.createElement('span');name.textContent=text;option.append(name);
 }
 select.classList.toggle('square-color-select',any);
 if(any&&typeof CSS!=='undefined'&&CSS.supports('appearance','base-select')&&!select.querySelector('selectedcontent')){
  const button=document.createElement('button');button.type='button';button.className='square-selected-button';button.append(document.createElement('selectedcontent'));select.prepend(button);
 }
}
function compareSizes(a,b){const ranks={XXS:0,XS:1,S:2,M:3,L:4,XL:5,XXL:6,'2XL':6,'2X':6,XXXL:7,'3XL':7,'3X':7,'4XL':8,'4X':8,'5XL':9,'5X':9,'6XL':10,'6X':10};const rank=v=>ranks[String(v).trim().toUpperCase().replace(/\s/g,'')];const x=rank(a),y=rank(b);return x!==undefined&&y!==undefined?x-y:x!==undefined?-1:y!==undefined?1:String(a).localeCompare(String(b),undefined,{numeric:true});}
function defaultColor(product,colors=[]){const stock=(product.squareVariations||product.variations||[]);const available=(product.collection||product.category)==='Hats'&&product.fulfillmentMode!=='made-to-order'?stock.find(v=>Number(v.quantity??v.availableQty??0)>0):null;return (available&&(available.color||available.name))||colors[0]||'';}
function attributes(v){const out={...v.options};for(const [key,val] of [['Color',v.color],['Type',v.garmentType],['Sleeve',v.sleeve],['Size',v.size],['Design',v.printLocation]])if(val&&!Object.keys(out).some(k=>k.toLowerCase()===key.toLowerCase()))out[key]=val;return out;}
const summary=v=>Object.entries(attributes(v)).map(([key,value])=>key+': '+value).join(' · ');
function mount(container,variations,{selectedId,onChange,idPrefix='variation'}={}){
 const maps=variations.map(attributes),keys=[...new Set(maps.flatMap(v=>Object.keys(v)))];
 keys.sort((a,b)=>{const rank=k=>{const n=k.toLowerCase();return n.includes('color')?0:n==='type'?1:n.includes('sleeve')?2:n.includes('size')?3:4;};return rank(a)-rank(b);});
 let chosen=variations.find(v=>v.id===selectedId)||variations[0],values=chosen?attributes(chosen):{};
 if(!keys.length)keys.push('Option');
 if(keys[0]==='Option')maps.forEach((m,i)=>m.Option=variations[i].name||'Default');
 function render(){container.replaceChildren();let candidates=variations.map((v,i)=>({v,map:maps[i]}));
 for(const key of keys){const choices=[...new Set(candidates.map(x=>x.map[key]||'Default'))];if(/size/i.test(key))choices.sort(compareSizes);if(!choices.includes(values[key]))values[key]=choices[0];const label=document.createElement('label');label.textContent=key;const select=document.createElement('select');select.id=idPrefix+'-'+key.toLowerCase().replace(/[^a-z0-9]+/g,'-');select.dataset.option=key;select.innerHTML=choices.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');select.value=values[key]||'';label.append(select);container.append(label);if(/colou?r/i.test(key))decorate(select,[],o=>candidates.find(x=>x.map[key]===o.value&&hex(x.v.optionColors?.[key]||x.v.colorHex))?.v.optionColors?.[key]||candidates.find(x=>x.map[key]===o.value&&hex(x.v.colorHex))?.v.colorHex);select.onchange=()=>{values[key]=select.value;const start=keys.indexOf(key);keys.slice(start+1).forEach(k=>delete values[k]);const focused=select.contains(document.activeElement);render();if(focused)document.getElementById(select.id)?.focus();};candidates=candidates.filter(x=>(x.map[key]||'Default')===values[key]);}
 chosen=candidates.find(x=>x.v.id===chosen?.id)?.v||candidates[0]?.v;
 if(chosen){const color=hex(chosen.colorHex);if(color){const swatch=document.createElement('span');swatch.className='square-color-swatch';swatch.style.backgroundColor=color;swatch.setAttribute('aria-label',(chosen.color||'Color')+' '+color);const text=document.createElement('span');text.className='square-color-label';text.textContent=(chosen.color||'Color')+' · '+color;const line=document.createElement('div');line.className='square-color-current';line.append(swatch,text);container.append(line);}}
 onChange?.(chosen);
 }
 render();return {get selected(){return chosen;}};
}
window.BrackishVariations={defaultColor,compareSizes,mount,attributes,summary,hex,decorate};
})();
