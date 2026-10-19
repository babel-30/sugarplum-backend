'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{calculate}=require('../public/pricing-math');
test('pricing includes labor, batch freight/setup, waste and overhead without confusing margin with markup',()=>{
 const result=calculate([{name:'Shirt',quantity:10,blankCost:'5.79',decorationCost:'2',packagingCost:'.50',otherCost:'.25',laborMinutes:3,wastePercent:10,overheadPercent:10,setupCost:10,inboundShipping:5}],{hourlyRate:20,feePercent:3,fixedFee:'.30',targetMargin:35});
 const line=result.lines[0];assert.equal(line.costCents,12860);assert(line.suggestedCents>line.costCents/10*1.35);assert(line.marginPercent>=35);assert.equal(result.feeCents,Math.round(result.revenueCents*.03)+30);assert.equal(result.profitCents,result.revenueCents-result.costCents-result.feeCents);
});
test('mixed products allocate one fixed fee exactly and chosen prices show losses without changing inputs',()=>{
 const input=[{name:'Hat',quantity:6,blankCost:7,chosenPrice:5},{name:'Bella',quantity:6,blankCost:5.79,chosenPrice:18},{name:'Gildan',quantity:8,blankCost:4,chosenPrice:15}],snapshot=JSON.stringify(input);const result=calculate(input,{fixedFee:'.30',feePercent:2.9,targetMargin:35});
 assert.equal(JSON.stringify(input),snapshot);assert.equal(result.lines.reduce((n,l)=>n+l.fixedFeeCents,0),30);assert.equal(result.lines.reduce((n,l)=>n+l.feeCents,0),result.feeCents);assert.equal(result.lines.reduce((n,l)=>n+l.profitCents,0),result.profitCents);assert(result.lines[0].profitCents<0);assert(result.lines[0].belowTarget);assert.equal(result.lines[1].unitPriceCents,1800);
});
test('suggested prices meet target after cent rounding and fees, including small quantities',()=>{
 for(const quantity of [1,3,17])for(const blankCost of ['.01','5.79','12.79'])for(const feePercent of [0,2.9,3,20]){const model=calculate([{quantity,blankCost}],{fixedFee:'.30',feePercent,targetMargin:35});assert(model.lines[0].marginPercent>=35);}
 const zero=calculate([{quantity:1}],{});assert.equal(zero.revenueCents,0);assert.equal(zero.marginPercent,null);
});
test('pricing rejects invalid quantities, money, nonfinite values and impossible margin assumptions',()=>{
 for(const quantity of [0,-1,1.5,Infinity])assert.throws(()=>calculate([{quantity}],{}));
 for(const blankCost of [-1,'garbage','NaN','1.234','1e3'])assert.throws(()=>calculate([{quantity:1,blankCost}],{}));
 assert.throws(()=>calculate([{quantity:1}],{feePercent:20,targetMargin:80}));assert.throws(()=>calculate([],{}));
});
