'use strict';
window.GatherTransport=(()=>{
 const root='https://firestore.googleapis.com/v1/projects/glanville-issue-tracker/databases/(default)/documents/food_tracker_meals';
 const apiKey='AIzaSyDF04WZ5ikrhM8ko7Bk6-OkkSzAJ65VFvE';
 const enc=new TextEncoder(),dec=new TextDecoder();let key=null;
 const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 const b64=data=>btoa(String.fromCharCode(...new Uint8Array(data)));
 async function decrypt(envelope,id){
   if(envelope.schema!=='gather-aes-gcm-v1')throw Error('A record needs encryption migration. Please contact the app owner.');
   return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.nonce),additionalData:enc.encode(id)},key,bytes(envelope.payload))));
 }
 async function unlock(code){
   const material=await crypto.subtle.importKey('raw',enc.encode(code),'PBKDF2',false,['deriveKey']);
   key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:enc.encode('gather-v1|glanville-issue-tracker|food_tracker_meals'),iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
   const response=await fetch('./unlock.json');if(!response.ok)throw Error('Cannot load the unlock settings. Please refresh.');
   try{const check=await decrypt(await response.json(),'gather-unlock');if(check.purpose!=='Gather unlock')throw Error();}
   catch{key=null;throw Error('That access code did not match. Please try again.');}
 }
 async function remote(method,path='',params={},body){
   const url=new URL(root+path);url.searchParams.set('key',apiKey);Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
   let response;try{response=await fetch(url,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
   catch{throw Error('Cannot reach Firebase. Your change has not been confirmed. Check your connection.');}
   if(!response.ok)throw Error(`Firebase returned ${response.status}. Your change has not been saved. Please retry or check database access.`);
   return response.status===204?{}:response.json();
 }
 async function list(){
   const all=[];let token='';
   do{const page=await remote('GET','',{pageSize:1000,...(token?{pageToken:token}:{})});
     const records=await Promise.all((page.documents||[]).map(async doc=>{
       const id=doc.name.split('/').pop(),envelope=Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,v.stringValue]));
       try{return {...await decrypt(envelope,id),id};}catch{throw Error('A meal record could not be decrypted. No records were changed.');}
     }));all.push(...records);token=page.nextPageToken;
   }while(token);return all;
 }
 function validate(data){
   const limits={date:10,mealType:20,meal:500,derickMeal:500,preparer:120,preparation:30,notes:1000,source:250};
   const result={};for(const [field,max] of Object.entries(limits)){const value=data[field]??'';if(typeof value!=='string'||value.length>max)throw Error(`Invalid ${field}.`);result[field]=value.trim();}
   if(!/^\d{4}-\d{2}-\d{2}$/.test(result.date)||isNaN(Date.parse(result.date))||new Date(result.date).toISOString().slice(0,10)!==result.date)throw Error('Choose a valid date.');
   if(!['Breakfast','Lunch','Dinner','Snack'].includes(result.mealType))throw Error('Choose a meal type.');
   if(!['Home cooked','Bought','Leftovers','Unspecified'].includes(result.preparation))throw Error('Choose a preparation type.');
   if(!result.meal&&!result.derickMeal)throw Error('Enter a meal for at least one person.');
   result.needsReview=!!data.needsReview;return result;
 }
 async function request(path,options={}){
   if(!key)throw Error('Unlock the app before continuing.');
   const method=options.method||'GET';
   if(path==='/api/logout'){key=null;return {ok:true};}
   if(path==='/api/import-summary'){const response=await fetch('./import-summary.json');return response.json();}
   if(path==='/api/meals'&&method==='GET')return {meals:await list(),storageMode:'firebase'};
   const id=path.startsWith('/api/meals/')?path.split('/').pop():crypto.randomUUID().replaceAll('-','');
   if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('Invalid meal identifier.');
   if(method==='DELETE'){await remote('DELETE','/'+id);return {ok:true};}
   if(method==='POST'||method==='PUT'){
     const entry={...validate(JSON.parse(options.body)),id};if(method==='POST')entry.source='Manual entry';
     const nonce=crypto.getRandomValues(new Uint8Array(12));
     const payload=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:enc.encode(id)},key,enc.encode(JSON.stringify(entry)));
     const envelope={schema:'gather-aes-gcm-v1',nonce:b64(nonce),payload:b64(payload)};
     await remote('PATCH','/'+id,{'currentDocument.exists':method==='POST'?'false':'true'},{fields:Object.fromEntries(Object.entries(envelope).map(([k,v])=>[k,{stringValue:v}]))});
     return entry;
   }
   throw Error('Unsupported operation.');
 }
 async function exportCSV(){
   const fields=['date','mealType','meal','derickMeal','preparer','preparation','notes','source'];
   const cell=value=>{let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
   const entries=await list();entries.sort((a,b)=>b.date.localeCompare(a.date));
   const csv='\uFEFF'+[fields.map(cell).join(','),...entries.map(e=>fields.map(f=>cell(e[f])).join(','))].join('\r\n');
   const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='meal-history.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return {unlock,request,exportCSV};
})();
