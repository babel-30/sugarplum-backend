'use strict';
const path=require('node:path');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeUrl(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}}
function renderEmail({subject='',text='',title,siteUrl='',contactEmail='brackishroots@gmail.com',ctaUrl,ctaLabel,key='',logoPath,logoSrc='cid:brackish-roots-logo'}){
 const clean=subject.replace(/^\[WEBSITE TEST\]\s*/,'').replace(/^Brackish Roots\s*[—–-]\s*/i,'');
 const heading=title||(/IN PRODUCTION/i.test(clean)?'Your order is in production':/Order.*:\s*SHIPPED$/i.test(clean)?'Your order is on its way':/Order.*:\s*READY$/i.test(clean)?'Your order is ready':clean);
 const found=String(text).match(/https?:\/\/[^\s<>]+/g)||[];
 let action=safeUrl(ctaUrl||found[0]);
 if(!action&&/^(request-owner:|approved:|paid-owner:|comment:)/.test(key)){const base=safeUrl(siteUrl);if(base)action=new URL('/admin#'+(key.startsWith('paid-owner:')?'orders':'projects'),base).href;}
 const label=ctaLabel||(action?.includes('/admin')?'Open admin dashboard':action?.includes('/project.html')?'Review your project':action?.includes('/private-shop.html')?'Visit your team shop':'View details');
 const rich=String(text).split(/\n\s*\n/).filter(Boolean).map(part=>'<p style="margin:0 0 18px;font-size:15px;line-height:1.75;color:#233E39;overflow-wrap:anywhere;">'+part.split('\n').map(line=>{
   const chunks=line.split(/(https?:\/\/[^\s<>]+)/g);return chunks.map(piece=>safeUrl(piece)?'<a href="'+escape(safeUrl(piece))+'" style="color:#285e58;text-decoration:underline;word-break:break-all;">'+escape(piece)+'</a>':escape(piece)).join('');
 }).join('<br>')+'</p>').join('');
 const button=action?'<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 20px;"><tr><td bgcolor="#233E39" style="border-radius:5px;"><a href="'+escape(action)+'" style="display:inline-block;padding:15px 24px;border:1px solid #233E39;border-radius:5px;font:700 15px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;">'+escape(label)+'</a></td></tr></table>':'';
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>'+escape(heading)+'</title></head><body style="margin:0;padding:0;background:#F3E7CF;font-family:Arial,Helvetica,sans-serif;">'+
 '<div style="display:none;font-size:1px;color:#F3E7CF;max-height:0;overflow:hidden;">'+escape(heading)+' · Brackish Roots</div>'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F3E7CF"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fffdf8;border:1px solid #d8c9ac;border-radius:8px;overflow:hidden;">'+
 '<tr><td align="center" bgcolor="#F3E7CF" style="padding:18px 24px 14px;"><img src="'+escape(logoSrc)+'" alt="Brackish Roots" width="100" height="100" style="display:block;width:100px!important;max-width:100px!important;height:100px!important;max-height:100px!important;object-fit:contain;border:0;"><p style="margin:12px 0 0;font-size:10px;line-height:1.6;letter-spacing:2px;font-weight:bold;color:#233E39;">ROOTED IN THE COAST. MADE FOR THE OUTDOORS.</p></td></tr>'+
 '<tr><td bgcolor="#233E39" style="padding:9px 24px;color:#ffffff;text-align:center;font-size:11px;letter-spacing:2px;">BRACKISH ROOTS · GULF COAST, MISSISSIPPI</td></tr>'+
 '<tr><td style="padding:30px 26px 18px;border-top:4px solid #D87935;"><h1 style="margin:0 0 22px;font-family:Georgia,Times New Roman,serif;font-weight:normal;font-size:29px;line-height:1.25;color:#233E39;">'+escape(heading)+'</h1>'+rich+button+
 '<div style="border-top:1px solid #e7ddcb;margin-top:28px;padding-top:18px;"><p style="margin:0;font-size:13px;line-height:1.7;color:#526a64;">Questions about your request or order? Reply to this email—we’re happy to help.</p></div></td></tr>'+
 '<tr><td align="center" bgcolor="#ede2cc" style="padding:22px 20px;"><p style="margin:0 0 7px;font-family:Georgia,Times New Roman,serif;font-size:19px;color:#233E39;">Brackish Roots</p><p style="margin:0 0 8px;font-size:12px;color:#435c55;">Thank you for supporting our small business.</p><a href="mailto:'+escape(contactEmail)+'" style="font-size:12px;color:#233E39;">'+escape(contactEmail)+'</a></td></tr></table></td></tr></table></body></html>';
 return {html,text:String(text),attachments:[{filename:'brackish-roots-logo.png',path:logoPath||path.join(__dirname,'assets/email-logo-transparent-100.png'),cid:'brackish-roots-logo',contentDisposition:'inline'}]};
}
module.exports={renderEmail};
