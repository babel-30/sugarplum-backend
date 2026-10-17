'use strict';
// Read-only. Prints location names/IDs, never the token or full SDK errors.
require('dotenv').config({quiet:true});
const {Client,Environment}=require('square/legacy');
const credential=process.env.SQUARE_ACCESS_TOKEN;
if(!credential){console.error('Set SQUARE_ACCESS_TOKEN privately in .env first.');process.exitCode=1;}else{
 const environment=process.env.SQUARE_ENVIRONMENT==='production'?'production':'sandbox';
 const client=new Client({accessToken:credential,environment:environment==='production'?Environment.Production:Environment.Sandbox});
 client.locationsApi.listLocations().then(response=>{console.log('Square environment: '+environment);console.table((response.result.locations||[]).map(location=>({name:location.name,id:location.id,status:location.status})));}).catch(error=>{const errors=error.result?.errors||error.errors||[];console.error('Square could not list locations. HTTP '+(error.statusCode||'unknown'));for(const issue of errors){const detail=String(issue.detail||'').split(credential).join('[redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]');console.error(String(issue.code||'ERROR')+': '+detail);}process.exitCode=1;});
}
