'use strict';
function optionalCents(value,label) {
 if(value==null||value==='')return null;
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<0||n>100000)throw Object.assign(new Error(`${label} must be between $0.00 and $1,000.00, in whole cents.`),{status:400});
 return n;
}
function patchPricing(p,settings={}) {
 return {
  customerPriceCents:optionalCents(Object.hasOwn(p,'customerPriceCents')?p.customerPriceCents:settings.builderPatchPrices?.[p.id], 'Customer patch price'),
  attachmentFeeCents:optionalCents(p.attachmentFeeCents,'Attachment charge'),
 };
}
function effectivePatchPricing(p,settings,variant) {
 const overrides=patchPricing(p,settings);
 return {patchCents:optionalCents(variant?.customerPriceCents,"Color patch price")??overrides.customerPriceCents??settings.builderPatchPriceCents,attachmentCents:optionalCents(variant?.attachmentFeeCents,"Color attachment charge")??overrides.attachmentFeeCents??settings.assemblyFeeCents};
}
module.exports={optionalCents,patchPricing,effectivePatchPricing};
