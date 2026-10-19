'use strict';
(()=>{
 let busy=false,queued=null,lastSuccess=null;
 function render(data){
  for(const [id,section]of Object.entries(data.sections||{})){
   const button=document.querySelector('.business-nav [data-tab="'+id+'"]');if(!button)continue;
   let badge=button.querySelector('.admin-attention-badge');
   if(!badge){badge=document.createElement('span');badge.className='admin-attention-badge';badge.setAttribute('aria-hidden','true');button.append(badge);button.dataset.attentionName=button.textContent.trim();}
   const count=Number(section.count);if(!Number.isSafeInteger(count)||count<0)continue;
   badge.textContent=String(count);badge.hidden=count===0;
   button.title=section.label;button.setAttribute('aria-label',button.dataset.attentionName+(count?' — '+count+' needing attention. '+section.label:''));
  }
 }
 async function refresh(){
  if(busy||document.hidden)return;busy=true;
  const status=document.getElementById('nav-attention-status');
  try{
   const response=await fetch('/admin/attention',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error('Attention counts unavailable');
   const data=await response.json();render(data);lastSuccess=data.updatedAt;
   if(status){status.textContent='Attention counts update automatically.';status.title='Last checked '+new Date(lastSuccess).toLocaleString()+'. Inventory follows the latest Square sync.';}
  }catch{
   if(status)status.textContent=lastSuccess?'Attention counts may be out of date. Retrying automatically.':'Attention counts unavailable. Retrying automatically.';
  }finally{busy=false;}
 }
 function schedule(){clearTimeout(queued);queued=setTimeout(refresh,800);}
 document.addEventListener('DOMContentLoaded',()=>{
  const nav=document.querySelector('.business-nav');if(!nav)return;
  const status=document.createElement('small');status.id='nav-attention-status';status.className='nav-attention-status';status.textContent='Checking attention counts…';nav.append(status);
  refresh();setInterval(refresh,30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('focus',schedule);
  document.addEventListener('click',event=>{if(event.target.closest('button'))schedule();});
  document.addEventListener('submit',schedule);
 });
})();
