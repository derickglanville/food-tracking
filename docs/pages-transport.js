'use strict';
window.GatherTransport=(()=>{
 const config={apiKey:'AIzaSyC1s8rJbIlukPwvlDi8KnlAHyFjYiqFd14',authDomain:'glanville-issue-tracker.firebaseapp.com',projectId:'glanville-issue-tracker'};
 const allowedEmail='dglanville@gmail.com';
 const databaseRoot=`https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
 const root=`${databaseRoot}/food_tracker_meals`;
 const collectionRoot=name=>`${databaseRoot}/${name}`;
 const documentRoot=`projects/${config.projectId}/databases/(default)/documents/food_tracker_meals`;
 const enc=new TextEncoder(),dec=new TextDecoder();let token='',oldKey=null;
 const cacheMaxAge=12*60*60*1000;
 const cacheKey=collection=>'gather-firestore-cache-v1:'+collection;
 function cachedEntries(collection){
   try{const cached=JSON.parse(localStorage.getItem(cacheKey(collection))||'null');return cached&&Date.now()-cached.savedAt<cacheMaxAge&&Array.isArray(cached.entries)?cached.entries:null;}catch{return null;}
 }
 function writeCachedEntries(collection,entries){try{localStorage.setItem(cacheKey(collection),JSON.stringify({savedAt:Date.now(),entries}));}catch{}}
 function updateCachedEntry(collection,entry){const entries=cachedEntries(collection);if(!entries)return;writeCachedEntries(collection,[...entries.filter(item=>item.id!==entry.id),entry]);}
 function removeCachedEntry(collection,id){const entries=cachedEntries(collection);if(entries)writeCachedEntries(collection,entries.filter(item=>item.id!==id));}
 const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 function authInstance(){
   if(!firebase.apps.length)firebase.initializeApp(config);
   return firebase.auth();
 }
 async function acceptUser(user){
   if(!user || !user.emailVerified || (user.email||'').toLowerCase()!==allowedEmail){
     await authInstance().signOut();
     throw Error('Only '+allowedEmail+' can use this journal.');
   }
   try{token=await user.getIdToken();}catch(error){if(String(error.code||error.message).includes('securetoken'))throw Error('Google Token Service is blocked for this API key. Add Token Service API to the key restrictions, then sign in again.');throw error;}
   return true;
 }
 async function signIn(){
   const auth=authInstance();
   // Start the popup synchronously from the click, before any asynchronous work.
   const result=await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
   return acceptUser(result.user);
 }
 async function restoreSession(){
   const auth=authInstance();
   const user=await new Promise((resolve,reject)=>{
     const unsubscribe=auth.onAuthStateChanged(user=>{unsubscribe();resolve(user);},reject);
   });
   return user ? acceptUser(user) : false;
 }
 async function remote(method,path='',params={},body,collection='food_tracker_meals'){
   if(!token)throw Error('Sign in with Google before continuing.');
   const url=new URL((collection==='food_tracker_meals'?root:collectionRoot(collection))+path);Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
   const send=()=>fetch(url,{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});
   let response,refreshed=false;for(let attempt=0;attempt<4;attempt++){
     try{response=await send();}
     catch{throw Error('Cannot reach Firebase. Your change has not been confirmed. Check your connection.');}
     if(response.status===401&&!refreshed){
       const user=authInstance().currentUser;
       if(user){try{token=await user.getIdToken(true);refreshed=true;response=await send();}catch{throw Error('Your Google sign-in expired. Reload the app and sign in again.');}}
     }
     if(response.status!==429||attempt===3)break;
     await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
   }
   if(!response.ok){
     let detail='';try{detail=await response.text();}catch{}
     if(response.status===429)throw Error('Firebase is temporarily busy. Please wait a minute, then try again.');
     throw Error(`Firebase returned ${response.status}. ${detail.slice(0,160)||'Check Google sign-in and Firestore access.'}`);
   }
   return response.status===204?{}:response.json();
 }
 function fieldValue(value){return value.stringValue??value.booleanValue??value.integerValue??value.doubleValue??null;}
 function documentValue(doc){const entry={};for(const [name,value] of Object.entries(doc.fields||{}))entry[name]=fieldValue(value);entry.id=doc.name.split('/').pop();return entry;}
 function typedFields(entry){const fields={};for(const [name,value] of Object.entries(entry)){if(name==='id')continue;fields[name]=typeof value==='boolean'?{booleanValue:value}:{stringValue:String(value)};}return fields;}
 async function rawList(collection='food_tracker_meals'){const entries=[];let pageToken='';do{const page=await remote('GET','',{pageSize:1000,...(pageToken?{pageToken}:{})},undefined,collection);entries.push(...(page.documents||[]));pageToken=page.nextPageToken;}while(pageToken);return entries;}
 function localDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
 function daysBefore(value,count){const d=new Date(value+'T12:00:00');d.setDate(d.getDate()-count);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
 async function dateEntries(collection,start,end){
   if(!token)throw Error('Sign in with Google before continuing.');
   const filters=[];if(start)filters.push({fieldFilter:{field:{fieldPath:'date'},op:'GREATER_THAN_OR_EQUAL',value:{stringValue:start}}});if(end)filters.push({fieldFilter:{field:{fieldPath:'date'},op:'LESS_THAN_OR_EQUAL',value:{stringValue:end}}});
   const structuredQuery={from:[{collectionId:collection}],orderBy:[{field:{fieldPath:'date'},direction:'DESCENDING'}],limit:500};
   if(filters.length===1)structuredQuery.where=filters[0];else if(filters.length>1)structuredQuery.where={compositeFilter:{op:'AND',filters}};
   const response=await fetch(`${databaseRoot}:runQuery`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({structuredQuery})});
   if(!response.ok)throw Error(`Firebase returned ${response.status}. Check Google sign-in and Firestore access.`);
   return (await response.json()).filter(row=>row.document).map(row=>documentValue(row.document));
 }
 async function needsMigration(){
  if(!token)throw Error('Sign in with Google before continuing.');
  const response=await fetch(`${databaseRoot}:runQuery`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({structuredQuery:{from:[{collectionId:'food_tracker_meals'}],where:{fieldFilter:{field:{fieldPath:'schema'},op:'EQUAL',value:{stringValue:'gather-aes-gcm-v1'}}},limit:1}})});
  if(!response.ok)throw Error(`Firebase returned ${response.status}. Check Google sign-in and Firestore access.`);
  return (await response.json()).some(row=>row.document);
}
 async function oldEncryptionKey(code){const material=await crypto.subtle.importKey('raw',enc.encode(code),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:enc.encode('gather-v1|glanville-issue-tracker|food_tracker_meals'),iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);}
 async function migrate(code,progress=()=>{}){
   oldKey=await oldEncryptionKey(code);const documents=await rawList();const encrypted=documents.filter(doc=>documentValue(doc).schema==='gather-aes-gcm-v1');if(!encrypted.length)return;
   const converted=[];for(const doc of encrypted){const envelope=documentValue(doc),id=envelope.id;try{const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.nonce),additionalData:enc.encode(id)},oldKey,bytes(envelope.payload));converted.push({id,...JSON.parse(dec.decode(raw))});}catch{throw Error('The prior access code did not match. No records were changed.');}}
   for(let start=0;start<converted.length;start+=500){const batch=converted.slice(start,start+500);progress(`Saving ${Math.min(start+batch.length,converted.length)} of ${converted.length} meals…`);const response=await fetch(`${databaseRoot}:commit`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({writes:batch.map(entry=>({update:{name:`${documentRoot}/${entry.id}`,fields:typedFields(entry)}}))})});if(!response.ok){const detail=await response.text();throw Error(`Firebase returned ${response.status}: ${detail.slice(0,180)}`);}}
   oldKey=null;
 }
 function validate(data){const limits={date:10,mealType:20,meal:500,derickMeal:500,preparer:120,preparation:30,notes:1000,source:250};const result={};for(const [field,max] of Object.entries(limits)){const value=data[field]??'';if(typeof value!=='string'||value.length>max)throw Error(`Invalid ${field}.`);result[field]=value.trim();}if(!/^\d{4}-\d{2}-\d{2}$/.test(result.date)||isNaN(Date.parse(result.date))||new Date(result.date).toISOString().slice(0,10)!==result.date)throw Error('Choose a valid date.');if(!['Breakfast','Lunch','Dinner','Snack'].includes(result.mealType))throw Error('Choose a meal type.');if(!['Home cooked','Bought','Leftovers','Unspecified'].includes(result.preparation))throw Error('Choose a preparation type.');if(!result.meal&&!result.derickMeal)throw Error('Enter a meal for at least one person.');result.needsReview=!!data.needsReview;return result;}
 async function entriesForDate(date){return dateEntries('food_tracker_meals',date,date);}
 async function list(){
   const cached=cachedEntries('food_tracker_meals'),date=localDate();
   const base=cached||await dateEntries('food_tracker_meals',daysBefore(date,90),date);
   const freshToday=await entriesForDate(date);
   const entries=[...base.filter(entry=>entry.date!==date),...freshToday];
   writeCachedEntries('food_tracker_meals',entries);
   if(entries.some(entry=>entry.schema==='gather-aes-gcm-v1'))throw Error('Migration required before the journal can open.');
   return entries;
 }
 async function listTracker(collection,refresh=false){const cached=refresh?null:cachedEntries(collection);if(cached&&cached.length)return cached;const date=localDate(),entries=await dateEntries(collection,daysBefore(date,90),date);writeCachedEntries(collection,entries);return entries;}
 function validateTracker(data,kind){
   const date=String(data.date||'').trim();
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||isNaN(Date.parse(date)))throw Error('Choose a valid date.');
   if(kind==='health')return {date,distanceWalked:String(data.distanceWalked||'').trim().slice(0,30),distanceUnit:data.distanceUnit==='km'?'km':'miles',bloodPressure:String(data.bloodPressure||'').trim().slice(0,30),bloodSugar:String(data.bloodSugar||'').trim().slice(0,30),bloodSugarUnit:data.bloodSugarUnit==='mmol/L'?'mmol/L':'mg/dL',weight:String(data.weight||'').trim().slice(0,30),weightUnit:data.weightUnit==='kg'?'kg':'lb',waterIntake:String(data.waterIntake||'').trim().slice(0,30),waterUnit:['fl oz','mL'].includes(data.waterUnit)?data.waterUnit:'cups',waterNeedsReview:data.waterNeedsReview===true||data.waterNeedsReview==='true',bloodSugarNeedsReview:data.bloodSugarNeedsReview===true||data.bloodSugarNeedsReview==='true',weightNeedsReview:data.weightNeedsReview===true||data.weightNeedsReview==='true',bloodPressureNeedsReview:data.bloodPressureNeedsReview===true||data.bloodPressureNeedsReview==='true'};
   const bowelMovement=['Yes','No'].includes(data.bowelMovement)?data.bowelMovement:'',time=String(data.time||'').trim();
   if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Choose a valid time.');
   return {date,bowelMovement,time,notes:String(data.notes||'').trim().slice(0,300)};
 }
 async function saveTracker(collection,id,data){const entry={...data,id};await remote('PATCH','/'+id,{}, {fields:typedFields(entry)},collection);updateCachedEntry(collection,entry);return entry;}
 async function renamePreparer(from,to){
   if(from!=='Pat'||to!=='Georgette')throw Error('This update only supports the requested Pat to Georgette correction.');
   if(!token)throw Error('Sign in with Google before continuing.');
   const response=await fetch(`${databaseRoot}:runQuery`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({structuredQuery:{from:[{collectionId:'food_tracker_meals'}],where:{fieldFilter:{field:{fieldPath:'preparer'},op:'EQUAL',value:{stringValue:from}}},limit:500}})});
   if(!response.ok)throw Error(`Firebase returned ${response.status}. Check Google sign-in and Firestore access.`);
   const entries=(await response.json()).filter(row=>row.document).map(row=>({...documentValue(row.document),preparer:to}));
   for(let start=0;start<entries.length;start+=400){const batch=entries.slice(start,start+400);const saved=await fetch(`${databaseRoot}:commit`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({writes:batch.map(entry=>({update:{name:`${documentRoot}/${entry.id}`,fields:typedFields(entry)}}))})});if(!saved.ok)throw Error(`Firebase returned ${saved.status} while updating preparers.`);}
   const cached=cachedEntries('food_tracker_meals')||[];writeCachedEntries('food_tracker_meals',[...cached.filter(old=>!entries.some(entry=>entry.id===old.id)),...entries]);return entries;
 }
 async function importTracker(collection,kind,records){
   if(!Array.isArray(records)||!records.length||records.length>500)throw Error('Choose a valid wellness import file with up to 500 records.');
   const entries=records.map(item=>{const data=validateTracker(item,kind);return {...data,id:'wellness_'+data.date.replaceAll('-','')};});
   for(let start=0;start<entries.length;start+=400){
     const batch=entries.slice(start,start+400);
     const response=await fetch(`${databaseRoot}:commit`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({writes:batch.map(entry=>({update:{name:`projects/${config.projectId}/databases/(default)/documents/${collection}/${entry.id}`,fields:typedFields(entry)}}))})});
     if(!response.ok)throw Error(`Firebase returned ${response.status} while importing. No additional records were sent after this batch.`);
   }
   const cached=cachedEntries(collection)||[];writeCachedEntries(collection,[...cached.filter(old=>!entries.some(entry=>entry.id===old.id)),...entries]);return entries;
 }
 async function request(path,options={}){const method=options.method||'GET';if(path==='/api/logout'){token='';await firebase.auth().signOut();return {ok:true};}if(path==='/api/import-summary'){const response=await fetch('./import-summary.json');return response.json();}if(path==='/api/meals'&&method==='GET')return {meals:await list(),storageMode:'firebase'};if(path==='/api/meals/refresh-today'&&method==='GET')return {meals:await list(),storageMode:'firebase'};if(path==='/api/meals/rename-preparer'&&method==='POST')return {meals:await renamePreparer(JSON.parse(options.body).from,JSON.parse(options.body).to)};if(path.startsWith('/api/meals/date/')&&method==='GET'){const date=path.split('/').pop();if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Choose a valid date.');return {meals:await entriesForDate(date),storageMode:'firebase'};}for(const [kind,collection] of Object.entries({health:'food_tracker_health',wellness:'food_tracker_wellness'})){if(path==='/api/'+kind+'/refresh'&&method==='GET')return {records:await listTracker(collection,true)};if(path==='/api/'+kind&&method==='GET')return {records:await listTracker(collection)};if(path.startsWith('/api/'+kind+'/date/')&&method==='GET'){const date=path.split('/').pop();if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Choose a valid date.');return {records:await dateEntries(collection,date,date)};}if(path==='/api/'+kind+'/import'&&method==='POST')return {records:await importTracker(collection,kind,JSON.parse(options.body).records)};if(path.startsWith('/api/'+kind+'/')&&method==='PUT'){const id=path.split('/').pop();if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('Invalid record identifier.');return saveTracker(collection,id,validateTracker(JSON.parse(options.body),kind));}}const id=path.startsWith('/api/meals/')?path.split('/').pop():crypto.randomUUID().replaceAll('-','');if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('Invalid meal identifier.');if(method==='DELETE'){await remote('DELETE','/'+id);removeCachedEntry('food_tracker_meals',id);return {ok:true};}if(method==='POST'||method==='PUT'){const entry={...validate(JSON.parse(options.body)),id};if(method==='POST')entry.source='Manual entry';await remote('PATCH','/'+id,{'currentDocument.exists':method==='POST'?'false':'true'},{fields:typedFields(entry)});updateCachedEntry('food_tracker_meals',entry);return entry;}throw Error('Unsupported operation.');}
 async function exportCSV(){const fields=['date','mealType','meal','derickMeal','preparer','preparation','notes','source'];const cell=value=>{let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};const entries=await list();entries.sort((a,b)=>b.date.localeCompare(a.date));const csv='\uFEFF'+[fields.map(cell).join(','),...entries.map(e=>fields.map(f=>cell(e[f])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='meal-history.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return {signIn,restoreSession,needsMigration,migrate,request,exportCSV};
})();
