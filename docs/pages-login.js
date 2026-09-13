'use strict';
async function openJournal(){
  const response=await fetch('./app.html');if(!response.ok)throw Error('The app could not load. Please refresh.');
  const documentCopy=new DOMParser().parseFromString(await response.text(),'text/html');
  document.body.className='';document.body.innerHTML=documentCopy.body.innerHTML;
  const script=document.createElement('script');script.src='./static/app.js';document.body.append(script);
}
document.getElementById('google-button').addEventListener('click',async()=>{
  const button=document.getElementById('google-button'),error=document.getElementById('unlock-error');button.disabled=true;error.textContent='';
  try{await window.GatherTransport.signIn();if(await window.GatherTransport.needsMigration()){document.getElementById('google-login').hidden=true;document.getElementById('migration-form').hidden=false;}else await openJournal();}
  catch(problem){error.textContent=problem.message;button.disabled=false;}
});
document.getElementById('migration-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=document.getElementById('unlock-button'),error=document.getElementById('migration-error');button.disabled=true;error.textContent='Preparing your encrypted meals…';
  try{await window.GatherTransport.migrate(document.getElementById('code').value,message=>error.textContent=message);await openJournal();}
  catch(problem){error.textContent=problem.message;button.disabled=false;}
});
