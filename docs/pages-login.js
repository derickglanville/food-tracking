'use strict';
async function openJournal(){
  const response=await fetch('./app.html');if(!response.ok)throw Error('The app could not load. Please refresh.');
  const documentCopy=new DOMParsen().parseFromString(await response.text(),'text/html');
  document.body.className='';document.body.innerHTML=documentCopy.body.innerHTML;
  const script=document.createElement('script');script.src='./static/app.js';document.body.append(script);
}
let completingSignIn=false;
async function completeSignIn(){
  if(completingSignIn)return;completingSignIn=true;
  const button=document.getElementById('google-button'),error=document.getElementById('unlock-error');button.disabled=true;error.textContent='';
  try{const signedIn=await window.GatherTransport.signIn();if(!signedIn)return;if(await window.GatherTransport.needsMigration()){document.getElementById('google-login').hidden=true;document.getElementById('migration-form').hidden=false;}else await openJournal();}
  catch(problem){error.textContent=problem.message;button.disabled=false;}
  finally{completingSignIn=false;}
}
document.getElementById('google-button').addEventListener('click',completeSignIn);
if(!firebase.apps.length)firebase.initializeApp({apiKey:'AIzaSyDF04wZ5ikrhM8ko7Bk6-OkkSzAJ65VFvE',authDomain:'glanville-issue-tracker.firebaseapp.com',projectId:'glanville-issue-tracker'});
firebase.auth().onAuthStateChanged(user=>{if(user)completeSignIn();});
document.getElementById('migration-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=document.getElementById('unlock-button'),error=document.getElementById('migration-error');button.disabled=true;error.textContent='Preparing your encrypted meals…';
  try{await window.GatherTransport.migrate(document.getElementById('code').value,message=>error.textContent=message);await openJournal();}
  catch(problem){error.textContent=problem.message;button.disabled=false;}
});
