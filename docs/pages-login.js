'use strict';
const googleButton=document.getElementById('google-button');
const loginError=document.getElementById('unlock-error');
let busy=false;
async function openJournal(){
  const response=await fetch('./app.html?v=health-navigation-auth-8');
  if(!response.ok)throw Error('The journal could not load. Please retry.');
  const parsed=new DOMParser().parseFromString(await response.text(),'text/html');
  document.body.className='';
  document.body.innerHTML=parsed.body.innerHTML;
  await new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='./static/app.js?v=health-navigation-auth-8';
    script.onload=resolve;
    script.onerror=()=>reject(Error('The journal script could not load.'));
    document.body.append(script);
  });
}
async function showJournal(){
  loginError.textContent='Checking your meal history…';
  if(await window.GatherTransport.needsMigration()){
    document.getElementById('google-login').hidden=true;
    document.getElementById('migration-form').hidden=false;
  }else await openJournal();
}
function report(error){
  loginError.textContent=error.code==='auth/popup-blocked'
    ? 'The Google window was blocked. Allow pop-ups for this site and press Continue again.'
    : (error.message||String(error));
}
googleButton.addEventListener('click',async()=>{
  if(busy)return;
  busy=true;googleButton.disabled=true;loginError.textContent='Opening Google. Choose your account in the sign-in window.';
  const timer=setTimeout(()=>{loginError.textContent='Still waiting for Google. If no window appeared, reload and allow pop-ups for this site.';},20000);
  try{
    await window.GatherTransport.signIn();
    clearTimeout(timer);
    await showJournal();
  }catch(error){report(error);}
  finally{clearTimeout(timer);busy=false;googleButton.disabled=false;}
});
document.getElementById('migration-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=document.getElementById('unlock-button'),status=document.getElementById('migration-error');
  button.disabled=true;status.textContent='Preparing your encrypted meals…';
  try{await window.GatherTransport.migrate(document.getElementById('code').value.trim(),text=>status.textContent=text);await openJournal();}
  catch(error){status.textContent=error.message;}
  finally{button.disabled=false;}
});
window.addEventListener('unhandledrejection',event=>report(event.reason));
window.addEventListener('error',event=>report(Error(event.message||'A page component failed to load.')));
if(window.GatherTransport){
  window.GatherTransport.restoreSession().then(async signedIn=>{
    if(signedIn&&!busy){busy=true;try{await showJournal();}finally{busy=false;}}
  }).catch(report);
}else report(Error('Sign-in files did not load. Reload this page.'));
