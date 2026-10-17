/* Admin calibration uses the same geometry and saved fields as customer/order previews. */
(() => {
  'use strict';
  let catalogRequest;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const number=(input,fallback=0)=>Number.isFinite(Number(input.value))?Number(input.value):fallback;
  function wire(root,patches){
    root.querySelectorAll('.patch-card').forEach(card=>{
      const details=card.querySelector('.patch-preview-settings');if(!details||details.dataset.calibrationReady)return;
      details.dataset.calibrationReady='true';details.classList.add('apparel-calibration');
      details.querySelector('summary').textContent='Adjust patch placement';
      details.querySelector('p').textContent='Adjust Center, wearer’s left and wearer’s right separately. Drag the patch, or use the fields and sliders. Changes apply after Save Changes and do not alter physical patch dimensions.';
      const patch=patches.find(p=>String(p.id)===card.dataset.id)||{};
      const label=node('label','Preview hat / color'),select=node('select');select.className='hat-calibration-base';
      select.append(new Option('Loading Square blank hats…',''));label.append(select);details.insertBefore(label,details.children[2]||null);
      const status=node('p');status.className='admin-help-text';status.setAttribute('role','status');details.insertBefore(status,label.nextSibling);
      const sides=[];
      for(const side of ['Center','Left','Right']){
        const prefix='.patch-edit-'+side.toLowerCase()+'-',scale=card.querySelector(prefix+'scale'),x=card.querySelector(prefix+'offset-x'),y=card.querySelector(prefix+'offset-y');
        if(!scale||!x||!y)continue;
        const fields=scale.parentElement.parentElement,section=fields.parentElement;section.classList.add('apparel-calibration-side');
        fields.style.gridTemplateColumns='minmax(0,1fr)';fields.style.gap='12px';
        const heading=section.firstElementChild;heading.textContent=side==='Center'?'Center placement':'Wearer’s '+side.toLowerCase()+' placement';
        const stage=node('div');stage.className='apparel-calibration-stage';stage.tabIndex=0;stage.setAttribute('aria-label',heading.textContent+' — use arrow keys to position patch');
        const base=node('img'),art=node('img'),placeholder=node('span','Choose a hat to preview');base.className='calibration-base';art.className='calibration-art';placeholder.className='calibration-placeholder';
        base.alt='Blank hat';art.alt='Patch placement preview';base.draggable=art.draggable=false;
        stage.append(base,art,placeholder);section.insertBefore(stage,heading.nextSibling);
        const currentPatch=()=>({...patch,widthInches:number(card.querySelector('.patch-edit-width'),3),heightInches:number(card.querySelector('.patch-edit-height'),2),['preview'+side+'Scale']:number(scale,100)/100,['preview'+side+'OffsetX']:number(x),['preview'+side+'OffsetY']:number(y)});
        const currentHat=()=>select.selectedOptions[0]?.hat;
        function draw(){const hat=currentHat();const source=hat&&(hat.v.images?.[0]||hat.v.image||hat.p.image);base.hidden=!source;placeholder.hidden=!!source;art.hidden=!source;
          if(source&&base.getAttribute('src')!==source)base.src=source;
          const sourceArt=card.querySelector('.option-image')?.value||card.querySelector('img')?.getAttribute('src')||patch.imageUrl;
          if(sourceArt&&art.getAttribute('src')!==sourceArt)art.src=sourceArt;
          const ratio=base.naturalWidth&&base.naturalHeight?base.naturalWidth/base.naturalHeight:1;
          const g=window.BrackishHatTools.geometry(hat?.p.name||'',currentPatch(),side,ratio,1);
          Object.assign(art.style,{left:g.left+'%',top:g.top+'%',width:g.width+'%',height:g.height+'%',objectFit:'contain'});
        }
        function dirty(){card.querySelector('.patch-card-status').textContent='Unsaved preview changes — click Save Changes.';}
        function set(input,value){input.value=String(Math.round(clamp(value,Number(input.min),Number(input.max))));input.dispatchEvent(new Event('input',{bubbles:true}));}
        for(const [input,name] of [[x,'Horizontal position'],[y,'Vertical position'],[scale,'Preview size (%)']]){
          input.setAttribute('aria-label',side+' '+name);const slider=node('input');slider.type='range';slider.min=input.min;slider.max=input.max;slider.step=input.step||'1';slider.value=input.value;slider.setAttribute('aria-label',side+' '+name+' slider');
          const wrap=node('div');wrap.className='calibration-value';input.parentNode.insertBefore(wrap,input);wrap.append(slider,input);
          slider.oninput=()=>set(input,Number(slider.value));input.addEventListener('input',()=>{slider.value=input.value;draw();dirty();});
        }
        const reset=node('button','Reset '+(side==='Center'?'Center':'Wearer’s '+side.toLowerCase())+' Placement');reset.type='button';reset.className='secondary calibration-reset';reset.onclick=()=>{set(scale,100);set(x,0);set(y,0);};section.append(reset);
        let drag=null;
        stage.onpointerdown=e=>{if(e.button!==0||!currentHat())return;drag={id:e.pointerId,clientX:e.clientX,clientY:e.clientY,x:number(x),y:number(y)};stage.setPointerCapture(e.pointerId);e.preventDefault();};
        stage.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;const rect=stage.getBoundingClientRect(),ratio=base.naturalWidth&&base.naturalHeight?base.naturalWidth/base.naturalHeight:1,rw=ratio>=1?100:100*ratio,rh=ratio>=1?100/ratio:100;
          set(x,drag.x+(e.clientX-drag.clientX)/rect.width*20000/rw);set(y,drag.y+(e.clientY-drag.clientY)/rect.height*20000/rh);
        };
        stage.onpointerup=stage.onpointercancel=stage.onlostpointercapture=()=>{drag=null;};
        stage.onkeydown=e=>{const input=['ArrowLeft','ArrowRight'].includes(e.key)?x:['ArrowUp','ArrowDown'].includes(e.key)?y:null;if(!input)return;e.preventDefault();set(input,number(input)+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)*(e.shiftKey?5:1));};
        base.onload=draw;art.onload=draw;base.onerror=()=>{base.hidden=art.hidden=true;placeholder.hidden=false;placeholder.textContent='Hat photo unavailable. Choose another hat / color.';};
        sides.push(draw);
      }
      select.onchange=()=>sides.forEach(draw=>draw());
      card.addEventListener('input',e=>{if(e.target.matches('.patch-edit-width,.patch-edit-height,.option-image'))sides.forEach(draw=>draw());});
      details.addEventListener('toggle',()=>{if(!details.open||select.dataset.loaded)return;
        catalogRequest??=adminFetch('/admin/business/catalog').then(r=>{if(!r.ok)throw new Error('Unable to load preview hats');return r.json();}).catch(e=>{catalogRequest=null;throw e;});
        catalogRequest.then(products=>{if(!card.isConnected)return;select.replaceChildren(new Option('Choose a Square blank hat',''));
          for(const p of products.filter(p=>p.category==='Hat Blanks'||p.collection==='Hat Blanks'))for(const v of p.variations||p.squareVariations||[]){const o=new Option(p.name+' — '+(v.color||v.name||'Default'),v.id);o.hat={p,v};select.append(o);}
          window.BrackishVariations?.decorate(select,products.flatMap(p=>p.variations||p.squareVariations||[]),'id');select.dataset.loaded='true';if(select.options.length>1)select.selectedIndex=1;else status.textContent='No Square blank hats are available for preview.';sides.forEach(draw=>draw());
        }).catch(e=>{select.replaceChildren(new Option('Preview unavailable',''));status.textContent=e.message+'. Close and reopen to retry.';});
      });
    });
  }
  window.BrackishHatPreviewAdmin={wire};
})();
