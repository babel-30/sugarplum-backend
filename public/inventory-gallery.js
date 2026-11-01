(() => {
  const dialog=document.createElement('dialog');
  dialog.className='inventory-gallery';
  dialog.setAttribute('aria-label','Product photos');
  dialog.innerHTML='<button type="button" class="gallery-close" aria-label="Close photos">Close ×</button><h2></h2><img class="gallery-image" alt=""><p class="gallery-caption"></p><p class="gallery-error" hidden>Photo could not load. Use the arrows to view another photo.</p><div class="gallery-controls"><button type="button" class="gallery-prev" aria-label="Previous photo">← Previous</button><span aria-live="polite"></span><button type="button" class="gallery-next" aria-label="Next photo">Next →</button></div>';
  document.body.append(dialog);
  let photos=[],index=0,opener;
  const img=dialog.querySelector('.gallery-image');
  function show(){const photo=photos[index];img.src=photo.url;img.alt=photo.label||'Product photo';dialog.querySelector('.gallery-caption').textContent=photo.label||'';dialog.querySelector('.gallery-controls span').textContent=`${index+1} of ${photos.length}`;dialog.querySelectorAll('.gallery-prev,.gallery-next').forEach(b=>b.disabled=photos.length<2);dialog.querySelector('.gallery-error').hidden=true;}
  function move(delta){index=(index+delta+photos.length)%photos.length;show();}
  img.addEventListener('error',()=>{dialog.querySelector('.gallery-error').hidden=false;});
  document.addEventListener('click',event=>{const button=event.target.closest('.inventory-photo');if(!button)return;try{photos=JSON.parse(button.dataset.photos).filter(p=>/^https?:\/\//i.test(p.url)||p.url.startsWith('/'));}catch{return;}if(!photos.length)return;opener=button;index=0;dialog.querySelector('h2').textContent=button.dataset.name;show();dialog.showModal();});
  dialog.querySelector('.gallery-close').onclick=()=>dialog.close();
  dialog.querySelector('.gallery-prev').onclick=()=>move(-1);
  dialog.querySelector('.gallery-next').onclick=()=>move(1);
  dialog.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}if(e.key==='ArrowRight'){e.preventDefault();move(1);}});
  dialog.addEventListener('close',()=>{img.removeAttribute('src');opener?.focus();});
})();
