(() => {
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let catalog,sequence=0;
 const api=async(path,options={})=>{const r=await fetch(API_BASE+path,options),d=await r.json();if(!r.ok)throw new Error(d.error||'Request could not be completed');return d;};
 function rows(){return [...$('requested-products').querySelectorAll('.request-product')];}
 function add(defaults={}){
  if(rows().length>=30)return;
  const n=++sequence,element=document.createElement('section');element.className='request-product';
  element.innerHTML='<h3>Requested product</h3><div class="customer-fields"><label>Product type<select data-request-type required></select></label><label data-style-label>Style / model<select data-request-style required><option value="">Choose a style</option></select></label></div><div class="customer-fields" data-request-options></div><div class="customer-fields"><label>Quantity<input data-request-quantity type="number" min="1" max="10000" step="1" value="1" required></label><label>Additional notes<input data-request-notes maxlength="500" placeholder="Optional details for this product"></label></div><p data-request-help class="admin-help-text" hidden>Tell us the product, colors and sizes you have in mind in Additional notes.</p><button type="button" class="br-button" data-request-remove>Remove product</button>';
  $('requested-products').append(element);
  const types=[...new Set(catalog.products.flatMap(p=>p.variations.map(v=>v.type)))].sort(),type=element.querySelector('[data-request-type]'),style=element.querySelector('[data-request-style]'),options=element.querySelector('[data-request-options]'),notes=element.querySelector('[data-request-notes]');
  type.innerHTML=types.map(t=>'<option value="'+esc(t)+'">'+esc(t)+'</option>').join('')+(catalog.allowHelp?'<option value="__help__">Not sure / help me choose</option>':'');
  const preferred=catalog.products.find(p=>p.name.toLowerCase()===String(defaults.hatName||defaults.style||'').toLowerCase());
  if(preferred)type.value=preferred.variations[0]?.type||type.value;
  else if(defaults.type==='Hat'&&types.includes('Hats'))type.value='Hats';
  else if(defaults.type==='Apparel')type.value=types.find(t=>t!=='Hats')||type.value;
  notes.value=defaults.patchName||'';
  if(!preferred&&(defaults.style||defaults.hatName))notes.value=['Requested style: '+(defaults.style||defaults.hatName),defaults.color&&'Color: '+defaults.color,defaults.size&&'Size: '+defaults.size,notes.value].filter(Boolean).join('; ').slice(0,500);
  function variations(){element.selectedVariation=null;options.replaceChildren();const p=catalog.products.find(p=>p.id===style.value);if(!p)return;
   const list=p.variations.filter(v=>v.type===type.value),chosen=list.find(v=>(!defaults.color||v.color===defaults.color)&&(!defaults.size||v.size===defaults.size));
   // Product type is already selected above; the remaining dropdowns retain Square's option combinations.
   const display=list.map(v=>({...v,garmentType:'',options:Object.fromEntries(Object.entries(v.options).filter(([k])=>k.toLowerCase()!=='type'))}));
   window.BrackishVariations.mount(options,display,{idPrefix:'request-'+n,selectedId:chosen?.id,onChange:v=>element.selectedVariation=list.find(item=>item.id===v?.id)});
  }
  function styles(){const help=type.value==='__help__';element.querySelector('[data-style-label]').hidden=help;style.disabled=help;style.required=!help;element.querySelector('[data-request-help]').hidden=!help;notes.required=help;
   options.hidden=help;style.innerHTML='<option value="">Choose a style</option>'+catalog.products.filter(p=>p.variations.some(v=>v.type===type.value)).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
   if(!help){if(preferred&&[...style.options].some(o=>o.value===preferred.id))style.value=preferred.id;else if(style.options.length===2)style.selectedIndex=1;}variations();
  }
  style.onchange=variations;type.onchange=styles;styles();
  element.read=()=>{const quantity=Number(element.querySelector('[data-request-quantity]').value),text=notes.value.trim();if(!Number.isInteger(quantity)||quantity<1||quantity>10000)throw new Error('Enter a quantity from 1 to 10,000');if(type.value==='__help__'){if(!text)throw new Error('Describe the product you need help choosing');return {help:true,quantity,notes:text};}if(!element.selectedVariation)throw new Error('Choose a style and its options for every requested product');return {type:type.value,productId:style.value,variationId:element.selectedVariation.id,quantity,notes:text};};
  element.querySelector('[data-request-remove]').onclick=()=>{element.remove();$('add-request-product').disabled=false;};$('add-request-product').disabled=rows().length>=30;
 }
 async function init(){
  const form=$('custom-request-form'),status=$('request-status'),submit=form.querySelector('[type=submit]'),addButton=$('add-request-product');submit.disabled=addButton.disabled=true;
  async function load(){status.textContent='Loading custom product choices…';try{catalog=await api('/custom-order-options');if(!catalog.products.length&&!catalog.allowHelp)throw new Error('Custom product choices are not available yet. Please contact us for help.');
    let defaults={};try{defaults=JSON.parse(new URLSearchParams(location.search).get('design')||'{}');}catch{}
    try{const context=JSON.parse(sessionStorage.getItem('br_quote_context')||'null');if(context){defaults={...defaults,...context};sessionStorage.removeItem('br_quote_context');}}catch{}
    $('requested-products').replaceChildren();add(defaults);submit.disabled=false;addButton.disabled=false;status.textContent='';
   }catch(e){status.textContent=e.message+' ';const retry=document.createElement('button');retry.type='button';retry.className='br-button';retry.textContent='Try again';retry.onclick=load;status.append(retry);}}
  addButton.onclick=()=>add();
  form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;status.textContent='Sending your request…';try{const selected=rows().map(row=>row.read());if(!selected.length)throw new Error('Add at least one requested product');const data=new FormData(form);data.set('productSelections',JSON.stringify(selected));
    const files=[...form.elements.files.files];if(files.length>10||files.some(f=>f.size>10*1024*1024))throw new Error('Upload up to 10 files, each under 10 MB');
    const result=await api('/custom-requests',{method:'POST',body:data});window.dispatchEvent(new CustomEvent('br-track',{detail:{name:'request_submitted'}}));status.textContent='Your request has been received. Check your email for confirmation and future quote updates. If you do not see our email, check your Junk or Spam folder and mark it as not spam. Keep this private link to review updates and your quote. ';
    const link=document.createElement('a');link.className='br-button';link.href=result.reviewUrl;link.textContent='Open your project →';status.append(link);form.reset();$('requested-products').replaceChildren();add();
   }catch(err){status.textContent=err.message;}finally{submit.disabled=false;}};
  await load();
 }
 window.BrackishCustomRequestForm={init};
})();
