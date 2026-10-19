(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.BrackishPricingMath=value;})(typeof window==='object'?window:this,function(){
 'use strict';
 function number(value,label,max=1000000){const n=Number(value??'');if(!Number.isFinite(n)||n<0||n>max)throw Error('Enter a valid '+label);return n;}
 function money(value,label){const s=String(value??'').trim();if(s&&!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(s))throw Error('Use dollars and cents for '+label);return Math.round(number(s,label)*100);}
 function allocate(cents,weights){const total=weights.reduce((a,b)=>a+b,0);if(!total)return weights.map(()=>0);const raw=weights.map(w=>cents*w/total),values=raw.map(Math.floor);let rest=cents-values.reduce((a,b)=>a+b,0);const order=raw.map((v,i)=>({i,f:v-values[i]})).sort((a,b)=>b.f-a.f||a.i-b.i);for(let i=0;i<rest;i++)values[order[i].i]++;return values;}
 function calculate(rows,settings={}){
  if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('Add between 1 and 100 products');
  const hourly=money(settings.hourlyRate,'hourly rate'),fixed=money(settings.fixedFee,'fixed payment fee'),rate=number(settings.feePercent,'payment fee percentage',99)/100,margin=number(settings.targetMargin,'target profit margin',99)/100;
  if(rate+margin>=1)throw Error('Payment fee and target margin must total less than 100%');
  const quantities=rows.map(r=>{const q=number(r.quantity,'whole-number quantity',10000);if(!Number.isSafeInteger(q)||q<1)throw Error('Quantity must be a whole number of at least 1');return q;}),fixedShares=allocate(fixed,quantities);
  const lines=rows.map((r,i)=>{
   const q=quantities[i],blank=money(r.blankCost,'blank/material cost'),decoration=money(r.decorationCost,'decoration cost'),pack=money(r.packagingCost,'packaging'),other=money(r.otherCost,'other unit costs');
   const waste=Math.ceil((blank+decoration)*number(r.wastePercent,'waste allowance',100)/100),labor=Math.ceil(number(r.laborMinutes,'labor minutes',10000)*hourly/60),direct=blank+decoration+pack+other+waste+labor,overhead=Math.ceil(direct*number(r.overheadPercent,'overhead allowance',1000)/100);
   const costCents=(direct+overhead)*q+money(r.setupCost,'batch setup cost')+money(r.inboundShipping,'batch inbound freight');
   const feeRoundingBuffer=rate>0&&costCents+fixedShares[i]>0?1:0;
   const breakEvenCents=Math.ceil((costCents+fixedShares[i]+feeRoundingBuffer)/q/(1-rate)),suggestedCents=Math.ceil((costCents+fixedShares[i]+feeRoundingBuffer)/q/(1-rate-margin));
   const chosen=String(r.chosenPrice??'').trim();const unitPriceCents=chosen?money(chosen,'chosen selling price'):suggestedCents;
   if(!Number.isSafeInteger(costCents)||!Number.isSafeInteger(unitPriceCents*q)||unitPriceCents>10000000)throw Error('Calculated amount is too large');
   return {id:r.id,name:String(r.name||'Product'),quantity:q,costCents,unitPriceCents,breakEvenCents,suggestedCents,revenueCents:unitPriceCents*q,fixedFeeCents:fixedShares[i],usesSuggested:!chosen};
  });
  const revenueCents=lines.reduce((n,l)=>n+l.revenueCents,0),percentFee=Math.round(revenueCents*rate),percentageShares=allocate(percentFee,lines.map(l=>l.revenueCents));
  lines.forEach((l,i)=>{l.feeCents=l.fixedFeeCents+percentageShares[i];l.profitCents=l.revenueCents-l.costCents-l.feeCents;l.marginPercent=l.revenueCents?100*l.profitCents/l.revenueCents:null;l.belowTarget=l.revenueCents===0||l.profitCents/l.revenueCents+1e-10<margin;});
  const costCents=lines.reduce((n,l)=>n+l.costCents,0),feeCents=fixed+percentFee,profitCents=revenueCents-costCents-feeCents;
  if(![costCents,revenueCents,feeCents,profitCents].every(Number.isSafeInteger))throw Error('Calculation total is too large');
  return {lines,costCents,revenueCents,feeCents,profitCents,marginPercent:revenueCents?100*profitCents/revenueCents:null};
 }
 return {calculate};
});
