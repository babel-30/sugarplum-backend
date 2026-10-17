(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BrackishApparelPlacement=factory();})(typeof window==='object'?window:globalThis,function(){
'use strict';
const sides=['Pocket','Front','Back'];
function defaults(design,side){return {left:side==='Pocket'?65:50,top:side==='Pocket'?33:side==='Back'?45:48,width:Number(side==='Pocket'?design?.pocketWidthPercent||18:design?.previewWidthPercent||42)};}
function placement(design,side){return {...defaults(design,side),...design?.previewPlacements?.[side]};}
function clean(design){const out={};for(const side of sides){const p=placement(design,side);for(const [key,min,max] of [['left',0,100],['top',0,100],['width',5,90]]){const n=Number(p[key]);if(p[key]===null||p[key]===''||!Number.isFinite(n)||n<min||n>max)throw Object.assign(new Error(side+' preview '+key+' must be between '+min+' and '+max+' percent'),{status:400});p[key]=Math.round(n*100)/100;}out[side]=p;}return out;}
function selected(selection,side){return placement({previewWidthPercent:selection?.previewWidthPercent,pocketWidthPercent:selection?.previewWidthPercent,previewPlacements:{[side]:selection?.previewPlacement||{}}},side);}
function widthForImage(width,ratio){return Math.min(width,60*ratio);}
return {sides,defaults,placement,clean,selected,widthForImage};
});
