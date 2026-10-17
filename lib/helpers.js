const crypto=require('crypto');
const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
const token=()=>crypto.randomBytes(32).toString('hex');
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const text=(value,max=1000)=>String(value??'').trim().slice(0,max);
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
function integer(value,min,max,label='value'){const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw Object.assign(new Error(`Invalid ${label}`),{status:400});return n;}
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function safeEmail(value){const email=text(value,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('A valid email address is required');return email;}
function customer(input){
 const given=text(input?.firstName,120),family=text(input?.lastName,120);
 const name=given||family?[given,family].filter(Boolean).join(' '):text(input?.name,120);
 // Older clients still submit a full name. New cart fields preserve the customer's chosen name boundaries.
 const parts=name.split(/\s+/),firstName=given||family?given:parts.shift(),lastName=given||family?family:parts.join(' ');
 return {name,firstName,lastName,email:safeEmail(input?.email),phone:text(input?.phone,40),address1:text(input?.address1,150),address2:text(input?.address2,150),city:text(input?.city,100),state:text(input?.state,30).toUpperCase(),postalCode:text(input?.postalCode || input?.zip,20)};
}
const US_STATES=new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI AA AE AP'.split(' '));
function validateShippingLocation(buyer){
 if(!text(buyer.city,100)||!US_STATES.has(text(buyer.state,30).toUpperCase())||!/^\d{5}(-\d{4})?$/.test(text(buyer.postalCode,20)))fail('Enter a delivery city, valid two-letter US state or territory, and ZIP code (12345 or 12345-6789).');
}
function validateShippingAddress(buyer){validateShippingLocation(buyer);if(!text(buyer.address1,150))fail('Enter the delivery street address.');}
function quoteItems(input){if(!Array.isArray(input)||!input.length||input.length>100)fail('Add between 1 and 100 quote items');return input.map(item=>({id:text(item.id || id(),80),name:text(item.name,150),sourceProductId:text(item.sourceProductId,100),category:['Hats','Apparel','Patches','3D','Other'].includes(item.category)?item.category:'Other',quantity:integer(item.quantity,1,10000,'quantity'),unitPriceCents:integer(item.unitPriceCents,1,10000000,'unit price'),description:text(item.description,1000),mockupId:text(item.mockupId,80),colors:Array.isArray(item.colors)?item.colors.map(c=>text(c,60)).filter(Boolean).slice(0,50):[],sizes:Array.isArray(item.sizes)?item.sizes.map(c=>text(c,30)).filter(Boolean).slice(0,30):[]}));}
function verifySignature(raw,signature,key,url){if(!key||!signature)return false;const expected=crypto.createHmac('sha256',key).update(url+raw).digest('base64');const a=Buffer.from(signature),b=Buffer.from(expected);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
module.exports={validateShippingLocation,validateShippingAddress,equal,now,id,token,hash,text,money,integer,fail,safeEmail,customer,quoteItems,verifySignature};
