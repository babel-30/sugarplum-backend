'use strict';
const fs=require('fs/promises'),path=require('path'),sharp=require('sharp'),crypto=require('crypto');
const Placement=require('./apparel-placement');
const finite=(v,f)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):f;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function geometry(hatName,patch,placement,imageRatio=1,stageRatio=1){
 const calibration=/richardson\s*112/i.test(hatName)?{width:56,height:34,x:50,y:51}:{width:72,height:44,x:50,y:48};
 const prefix=placement==='Left'?'previewLeft':placement==='Right'?'previewRight':'previewCenter';
 const scale=clamp(finite(patch?.[prefix+'Scale'],placement==='Center'?finite(patch?.previewScale,1):1),.25,3);
 const offsetX=finite(patch?.[prefix+'OffsetX'],placement==='Center'?finite(patch?.previewOffsetX,0):0),offsetY=finite(patch?.[prefix+'OffsetY'],placement==='Center'?finite(patch?.previewOffsetY,0):0);
 const renderedWidth=imageRatio>=stageRatio?100:100*imageRatio/stageRatio,renderedHeight=imageRatio>=stageRatio?100*stageRatio/imageRatio:100;
 const shift=placement==='Left'?calibration.width*.25:placement==='Right'?-calibration.width*.25:0;
 return {width:Math.max(.25,finite(patch?.widthInches,3))/7*calibration.width*scale*renderedWidth/100,height:Math.max(.25,finite(patch?.heightInches,2))/3*calibration.height*scale*renderedHeight/100,left:(100-renderedWidth)/2+renderedWidth*(calibration.x+shift+offsetX*.5)/100,top:(100-renderedHeight)/2+renderedHeight*(calibration.y+offsetY*.5)/100};
}
function preview(item,patch,variation,product){const custom=item.customHat;
 return {hatImage:custom?.preview?.hatImage||item.image||variation?.images?.[0]||variation?.image||product?.image,patchImage:custom?.preview?.patchImage||custom?.patchImage||patch?.variants?.find(v=>v.id===custom?.patchVariantId)?.imageUrl||patch?.imageUrl,patchAlternates:[patch?.variants?.find(v=>v.id===custom?.patchVariantId)?.imageUrl,(patch?.variants?.length||0)<=1?patch?.imageUrl:null].filter(Boolean),patch:custom?.preview?.patch||patch||{}};
}
function loader({publicDir,patchDir,designDir}){const cache=new Map();return source=>{
 if(!source)return Promise.resolve(null);if(cache.has(source))return cache.get(source);
 const task=(async()=>{try{let bytes;let u=new URL(source,'http://localhost');if(u.pathname==='/media/photo'){const raw=u.searchParams.get('asset'),sig=crypto.createHmac('sha256',process.env.SESSION_SECRET||'').update(String(raw)).digest('hex');if(sig!==u.searchParams.get('sig'))return null;u=new URL(raw,'http://localhost');}

 if(u.origin==='http://localhost'||['localhost','127.0.0.1'].includes(u.hostname)||u.pathname.startsWith('/uploads/patches/')||u.pathname.startsWith('/apparel-art/')){
  const pathname=decodeURIComponent(u.pathname);let root,relative;
  if(pathname.startsWith('/uploads/patches/')){root=patchDir;relative=pathname.slice('/uploads/patches/'.length);}
  else if(pathname.startsWith('/apparel-art/')){root=designDir||path.join(patchDir,'..','..','apparel-artwork');relative=path.basename(pathname);}
  else if(pathname.startsWith('/assets/')){root=path.join(publicDir,'storefront','assets');relative=pathname.slice('/assets/'.length);}
  else return null;
  let target=path.resolve(root,relative);if(pathname.startsWith('/uploads/patches/')){try{await fs.stat(target);}catch{root=path.join(publicDir,'uploads','patches');target=path.resolve(root,relative);}}const real=await fs.realpath(target),base=await fs.realpath(root);if(!real.startsWith(base+path.sep))return null;const stat=await fs.stat(real);if(stat.size>20*1024*1024)return null;bytes=await fs.readFile(real);
 }else{
  // Only fetch trusted photo CDN hosts; never use arbitrary saved URLs as network targets.
  if(u.protocol!=='https:'||u.username||u.password||u.port&&!['443'].includes(u.port)||!['amazonaws.com','cloudfront.net','squarecdn.com','squareup.com','square.site','squarespace-cdn.com'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host)))return null;
  const response=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(5000)});if(!response.ok||Number(response.headers.get('content-length'))>20*1024*1024)return null;
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>20*1024*1024)throw new Error('Photo too large');chunks.push(chunk);}bytes=Buffer.concat(chunks);
 }
 return await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:700,height:700,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 }catch{return null;}})();cache.set(source,task);return task;
 };}
async function thumbnail(item,p,load){const [hat,initialArt]=await Promise.all([load(p.hatImage),item.customHat?load(p.patchImage):null]);if(!hat)return null;let art=initialArt;if(item.customHat&&!art)for(const source of p.patchAlternates||[]){art=await load(source);if(art)break;}
 p.patchAvailable=!!art;const side=360,meta=await sharp(hat).metadata(),canvas=await sharp(hat).resize(side,side,{fit:'contain',background:'#ffffff'}).png().toBuffer();if(!art)return canvas;
 const g=geometry(item.name,p.patch,item.customHat.placement,meta.width/meta.height,1),width=Math.max(1,Math.round(side*g.width/100)),height=Math.max(1,Math.round(side*g.height/100));
 let overlay=await sharp(art).resize(width,height,{fit:'contain',background:{r:255,g:255,b:255,alpha:0}}).png().toBuffer();let left=Math.round(side*g.left/100-width/2),top=Math.round(side*g.top/100-height/2);
 const x=Math.max(0,-left),y=Math.max(0,-top),w=Math.min(width-x,side-Math.max(0,left)),h=Math.min(height-y,side-Math.max(0,top));if(w<=0||h<=0)return canvas;
 if(x||y||w!==width||h!==height)overlay=await sharp(overlay).extract({left:x,top:y,width:w,height:h}).png().toBuffer();return sharp(canvas).composite([{input:overlay,left:Math.max(0,left),top:Math.max(0,top)}]).png().toBuffer();
}
async function apparelThumbnail(item,load,side){const a=item.customApparel,base=await load(side==='Back'?a.backImage:a.frontImage);if(!base)return null;const size=360,canvas=await sharp(base).resize(size,size,{fit:'contain',background:'#fff'}).png().toBuffer(),s=a.selections.find(s=>s.side===side);if(!s)return canvas;const art=await load(s.imageUrl);if(!art)return canvas;const g=Placement.selected(s,side),width=Math.round(size*g.width/100);let overlay=await sharp(art).resize({width,height:Math.round(size*.6),fit:'inside'}).png().toBuffer();const m=await sharp(overlay).metadata(),left=Math.round(size*g.left/100-m.width/2),top=Math.round(size*g.top/100-m.height/2);const x=Math.max(0,-left),y=Math.max(0,-top),w=Math.min(m.width-x,size-Math.max(0,left)),h=Math.min(m.height-y,size-Math.max(0,top));if(w<=0||h<=0)return canvas;if(x||y||w!==m.width||h!==m.height)overlay=await sharp(overlay).extract({left:x,top:y,width:w,height:h}).png().toBuffer();return sharp(canvas).composite([{input:overlay,left:Math.max(0,left),top:Math.max(0,top)}]).png().toBuffer();}
module.exports={geometry,preview,loader,thumbnail,apparelThumbnail};
