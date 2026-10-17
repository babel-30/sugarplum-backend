/* Reuse builder geometry for cart previews, including older saved cart items. */
(()=>{
 let patches;
 const api=()=>typeof API_BASE!=='undefined'?API_BASE:(window.BR_API_BASE||window.location.origin);
 const url=value=>{if(!value)return '';try{const u=new URL(value,api());return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}};
 const library=()=>patches||(patches=fetch((api())+'/patches').then(r=>r.ok?r.json():{}).then(d=>d.patches||[]).catch(()=>[]));
 window.brRenderCartPreviews=(container,items)=>{
  container.querySelectorAll('[data-cart-preview]').forEach(async node=>{
   const item=items[Number(node.dataset.cartPreview)],custom=item?.customHat;if(!custom)return;
   let preview=custom.preview;
   if(!preview){const patch=(await library()).find(p=>p.id===custom.patchId);const option=patch?.variants?.find(v=>v.id===custom.patchVariantId);preview={hatImage:item.image,patchImage:option?.imageUrl||custom.patchImage||patch?.imageUrl,patch:patch||{}};}
   if(!node.isConnected)return;
   const hat=node.querySelector('img'),patchSrc=url(preview.patchImage||custom.patchImage);if(!patchSrc||!window.BrackishHatTools)return;
   node.classList.add('cart-built-preview');hat.className='cart-preview-hat';hat.src=url(preview.hatImage||item.image)||hat.src;hat.alt=item.name+' — '+custom.patchName+' / '+(custom.patchVariantName||'Default')+', '+custom.placement+' placement';
   const overlay=document.createElement('img');overlay.className='cart-preview-patch';overlay.alt='';overlay.src=patchSrc;overlay.hidden=true;node.append(overlay);
   const place=()=>{if(!hat.naturalWidth||!hat.naturalHeight)return;const g=window.BrackishHatTools.geometry(item.name,preview.patch,custom.placement,hat.naturalWidth/hat.naturalHeight,node.clientWidth/node.clientHeight);Object.assign(overlay.style,{left:g.left+'%',top:g.top+'%',width:g.width+'%',height:g.height+'%'});overlay.hidden=false;};
   hat.addEventListener('load',place);overlay.addEventListener('error',()=>{overlay.hidden=true;node.title='Patch photo unavailable. See the selected design details.';});hat.addEventListener('error',()=>{overlay.hidden=true;});place();
   if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(()=>{if(!node.isConnected)observer.disconnect();else place();});observer.observe(node);}
  });
 };
})();
