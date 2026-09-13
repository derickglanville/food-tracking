'use strict';
window.GatherTransport=(()=>{
 const config={apiKey:'AIzaSyC1s8rJbIlukPwvlDi8KnlAHyFjYiqFd14',authDomain:'glanville-issue-tracker.firebaseapp.com',projectId:'glanville-issue-tracker'};
 const allowedEmail='dglanville@gmail.com';
 const databaseRoot=`https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
 const root=`${databaseRoot}/food_tracker_meals`;
 const documentRoot=`projects/${config.projectId}/databases/(default)/documents/food_tracker_meals`;
 const enc=new TextEncoder(),dec=new TextDecoder();let token='',oldKey=null;
 const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 async function signIn(){
   if(!firebase.apps.length)firebase.initializeApp(config);
   const auth=firebase.auth();
   const user=auth.currentUser;
   if(!user){
     await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider());
     return false;
   }
   if(!user.emailVerified||user.email.toLowerCase()!==allowedEmail){await firebase.auth().signOut();throw Error(`Only ${allowedEmail} can use this journal.`);}
   token=await user.getIdToken();
   return true;
 }
 async function remote(method,path='',params={},body){
   if(!token)throw Error('Sign in with Google before continuing.');
   const url=new URL(root+path);Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
   let response;try{response=await fetch(url,{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});}
   catch{throw Error('Cannot reach Firebase. Your change has not been confirmed. Check your connection.');}
   if(!response.ok)throw Error(`Firebase returned ${response.status}. Check Google sign-in and Firestore access.`);
   return response.status===204?{}:response.json();
 }
 function fieldValue(value){return value.stringValue??value.booleanValue??value.integerValue??value.doubleValue??null;}
 function documentValue(doc){const entry={};for(const [name,value] of Object.entries(doc.fields||{}))entry[name]=fieldValue(value);entry.id=doc.name.split('/').pop();return entry;}
 function typedFields(entry){const fields={};for(const [name,value] of Object.entries(entry)){if(name==='id')continue;fields[name]=typeof value==='boolean'?{booleanValue:value}:{stringValue:String(value)};}return fields;}
 async function rawList(){const entries=[];let pageToken='';do{const page=await remote('GET','',{pageSize:1000,...(pageToken?{pageToken}:{})});entries.push(...(page.documents||[]));pageToken=page.nextPageToken;}while(pageToken);return entries;}
 async function needsMigration(){return (await rawList()).some(doc=>documentValue(doc).schema==='gather-aes-gcm-v1');}
 async function oldEncryptionKey(code){const material=await crypto.subtle.importKey('raw',enc.encode(code),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:enc.encode('gather-v1|glanville-issue-tracker|food_tracker_meals'),iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);}
 async function migrate(code,progress=()=>{}){
   oldKey=await oldEncryptionKey(code);const documents=await rawList();const encrypted=documents.filter(doc=>documentValue(doc).schema==='gather-aes-gcm-v1');if(!encrypted.length)return;
   const converted=[];for(const doc of encrypted){const envelope=documentValue(doc),id=envelope.id;try{const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.nonce),additionalData:enc.encode(id)},oldKey,bytes(envelope.payload));converted.push({id,...JSON.parse(dec.decode(raw))});}catch{throw Error('The prior access code did not match. No records were changed.');}}
   for(let start=0;start<converted.length;start+=500){const batch=converted.slice(start,start+500);progress(`Saving ${Math.min(start+batch.length,converted.length)} of ${converted.length} meals…`);const response=await fetch(`${databaseRoot}:commit`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({writes:batch.map(entry=>({update:{name:`${documentRoot}/${entry.id}`,fields:typedFields(entry)}}))})});if(!response.ok){const detail=await response.text();throw Error(`Firebase returned ${response.status}: ${detail.slice(0,180)}`);}}
   oldKey=null;
 }
 function validate(data){const limits={date:10,mealType:20,meal:500,derickMeal:500,preparer:120,preparation:30,notes:1000,source:250};const result={};for(const [field,max] of Object.entries(limits)){const value=data[field]??'';if(typeof value!=='string'||value.length>max)throw Error(`Invalid ${field}.`);result[field]=value.trim();}if(!/^\d{4}-\d{2}-\d{2}$/.test(result.date)||isNaN(Date.parse(result.date))||new Date(result.date).toISOString().slice(0,10)!==result.date)throw Error('Choose a valid date.');if(!['Breakfast','Lunch','Dinner','Snack'].includes(result.mealType))throw Error('Choose a meal type.');if(!['Home cooked','Bought','Leftovers','Unspecified'].includes(result.preparation))throw Error('Choose a preparation type.');if(!result.meal&&!result.derickMeal)throw Error('Enter a meal for at least one person.');result.needsReview=!!data.needsReview;return result;}
 async function list(){const entries=(await rawList()).map(documentValue);if(entries.some(entry=>entry.schema==='gather-aes-gcm-v1'))throw Error('Migration required before the journal can open.');return entries;}
 async function request(path,options={}){const method=options.method||'GET';if(path==='/api/logout'){token='';await firebase.auth().signOut();return {ok:true};}if(path==='/api/import-summary'){const response=await fetch('./import-summary.json');return response.json();}if(path==='/api/meals'&&method==='GET')return {meals:await list(),storageMode:'firebase'};const id=path.startsWith('/api/meals/')?path.split('/').pop():crypto.randomUUID().replaceAll('-','');if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('Invalid meal identifier.');if(method==='DELETE'){await remote('DELETE','/'+id);return {ok:true};}if(method==='POST'||method==='PUT'){const entry={...validate(JSON.parse(options.body)),id};if(method==='POST')entry.source='Manual entry';await remote('PATCH','/'+id,{'currentDocument.exists':method==='POST'?'false':'true'},{fields:typedFields(entry)});return entry;}throw Error('Unsupported operation.');}
 async function exportCSV(){const fields=['date','mealType','meal','derickMeal','preparer','preparation','notes','source'];const cell=value=>{let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};const entries=await list();entries.sort((a,b)=>b.date.localeCompare(a.date));const csv='\uFEFF'+[fields.map(cell).join(','),...entries.map(e=>fields.map(f=>cell(e[f])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='meal-history.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return {signIn,needsMigration,migrate,request,exportCSV};
})();
