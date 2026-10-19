'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/storefront/script.js'),'utf8');
test('cart hides unconfirmed rates, coalesces loading, and recovers after settings failure',async()=>{
 const el=()=>({textContent:'',value:'MS'}),button=el(),status=el(),banner=el(),shipping=el(),fee=el(),tax=el(),total=el();let resolve,calls=0;
 const c={API_BASE:'https://test.example',cart:[{qty:1,price:22.5}],cartCountEl:null,cartTotalEl:null,cartSummaryItemsEl:null,cartSummarySubtotalEl:null,cartShippingEl:shipping,cartFeeEl:fee,cartTaxEl:tax,cartGrandTotalEl:total,freeShipBannerEl:banner,renderCartDetails(){},document:{querySelector:()=>({}),getElementById:id=>id==='checkout-btn'?button:id==='cart-rates-status'?status:null},console:{error(){}},AbortSignal,fetch:()=>{calls++;return new Promise(r=>{resolve=r;});}};
 vm.createContext(c);vm.runInContext("let cartSettingsStatus='loading',cartSettingsRequest=null,SHIPPING_FLAT_RATE=7.99,FREE_SHIPPING_THRESHOLD=75,CONVENIENCE_FEE_RATE=.03,SALES_TAX_RATE=.07,TAX_STATE='MS'; function computeShipping(subtotal){return subtotal>=FREE_SHIPPING_THRESHOLD?0:SHIPPING_FLAT_RATE;}",c);
 vm.runInContext(source.slice(source.indexOf('function cartEstimateTotals('),source.indexOf('// ========== STOCK STATUS HELPER')),c);
 vm.runInContext(source.slice(source.indexOf('function spcRecalcCartShipping('),source.indexOf('document.addEventListener("DOMContentLoaded", spcInitCartShipping)')),c);
 c.updateCartDisplay();assert.equal(shipping.textContent,'—');assert.equal(button.disabled,true);assert.match(banner.textContent,/Loading/);
 const pending=c.spcInitCartShipping(),duplicate=c.spcInitCartShipping();assert.equal(calls,1);resolve({ok:false});await Promise.all([pending,duplicate]);assert.equal(shipping.textContent,'—');assert.equal(button.disabled,false);assert.match(button.textContent,/Retry/);
 const retry=c.spcInitCartShipping();resolve({ok:true,json:async()=>({shippingFlatRate:5,freeShippingThreshold:40,convenienceFeePercent:3,salesTaxPercent:7,taxState:'MS'})});await retry;assert.equal(shipping.textContent,'$5.00');assert.equal(total.textContent,'$28.33');assert.match(banner.textContent,/17.50/);assert.equal(button.disabled,false);
 c.cart.push({qty:1,price:18});c.updateCartDisplay();assert.equal(shipping.textContent,'$0.00');assert.equal(total.textContent,'$41.72');assert.match(banner.textContent,/FREE shipping/);
});
