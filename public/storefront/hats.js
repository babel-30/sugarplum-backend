/* Brackish Roots hat builder. Reads existing Square products and /patches.
   Custom configurations are saved/requested, never charged as an unconfigured blank hat. */
(() => {
  'use strict';
  const finite = (value, fallback) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const qty = variation => {
    for (const field of ['availableQty','available_quantity','inventory','quantity','stock','qty','onHand','on_hand','quantityOnHand','quantity_on_hand','inventoryCount']) {
      if (variation?.[field] !== undefined && variation[field] !== null && variation[field] !== '') {
        const number = Number(variation[field]); if (Number.isFinite(number)) return Math.max(0,number);
      }
    }
    return 0;
  };
  const variations = hat => Array.isArray(hat?.squareVariations) ? hat.squareVariations : Array.isArray(hat?.variations) ? hat.variations : [];
  const color = variation => String(variation?.color || variation?.name || 'Default');
  const images = (variation, hat) => Array.isArray(variation?.images) && variation.images.length ? variation.images.filter(src => typeof src === 'string' && src) : [variation?.image || hat?.image].filter(Boolean);
  const price = (variation,hat) => finite(variation?.price,finite(hat?.price,0));
  const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
  const key = item => String(item?.catalogObjectId || item?.id || item?.squareVariationId || '');
  function geometry(hatName, patch, placement, imageRatio=1, stageRatio=1) {
    const calibration = /richardson\s*112/i.test(hatName) ? { width:56, height:34, x:50, y:51 } : { width:72, height:44, x:50, y:48 };
    const prefix = placement === 'Left' ? 'previewLeft' : placement === 'Right' ? 'previewRight' : 'previewCenter';
    const scale = clamp(finite(patch?.[prefix+'Scale'], placement === 'Center' ? finite(patch?.previewScale,1) : 1),.25,3);
    const offsetX = finite(patch?.[prefix+'OffsetX'],placement === 'Center' ? finite(patch?.previewOffsetX,0) : 0);
    const offsetY = finite(patch?.[prefix+'OffsetY'],placement === 'Center' ? finite(patch?.previewOffsetY,0) : 0);
    const renderedWidth = imageRatio >= stageRatio ? 100 : 100*imageRatio/stageRatio;
    const renderedHeight = imageRatio >= stageRatio ? 100*stageRatio/imageRatio : 100;
    const shift = placement === 'Left' ? calibration.width*.25 : placement === 'Right' ? -calibration.width*.25 : 0;
    return {
      width: Math.max(.25,finite(patch?.widthInches,3))/7*calibration.width*scale*renderedWidth/100,
      height: Math.max(.25,finite(patch?.heightInches,2))/3*calibration.height*scale*renderedHeight/100,
      left: (100-renderedWidth)/2 + renderedWidth*(calibration.x+shift+offsetX*.5)/100,
      top: (100-renderedHeight)/2 + renderedHeight*(calibration.y+offsetY*.5)/100,
    };
  }
  window.BrackishHatTools = { qty, geometry, images, price };
  document.addEventListener('DOMContentLoaded', () => {
    const byId = id => document.getElementById(id);
    if (!byId('hat-builder-workspace')) return;
    const api = () => typeof API_BASE !== 'undefined' ? API_BASE.replace(/\/$/,'') : '';
    const state = { hats:[], patches:[], categories:[], patchCategory:'', patchPage:1, hat:null, variation:null, patch:null, patchVariant:null, placement:'Center', photo:0, step:1, patchLoaded:false,priceCents:null,pricingError:'',pricingEnabled:false,priceRequest:0 };
    const requestedHat=new URLSearchParams(window.location.search).get('hat');
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('br_hat_design_v1') || 'null'); } catch (_) {}
    const el = (tag,className,text) => { const node=document.createElement(tag); if(className)node.className=className; if(text!==undefined)node.textContent=text; return node; };
    const resolveImage = source => {
      if (typeof source !== 'string' || !source) return '';
      try { const url = new URL(source,api()+'/'); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch (_) { return ''; }
    };
    const alert = message => { if(typeof showSpcAlert === 'function') showSpcAlert(message,'info'); else byId('hat-builder-preview-note').textContent=message; };
    function selectedButton(button, selected) { button.classList.toggle('active',selected); button.setAttribute('aria-pressed',String(selected)); }
    function config() {
      if(!state.hat || !state.variation) return null;
      return { brand:'Brackish Roots', hatId:state.hat.id, hatName:state.hat.name, variationId:key(state.variation), color:color(state.variation), patchId:state.patch?.id || null, patchName:state.patch?.name || null,patchVariantId:state.patchVariant?.id||null,patchVariantName:state.patchVariant?.name||null,patchMaterial:state.patchVariant?.material||'',
        placement:state.placement, widthInches:state.patch?.widthInches || null, heightInches:state.patch?.heightInches || null,
        hatStartingPrice:price(state.variation,state.hat), savedAt:new Date().toISOString() };
    }
    function hasPatch(){return !!state.patch&&!!state.patchVariant&&state.patchVariant.stockStatus!=='out-of-stock';}
    function hasHat() { return !!state.hat && !!state.variation && (state.hat?.fulfillmentMode==='made-to-order'||qty(state.variation)>0); }
    function refreshProgress() {
      document.querySelectorAll('[data-builder-step]').forEach(button => {
        const step=Number(button.dataset.builderStep);
        selectedButton(button,step===state.step);
        button.disabled=step>1&&!hasHat() || step>2&&!hasPatch();
        if(step===state.step)button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
      });
      byId('hat-builder-next-patch').disabled=!hasHat();
      byId('hat-builder-next-preview').disabled=!hasHat()||!hasPatch();
      byId('hat-builder-next-cart').disabled=!hasHat()||!hasPatch();
      byId('hat-builder-add-cart').disabled=!hasHat()||!hasPatch();
    }
    async function stepTo(step, scroll=true) {
      if(step>1&&!hasHat() || step>2&&!hasPatch()) return;
      state.step=step;byId('hat-builder-workspace').dataset.step=String(step);
      document.querySelectorAll('[data-builder-panel]').forEach(panel => {
        const active=Number(panel.dataset.builderPanel)===step;
        panel.classList.toggle('hidden',!active); panel.classList.toggle('active',active);
      });
      refreshProgress();
      if(step===2&&!state.patchLoaded) await loadPatches();
      if(step>=3) { state.photo=0; updatePreview(); }
      if(step===4) renderSummary();
      if(scroll) {
        const panel=document.querySelector(`[data-builder-panel="${state.step}"]`);
        panel?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
        const heading=panel?.querySelector('h3'); if(heading){heading.tabIndex=-1; heading.focus({preventScroll:true});}
      }
    }
    function setMode(mode,changeUrl=true) {
      const build=mode==='build';
      selectedButton(byId('hat-mode-build'),build); selectedButton(byId('hat-mode-shop'),!build);
      byId('hat-mode-build').setAttribute('aria-selected',String(build)); byId('hat-mode-shop').setAttribute('aria-selected',String(!build));
      byId('hat-mode-build').tabIndex=build?0:-1; byId('hat-mode-shop').tabIndex=build?-1:0;
      byId('hat-build-mode').classList.toggle('hidden',!build); byId('hat-shop-mode').classList.toggle('hidden',build);
      if(changeUrl){const url=new URL(window.location.href);url.searchParams.set('mode',build?'build':'shop');url.hash='';window.history.replaceState({},'',url);}
    }
    function applyPatchGeometry() {
      const patchImage=byId('hat-builder-patch-image'); const hatImage=byId('hat-builder-hat-image'); const stage=byId('hat-builder-preview-stage');
      const ready=!!state.patch?.resolvedImageUrl&&state.photo===0&&!!hatImage.getAttribute('src')&&!hatImage.classList.contains('hidden');
      patchImage.classList.toggle('hidden',!ready);
      if(!ready)return;
      const g=geometry(state.hat?.name || '',state.patch,state.placement,hatImage.naturalWidth&&hatImage.naturalHeight?hatImage.naturalWidth/hatImage.naturalHeight:1,stage.clientWidth&&stage.clientHeight?stage.clientWidth/stage.clientHeight:1);
      Object.assign(patchImage.style,{position:'absolute',left:g.left+'%',top:g.top+'%',width:g.width+'%',height:g.height+'%',maxWidth:'none',maxHeight:'none',objectFit:'contain',transform:'translate(-50%, -50%)',pointerEvents:'none'});
    }
    function updatePreview() {
      const hatImage=byId('hat-builder-hat-image'),patchImage=byId('hat-builder-patch-image');
      state.photo=0;
      const source=resolveImage(images(state.variation,state.hat)[0]);
      byId('hat-builder-preview-title').textContent=state.hat?.name || 'Your Hat Starts Here';
      byId('hat-builder-detail-hat').textContent=state.hat?.name || 'Not selected';
      byId('hat-builder-detail-color').textContent=state.variation?color(state.variation):'Not selected';
      byId('hat-builder-detail-patch').textContent=state.patch?.name || 'Not selected';
      byId('hat-builder-detail-placement').textContent=state.placement==='Center'?'Center':`Wearer’s ${state.placement.toLowerCase()}`;
      byId('hat-builder-price').textContent=state.variation?money(price(state.variation,state.hat)):'—';
      if(source) {
        if(hatImage.getAttribute('src')!==source)hatImage.src=source;
        hatImage.alt=`${state.hat?.name || 'Hat'} in ${color(state.variation)} — ${['front','angled','back'][state.photo] || 'additional'} view`;
        hatImage.classList.remove('hidden');
      } else {hatImage.removeAttribute('src');hatImage.classList.add('hidden');}
      byId('hat-builder-preview-empty').classList.toggle('hidden',!!source);
      byId('hat-builder-preview-details').classList.toggle('hidden',!state.hat);
      byId('hat-builder-enlarge').disabled=!source;
      if(state.patch?.resolvedImageUrl){patchImage.src=state.patch.resolvedImageUrl;patchImage.alt=state.patch.name || 'Selected patch';}
      else {patchImage.removeAttribute('src');patchImage.classList.add('hidden');}
      byId('hat-builder-preview-note').textContent=!source?'Choose a hat with an available photo to see your preview.':
        state.photo!==0?'The patch preview appears on the front view. This photo shows the blank hat.':state.patch?
        'Visual preview only. Final placement may vary slightly. Left and right refer to the wearer.':'Choose a patch to complete your preview.';
      document.querySelectorAll('.hat-placement-button').forEach(button=>selectedButton(button,button.dataset.placement===state.placement));
      applyPatchGeometry();refreshProgress();requestPrice();
    }
    function renderColors() {
      const options=byId('hat-builder-color-options');options.replaceChildren();
      const madeToOrder=state.hat?.fulfillmentMode==='made-to-order';
      variations(state.hat).forEach(variation=>{
        const unavailable=qty(variation)<=0&&!madeToOrder;
        const option=el('option',null,color(variation)+(unavailable?' — Sold out':''));
        option.value=key(variation);option.disabled=unavailable;
        option.selected=key(variation)===key(state.variation);options.appendChild(option);
      });
      options.value=state.variation?key(state.variation):'';
      options.disabled=!state.hat;
      window.BrackishVariations?.decorate?.(options,variations(state.hat),'id');
      byId('hat-builder-color-section').classList.toggle('hidden',!state.hat);
      byId('hat-builder-selected-color').textContent=state.variation?color(state.variation):'';
      if(state.hat)window.brAppendStockAlerts?.(byId('hat-builder-color-section'),state.hat);
    }
    function updateStock() {
      const node=byId('hat-builder-stock'),count=qty(state.variation);
      node.classList.remove('hidden','stock-in','stock-low','stock-out');
      node.textContent=state.hat?.fulfillmentMode==='made-to-order'?'Made to order':count<=0?'Out of stock':count<=3?`Low stock (${count} left)`:`${count} in stock`;
      node.classList.add(count<=0?'stock-out':count<=3?'stock-low':'stock-in');refreshProgress();
    }
    function selectHat(hat,variationId='') {
      state.hat=hat;state.variation=variations(hat).find(v=>key(v)===String(variationId)&&(hat.fulfillmentMode==='made-to-order'||qty(v)>0))||variations(hat).find(v=>hat.fulfillmentMode==='made-to-order'||qty(v)>0)||variations(hat)[0]||null;state.photo=0;
      document.querySelectorAll('.hat-builder-hat-card').forEach(button=>selectedButton(button,button.dataset.hatId===String(hat.id)));
      renderColors();updateStock();updatePreview();
    }
    function renderHats(products,error=false) {
      state.hats=(Array.isArray(products)?products:[]).filter(product=>String(product.collection || '').toLowerCase()==='hat blanks'&&!product.flags?.hideOnline&&product.builderEligible===true);
      const target=byId('hat-builder-hat-options');target.replaceChildren();
      const status=byId('hat-builder-hat-loading');
      status.textContent=error?'We couldn’t load the hats. Please try again.':state.hats.length?'':'No customizable hats are available right now.';
      if(error){const retry=el('button','br-button','Try Again');retry.type='button';retry.addEventListener('click',()=>{status.textContent='Loading available hats…';if(typeof loadProducts==='function')loadProducts();});status.appendChild(retry);}
      state.hats.forEach(hat=>{
        const button=el('button','hat-builder-hat-card');button.type='button';button.dataset.hatId=String(hat.id);
        const v=variations(hat).find(v=>hat.fulfillmentMode==='made-to-order'||qty(v)>0)||variations(hat)[0];const source=resolveImage(images(v,hat)[0]);
        if(source){const img=el('img');img.src=source;img.alt=hat.name;img.loading='lazy';button.appendChild(img);}
        button.append(el('span','hat-builder-hat-card-name',hat.name),el('span','hat-builder-hat-card-price',`Hat from ${money(price(v,hat))}`));
        button.addEventListener('click',()=>{selectHat(hat);stepTo(1,false);});target.appendChild(button);
      });
      const requested=state.hats.find(hat=>String(hat.id)===requestedHat);
      const restore=state.hats.find(hat=>String(hat.id)===String(saved?.hatId));
      if(requested&&!state.hat){selectHat(requested);}
      else if(!state.hat&&restore){selectHat(restore,saved.variationId);state.placement=['Left','Center','Right'].includes(saved.placement)?saved.placement:'Center';}
      else if(state.hat){const current=state.hats.find(hat=>String(hat.id)===String(state.hat.id));if(current)selectHat(current,key(state.variation));else{state.hat=null;state.variation=null;state.patch=null;stepTo(1,false);updatePreview();}}
      refreshProgress();
    }
    function selectPatch(patch) {
      state.patch={...patch};const options=patch.variants?.length?patch.variants:[{id:'default',name:'Default',imageUrl:patch.imageUrl,stockStatus:'in-stock'}];state.patch.variants=options;
      state.patchVariant=options.find(v=>v.id===saved?.patchVariantId&&v.stockStatus!=='out-of-stock')||options.find(v=>v.stockStatus!=='out-of-stock')||options[0];
      byId('hat-builder-selected-patch').textContent=patch.name||'Patch';
      document.querySelectorAll('.hat-builder-patch-card').forEach(button=>selectedButton(button,button.dataset.patchId===String(patch.id)));
      renderPatchOptions();selectPatchOption(state.patchVariant.id);
    }
    function renderPatchOptions(){const target=byId('hat-builder-patch-variants');target.replaceChildren();target.hidden=!state.patch;if(!state.patch)return;
      target.append(el('h3','','Choose patch color / material'));state.patch.variants.forEach(v=>{const wrap=el('div','br-patch-option'),button=el('button','br-button',v.name+(v.material?' / '+v.material:'')+(v.stockStatus==='out-of-stock'?' — Out of stock':v.stockStatus==='low-stock'?' — Low stock':''));button.type='button';button.dataset.patchVariantId=v.id;button.classList.toggle('stock-low',v.stockStatus==='low-stock');button.classList.toggle('stock-out',v.stockStatus==='out-of-stock');selectedButton(button,v.id===state.patchVariant?.id);button.onclick=()=>selectPatchOption(v.id);const imageSource=resolveImage(v.imageUrl||state.patch.imageUrl);if(imageSource){const thumbnail=el('img','br-patch-option-thumb');thumbnail.src=imageSource;thumbnail.alt=v.name;wrap.append(thumbnail);}wrap.append(button);if(v.stockStatus==='out-of-stock'){const notify=el('button','br-button br-button-small','Notify me');notify.type='button';notify.onclick=()=>window.brNotifyStock?.({source:'patch',itemId:state.patch.id,variantId:v.id,label:state.patch.name+' — '+v.name});wrap.append(notify);}target.append(wrap);});}
    function selectPatchOption(id){state.patchVariant=state.patch.variants.find(v=>v.id===id);state.patch.resolvedImageUrl=resolveImage(state.patchVariant.imageUrl||state.patch.imageUrl);renderPatchOptions();updatePreview();}
    function renderPatchCategories() {
      const target=byId('hat-builder-patch-categories');target.replaceChildren();
      ['Browse All', ...state.categories.filter(c=>state.patches.some(p=>(p.categories||[]).includes(c)))].forEach((label,i)=>{
        const category=i===0?'':label, button=el('button','br-button',label);button.type='button';selectedButton(button,state.patchCategory===category);
        button.addEventListener('click',()=>{state.patchCategory=category;state.patchPage=1;renderPatchCategories();renderPatches();});target.appendChild(button);
      });
    }
    function renderPatches() {
      const target=byId('hat-builder-patch-options');target.replaceChildren();
      const query=byId('hat-builder-patch-search').value.trim().toLowerCase();
      const filtered=state.patches.filter(patch=>(state.patchCategory==='' || (patch.categories||[]).includes(state.patchCategory)) && String(patch.name || '').toLowerCase().includes(query));
      const pages=Math.max(1,Math.ceil(filtered.length/12));state.patchPage=Math.min(state.patchPage,pages);
      const pager=byId('hat-builder-patch-pages');pager.replaceChildren();
      if(filtered.length>12){const prev=el('button','br-button','Previous'),next=el('button','br-button','Next');prev.type=next.type='button';prev.disabled=state.patchPage===1;next.disabled=state.patchPage===pages;prev.onclick=()=>{state.patchPage--;renderPatches();};next.onclick=()=>{state.patchPage++;renderPatches();};pager.append(prev,el('span','',`Page ${state.patchPage} of ${pages} · ${filtered.length} designs`),next);}
      byId('hat-builder-patch-loading').textContent=filtered.length?'':state.patches.length?'No patch designs match this category and search.':'No patches are available right now.';
      filtered.slice((state.patchPage-1)*12,state.patchPage*12).forEach(patch=>{
        const button=el('button','hat-builder-patch-card');button.type='button';button.dataset.patchId=String(patch.id);selectedButton(button,String(patch.id)===String(state.patch?.id));
        const source=resolveImage(patch.imageUrl || patch.image);
        if(source){const img=el('img');img.src=source;img.alt=patch.name || 'Patch';img.loading='lazy';button.appendChild(img);}else button.appendChild(el('span','hat-builder-patch-card-placeholder','Preview unavailable'));
        button.appendChild(el('span','hat-builder-patch-card-name',patch.name || 'Patch'));
        button.addEventListener('click',()=>selectPatch(patch));target.appendChild(button);
      });
    }
    async function loadPatches() {
      const status=byId('hat-builder-patch-loading');status.textContent='Loading available patches…';
      try {
        const response=await fetch(`${api()}/patches`,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Patches unavailable');
        const data=await response.json();state.patches=(Array.isArray(data)?data:Array.isArray(data?.patches)?data.patches:[]).filter(p=>p?.active!==false);state.patchLoaded=true;
        state.categories=Array.from(new Set([...(Array.isArray(data.categories)?data.categories:[]),...state.patches.flatMap(p=>Array.isArray(p.categories)?p.categories:[])])).filter(c=>typeof c==='string');renderPatchCategories();renderPatches();const restore=state.patches.find(p=>String(p.id)===String(saved?.patchId));if(restore&&!state.patch)selectPatch(restore);
      } catch (_) {
        status.textContent='We couldn’t load the patches. Please try again.';
        const retry=el('button','br-button','Try Again');retry.type='button';retry.addEventListener('click',loadPatches);status.appendChild(retry);
      }
    }
    async function requestPrice(){
 const seq=++state.priceRequest;state.priceCents=null;state.pricingError='';const button=byId('hat-builder-purchase');button.disabled=true;button.hidden=!state.pricingEnabled;
 if(!state.pricingEnabled||!hasHat()||!hasPatch())return;
 try{const response=await fetch(api()+'/builder/price',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:state.hat.id,catalogObjectId:key(state.variation),customHat:{patchId:state.patch.id,patchVariantId:state.patchVariant.id,placement:state.placement}})});const data=await response.json();if(seq!==state.priceRequest)return;if(!response.ok)throw new Error(data.error||'Pricing is unavailable');state.priceCents=data.priceCents;button.disabled=false;if(state.step===4)renderSummary();}
 catch(e){if(seq!==state.priceRequest)return;state.pricingError=e.message;if(state.step===4)renderSummary();}
}
function renderSummary() {
      const target=byId('hat-builder-summary');target.replaceChildren();const design=config();if(!design)return;
      [['Hat',design.hatName],['Color',design.color],['Patch',design.patchName],['Patch color / material',[design.patchVariantName,design.patchMaterial].filter(Boolean).join(' / ')],['Placement',design.placement==='Center'?'Center':`Wearer’s ${design.placement.toLowerCase()}`],['Hat starting price',money(design.hatStartingPrice)],['Finished hat price',state.priceCents!==null?money(state.priceCents/100):state.pricingError||(state.pricingEnabled?'Calculating price…':'Online purchasing is not enabled. Contact us for this design')]].forEach(([label,value])=>{
        const row=el('div','hat-builder-summary-row');row.append(el('span',null,label),el('strong',null,value));target.appendChild(row);
      });

    }
    byId('hat-builder-hat-image').addEventListener('load',applyPatchGeometry);
    byId('hat-builder-hat-image').addEventListener('error',()=>{
      byId('hat-builder-hat-image').classList.add('hidden');byId('hat-builder-patch-image').classList.add('hidden');byId('hat-builder-preview-empty').classList.remove('hidden');byId('hat-builder-enlarge').disabled=true;
      byId('hat-builder-preview-note').textContent='This photo is unavailable. Try another view or hat color.';
    });
    byId('hat-builder-patch-image').addEventListener('error',()=>{byId('hat-builder-patch-image').classList.add('hidden');byId('hat-builder-preview-note').textContent='The patch image is unavailable. Your selected design is still listed below.';});
    if(typeof ResizeObserver!=='undefined')new ResizeObserver(applyPatchGeometry).observe(byId('hat-builder-preview-stage'));
    [['hat-builder-next-patch',2],['hat-builder-next-preview',3],['hat-builder-next-cart',4],['hat-builder-back-hat',1],['hat-builder-back-patch',2],['hat-builder-back-preview',3]].forEach(([id,step])=>byId(id).addEventListener('click',()=>stepTo(step)));
    document.querySelectorAll('[data-builder-step]').forEach(button=>button.addEventListener('click',()=>stepTo(Number(button.dataset.builderStep))));
    byId('hat-builder-color-options').addEventListener('change',()=>{
      const variation=variations(state.hat).find(v=>key(v)===byId('hat-builder-color-options').value);
      if(!variation||qty(variation)<=0&&state.hat?.fulfillmentMode!=='made-to-order'){renderColors();return;}
      state.variation=variation;state.photo=0;renderColors();updateStock();updatePreview();
    });
    byId('hat-builder-patch-search').addEventListener('input',()=>{state.patchPage=1;renderPatches();});
    document.querySelectorAll('.hat-placement-button').forEach(button=>button.addEventListener('click',()=>{state.placement=button.dataset.placement;state.photo=0;updatePreview();}));
    byId('hat-mode-build').addEventListener('click',()=>setMode('build'));byId('hat-mode-shop').addEventListener('click',()=>setMode('shop'));
    document.querySelector('.hat-mode-switch').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const build=event.key==='Home'||event.key!=='End'&&byId('hat-mode-build').getAttribute('aria-selected')!=='true';setMode(build?'build':'shop');byId(build?'hat-mode-build':'hat-mode-shop').focus();}});
    byId('hat-builder-add-cart').addEventListener('click',()=>{if(!hasHat()||!hasPatch())return;try{saved=config();localStorage.setItem('br_hat_design_v1',JSON.stringify(saved));alert('Your hat design is saved on this device. You can come back to it and add it to your cart.');}catch(_){alert('Your browser couldn’t save this design. Please try again or add the finished hat to your cart.');}});
    byId('hat-custom-quote')?.addEventListener('click',()=>{sessionStorage.setItem('br_quote_context',JSON.stringify({type:'Hat',style:state.hat?.name||'',color:state.variation?.color||'',size:'One size',patchName:state.patch?.name||''}));});
    const dialog=byId('hat-builder-preview-dialog');
    byId('hat-builder-enlarge').addEventListener('click',()=>{
      const large=byId('hat-builder-large-stage');large.replaceChildren();
      for(const id of ['hat-builder-hat-image','hat-builder-patch-image']){const source=byId(id);if(!source.classList.contains('hidden')&&source.getAttribute('src')){const image=source.cloneNode(false);image.removeAttribute('id');large.appendChild(image);}}
      dialog.showModal();
    });
    byId('hat-builder-close-preview').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
    window.addEventListener('spc-products-ready',event=>renderHats(event.detail?.products,!!event.detail?.error));
    if(Array.isArray(window.spcProducts))renderHats(window.spcProducts);
    fetch(api()+'/store/config').then(r=>{if(!r.ok)throw new Error('Configuration unavailable');return r.json();}).then(c=>{state.pricingEnabled=!!c.builderPricingEnabled;requestPrice();if(state.step===4)renderSummary();}).catch(()=>{state.pricingError='Pricing could not load. Refresh and try again.';if(state.step===4)renderSummary();});
    byId('hat-builder-purchase').addEventListener('click',()=>{if(state.priceCents===null)return;try{window.brAddConfiguredHat(state.hat,state.variation,{patchId:state.patch.id,patchName:state.patch.name,patchVariantId:state.patchVariant.id,patchVariantName:state.patchVariant.name,patchMaterial:state.patchVariant.material||'',patchImage:state.patchVariant.imageUrl||state.patch.imageUrl,placement:state.placement,preview:{hatImage:resolveImage(images(state.variation,state.hat)[0]),patchImage:state.patch.resolvedImageUrl,patch:Object.fromEntries(Object.entries(state.patch).filter(([key])=>key==='widthInches'||key==='heightInches'||key.startsWith('preview')))}},state.priceCents);alert('Your configured hat was added to the cart.');}catch(e){alert(e.message);}});
    setMode(new URLSearchParams(window.location.search).get('mode')==='shop'?'shop':'build',false);stepTo(1,false);updatePreview();
  });
})();
