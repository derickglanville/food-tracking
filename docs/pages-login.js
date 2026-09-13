'use strict';
document.getElementById('unlock-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=document.getElementById('unlock-button');button.disabled=true;
  const error=document.getElementById('unlock-error');error.textContent='';
  try{
    await window.GatherTransport.unlock(document.getElementById('code').value.trim());
    const response=await fetch('./app.html');if(!response.ok)throw Error('The app could not load. Please refresh.');
    const documentCopy=new DOMParser().parseFromString(await response.text(),'text/html');
    document.body.className='';document.body.innerHTML=documentCopy.body.innerHTML;
    const script=document.createElement('script');script.src='./static/app.js';document.body.append(script);
  }catch(problem){error.textContent=problem.message;button.disabled=false;}
});
