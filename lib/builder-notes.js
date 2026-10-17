'use strict';
function builderNote(value){if(value==null||value==='')return '';if(typeof value!=='string'||value.length>250)throw Object.assign(new Error('Builder notes must be text of no more than 250 characters.'),{status:400});return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim();}
module.exports={builderNote};
