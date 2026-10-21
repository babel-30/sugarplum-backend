(function(root){
  'use strict';
  function imagesFor(variation,product){
    const clean=values=>[...new Set(values.filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];
    const images=clean(Array.isArray(variation.images)?variation.images:[]);
    return images.length?images:clean([variation.image||product.image||'assets/brackish-roots-logo.png']);
  }
  function show(container,variation,product){
    const images=imagesFor(variation,product),doc=container.ownerDocument;
    container.replaceChildren();
    const main=doc.createElement('img');main.id='detail-photo';
    const caption=doc.createElement('p');caption.className='product-photo-caption';caption.setAttribute('aria-live','polite');
    const controls=doc.createElement('div');controls.className='product-photo-options';controls.setAttribute('role','group');controls.setAttribute('aria-label','Product photos');
    const buttons=[];
    function select(index){main.src=images[index];main.alt=product.name+' — '+(variation.name||'selected option')+' — photo '+(index+1)+' of '+images.length;caption.textContent=images.length>1?'Photo '+(index+1)+' of '+images.length:'';buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));}
    if(images.length>1)images.forEach((source,index)=>{const button=doc.createElement('button');button.type='button';button.setAttribute('aria-label','View product photo '+(index+1));const thumb=doc.createElement('img');thumb.src=source;thumb.alt='';thumb.loading='lazy';button.append(thumb);button.onclick=()=>select(index);buttons.push(button);controls.append(button);});
    container.append(main,caption,controls);select(0);
  }
  const api={imagesFor,show};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.BrackishProductGallery=api;
})(typeof window!=='undefined'?window:globalThis);
