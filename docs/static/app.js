'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const formatDate = value => new Date(value+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
const icons = {Breakfast:'☀',Lunch:'◒',Dinner:'☾',Snack:'✧'};
let meals = [], filtered = [], currentView = 'dashboard', page = 0, loaded = false;
const pageSize = 20;
const titles = {dashboard:['Overview','Your table, at a glance.','A little reflection. A little inspiration. A meal at a time.'],journal:['Meal journal','Every meal has a story.','Find a favorite, remember a meal, or see who made it.'],trends:['Trends','Your family’s food rhythm.','See how meals and preparation change over time.'],ideas:['Meal ideas','A little inspiration for your table.','Simple, colorful ideas to make your everyday meals feel fresh.']};

async function api(path, options = {}) {
  if(window.GatherTransport) return window.GatherTransport.request(path, options);
  let response;
  try { response = await fetch(path, {...options,headers:{'Content-Type':'application/json','X-Meal-Request':'1',...(options.headers||{})}}); }
  catch { throw Error('Connection lost. Your change has not been confirmed by Firebase. Try again when connected.'); }
  if(response.status === 401) { location.href='/login'; throw Error('Please unlock the app again.'); }
  const data = await response.json();
  if(!response.ok) throw Error(data.error || 'The request could not be completed.');
  return data;
}
function notice(message, bad=false) { $('notice').textContent=message; $('notice').className=bad?'bad':''; $('notice').hidden=false; }
function setView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view);
  document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  const [label,title,subtitle] = titles[view];
  $('page-label').textContent=label; $('page-title').textContent=title; $('page-subtitle').textContent=subtitle;
  document.querySelector('.filters').hidden=view==='ideas';
  window.scrollTo({top:0,behavior:'smooth'});
}
function group(items,key) { return items.reduce((counts,item)=>{const value=item[key]||'Unspecified'; counts[value]=(counts[value]||0)+1;return counts;},{}); }
function sortedCounts(counts) { return Object.entries(counts).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])); }
function knownCooks(items) { return items.filter(item=>item.preparer && !item.needsReview); }
function bars(counts) {
  const sorted = sortedCounts(counts), max = Math.max(1,...sorted.map(x=>x[1]));
  if(!sorted.length) return '<div class="empty">No recorded data for this selection.</div>';
  return sorted.map(([label,count])=>`<div class="bar-row"><div class="bar-label"><span>${escapeHtml(label)}</span><b>${count}</b></div><div class="bar-track" role="img" aria-label="${escapeHtml(label)}: ${count}"><div class="bar-fill" style="width:${count/max*100}%"></div></div></div>`).join('');
}
function stats(items) {
  const cooks=group(knownCooks(items),'preparer'), days=new Set(items.map(e=>e.date)).size;
  const values=[['Meals logged',items.length,'Meal occasions in this selection','▤'],['Days at the table',days,'Days with at least one entry','◫'],['Recorded preparers',Object.keys(cooks).length,'Includes joint preparer groups','♧'],['Preparer coverage',items.length?Math.round(knownCooks(items).length/items.length*100)+'%':'—','Entries with a known preparer','◉']];
  return values.map(([label,value,hint,icon])=>`<div class="stat"><div class="stat-top">${label}<span class="stat-icon">${icon}</span></div><strong>${value}</strong><small>${hint}</small></div>`).join('');
}
function row(entry) {
  const main=entry.meal||'Main meal not recorded';
  const other=entry.derickMeal ? `Derick: ${entry.derickMeal.toLowerCase()==='same' ? (entry.meal||'Same (main meal not recorded)') : entry.derickMeal}` : '';
  return `<article class="meal-row"><span class="meal-icon ${escapeHtml(entry.mealType)}" aria-hidden="true">${icons[entry.mealType]||'✧'}</span><div><div class="meal-title">${escapeHtml(main)}</div>${other?`<div class="meal-other">${escapeHtml(other)}</div>`:''}<div class="meal-meta"><span>${formatDate(entry.date)}</span><span>${escapeHtml(entry.mealType)}</span><span>${escapeHtml(entry.preparer||'Preparer not recorded')}</span>${entry.needsReview?'<span class="review-badge">Review preparer</span>':''}</div></div><button class="text-button" data-edit="${escapeHtml(entry.id)}" aria-label="Edit ${escapeHtml(entry.mealType)} on ${escapeHtml(entry.date)}">Edit ↗</button></article>`;
}
function empty() {return `<div class="empty"><b>${loaded?'No meals match this selection.':'Loading your meal journal…'}</b>${loaded?'Try a wider date range or clear the search.':'Connecting to Firebase.'}</div>`;}
function applyFilters() {
  const range=$('period').value, q=$('search').value.toLowerCase().trim(), type=$('type-filter').value, cook=$('preparer-filter').value;
  $('custom-dates').hidden=range!=='custom';
  let start='',end=today();
  if(range==='custom') {start=$('from').value; end=$('to').value;}
  else if(range!=='all') { const d=new Date(today()+'T12:00:00'); d.setDate(d.getDate()-Number(range)+1); start=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  else end='';
  filtered=meals.filter(e=>(!start||e.date>=start)&&(!end||e.date<=end)&&(!type||e.mealType===type)&&(!cook||(cook==='__missing'?!e.preparer:e.preparer===cook))&&(!q||[e.meal,e.derickMeal,e.preparer,e.mealType,e.notes].some(v=>(v||'').toLowerCase().includes(q))));
  page=0; render();
}
function render() {
  $('stats').innerHTML=stats(filtered); $('trend-stats').innerHTML=stats(filtered);
  $('recent').innerHTML=filtered.slice(0,5).map(row).join('')||empty();
  $('cooks').innerHTML=bars(Object.fromEntries(sortedCounts(group(knownCooks(filtered),'preparer')).slice(0,5)));
  renderJournal(); renderTrends(); renderIdeas();
}
function renderJournal() {
  $('journal-count').textContent=`${filtered.length.toLocaleString()} meal occasions · showing current filters`;
  $('journal-list').innerHTML=filtered.slice(page*pageSize,(page+1)*pageSize).map(row).join('')||empty();
  $('page-count').textContent=`Page ${page+1} of ${Math.max(1,Math.ceil(filtered.length/pageSize))}`;
  $('prev').disabled=page===0; $('next').disabled=(page+1)*pageSize>=filtered.length;
}
function renderTrends() {
  const monthly={};
  if(filtered.length){
    const dates=filtered.map(e=>e.date).sort();
    let cursor=new Date(dates[0].slice(0,7)+'-01T12:00:00'); const end=dates[dates.length-1].slice(0,7);
    while(true){const key=`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`; if(key>end)break; monthly[key]=0; cursor.setMonth(cursor.getMonth()+1);}
    filtered.forEach(e=>monthly[e.date.slice(0,7)]++);
  }
  const max=Math.max(1,...Object.values(monthly));
  $('monthly-chart').innerHTML=Object.entries(monthly).map(([month,count])=>`<div class="month"><b>${count}</b><div class="month-well"><div class="month-bar" style="height:${count/max*145}px" role="img" aria-label="${month}: ${count} meals"></div></div><span>${new Date(month+'-01T12:00:00').toLocaleDateString(undefined,{month:'short',year:'2-digit'})}</span></div>`).join('')||empty();
  $('type-chart').innerHTML=bars(group(filtered,'mealType')); $('prep-chart').innerHTML=bars(group(filtered,'preparation'));
  const cooks=sortedCounts(group(knownCooks(filtered),'preparer')).map(x=>x[0]);
  const months=Object.keys(monthly);
  const counts={};knownCooks(filtered).forEach(e=>{const key=e.preparer+'|'+e.date.slice(0,7);counts[key]=(counts[key]||0)+1;});
  $('preparer-history').innerHTML=cooks.length?`<table><thead><tr><th>Preparer</th>${months.map(m=>`<th>${m}</th>`).join('')}<th>Total</th></tr></thead><tbody>${cooks.map(c=>`<tr><td>${escapeHtml(c)}</td>${months.map(m=>`<td>${counts[c+'|'+m]||0}</td>`).join('')}<td>${group(knownCooks(filtered),'preparer')[c]}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">No known preparers in this selection.</div>';
}

const recipes=[
 {name:'Ginger chicken & rainbow vegetables',icon:'🥦',type:'Dinner',minutes:25,tags:[],ingredients:'Chicken breast, broccoli, carrots, bell pepper, brown rice, ginger, garlic, olive oil, lemon',allergens:[],why:'A familiar chicken dinner with a generous helping of vegetables and whole grains.',steps:['Cook brown rice according to the package.','Sauté sliced chicken with ginger and garlic until safely cooked through.','Add chopped vegetables and cook until tender-crisp. Serve with rice and lemon.']},
 {name:'Chickpea, cucumber & quinoa bowl',icon:'🥗',type:'Lunch',minutes:20,tags:['plant','vegetarian'],ingredients:'No-salt-added chickpeas, quinoa, cucumber, tomatoes, spinach, olive oil, lemon, parsley',allergens:[],why:'Beans bring plant protein to a bright bowl of greens, grains, and crunchy vegetables.',steps:['Cook quinoa and rinse canned chickpeas.','Chop cucumber, tomatoes, spinach, and parsley.','Combine with chickpeas and quinoa; dress with lemon and olive oil.']},
 {name:'Berry oats with plain yogurt',icon:'🫐',type:'Breakfast',minutes:10,tags:['vegetarian'],ingredients:'Rolled oats, plain yogurt, blueberries, strawberries, cinnamon',allergens:['milk','dairy'],why:'Give your usual oatmeal a fruit-filled refresh with whole grains and a protein food.',steps:['Cook oats in water following the package directions.','Top with plain yogurt and a generous portion of berries.','Add cinnamon; choose unsweetened ingredients.']},
 {name:'Lemon salmon & roasted greens',icon:'🍋',type:'Dinner',minutes:30,tags:[],ingredients:'Salmon, broccoli, green beans, brown rice, lemon, garlic, olive oil',allergens:['fish','seafood'],why:'Pair fish with whole-grain rice and plenty of roasted vegetables.',steps:['Cook brown rice.','Roast broccoli and green beans with olive oil and garlic.','Bake salmon until safely cooked through and serve with the vegetables, rice, and lemon.']},
 {name:'Veggie egg toast & fruit',icon:'🥑',type:'Breakfast',minutes:15,tags:['vegetarian'],ingredients:'Eggs, whole-grain bread, spinach, tomatoes, avocado, orange',allergens:['egg','eggs','wheat','gluten'],why:'A fresh take on an egg sandwich, with whole grains, vegetables, and fruit alongside.',steps:['Cook eggs thoroughly with chopped spinach and tomatoes.','Toast the whole-grain bread and add sliced avocado and eggs.','Serve with orange slices and extra tomatoes.']},
 {name:'Lentil & sweet potato stew',icon:'🍲',type:'Dinner',minutes:35,tags:['plant','vegetarian'],ingredients:'Lentils, sweet potato, carrots, kale, no-salt-added tomatoes, low-sodium vegetable broth, cumin, brown rice',allergens:[],why:'A hearty plant-based option with lentils, a variety of vegetables, and whole grains.',steps:['Simmer lentils, diced sweet potato, carrots, tomatoes, and cumin in broth until tender.','Stir in kale near the end.','Serve with a small side of brown rice.']},
 {name:'Tofu & crunchy vegetable stir-fry',icon:'🥕',type:'Dinner',minutes:20,tags:['plant','vegetarian'],ingredients:'Tofu, broccoli, bell pepper, carrots, quick-cooking brown rice, ginger, garlic, olive oil, lime',allergens:['soy','soya'],why:'Try a different protein while keeping the familiar comfort of a rice bowl.',steps:['Prepare the rice.','Brown cubed tofu with ginger and garlic.','Add vegetables and stir-fry until tender-crisp. Serve with rice and lime.']},
 {name:'Hummus, vegetables & whole-grain pita',icon:'🥒',type:'Lunch',minutes:10,tags:['plant','vegetarian'],ingredients:'Hummus, whole-grain pita, cucumber, carrots, tomatoes, spinach, lemon',allergens:['sesame','wheat','gluten'],why:'An easy assembly meal that adds vegetables and plant protein to a busy day.',steps:['Slice the vegetables into bite-sized pieces.','Spread hummus on the pita and fill with spinach, cucumber, and tomatoes.','Serve with carrots and a squeeze of lemon.']}
];
function renderIdeas() {
  const diet=$('diet').value, avoid=$('avoid').value.toLowerCase().split(/[,;]+/).map(s=>s.trim()).filter(Boolean);
  const recent=meals.filter(m=>m.date>=(()=>{let d=new Date();d.setDate(d.getDate()-14);return d.toISOString().slice(0,10);})());
  const recentText=recent.map(m=>m.meal+' '+m.derickMeal).join(' ').toLowerCase();
  const candidates=recipes.map((recipe,index)=>({...recipe,index})).filter(r=>(diet==='all'||(diet==='quick'?r.minutes<=20:r.tags.includes(diet)))&&!avoid.some(term=>(r.ingredients+' '+r.allergens.join(' ')).toLowerCase().includes(term)));
  candidates.sort((a,b)=>{const overlap=r=>r.name.toLowerCase().split(/\W+/).filter(w=>w.length>3&&recentText.includes(w)).length;return overlap(a)-overlap(b);});
  $('idea-context').textContent=`${candidates.length} ideas${recent.length?' · Less-repeated ingredients from the last 14 days appear first.':' · Start with something you enjoy.'} Times are approximate.`;
  $('recipe-grid').innerHTML=candidates.map(r=>`<article class="recipe-card"><div class="recipe-art" aria-hidden="true">${r.icon}</div><div class="recipe-body"><span class="recipe-tag">${r.type.toUpperCase()} · ABOUT ${r.minutes} MIN${r.tags.includes('plant')?' · PLANT-BASED':''}</span><h3>${r.name}</h3><p>${r.why}</p><details><summary>Ingredients & simple steps</summary><p>${r.ingredients}.</p><p>Listed allergens: ${r.allergens.join(', ')||'none in the listed base ingredients'}.</p><ol>${r.steps.map(s=>`<li>${s}</li>`).join('')}</ol></details><button class="secondary" data-recipe="${r.index}">Use this meal ＋</button></div></article>`).join('')||'<div class="empty">No ideas match these preferences. Try a different style or ingredient filter.</div>';
}
function openMeal(entry={}) {
  const form=$('meal-form');form.reset();
  const defaults={id:'',date:today(),mealType:'Dinner',meal:'',derickMeal:'',preparer:'',preparation:'Unspecified',notes:'',source:'Manual entry',...entry};
  Object.entries(defaults).forEach(([key,value])=>{if(form.elements.namedItem(key)) form.elements.namedItem(key).value=value;});
  form.elements.namedItem('needsReview').checked=!!entry.needsReview;
  $('form-title').textContent=entry.id?'Edit meal':'Log a meal';$('delete-meal').hidden=!entry.id;$('form-error').textContent='';
  $('meal-dialog').showModal();
}
function updateOptions() {
  const current=$('preparer-filter').value;
  const names=[...new Set(meals.map(e=>e.preparer).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  $('preparer-filter').innerHTML='<option value="">All preparers</option><option value="__missing">Not recorded</option>'+names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  if([...$('preparer-filter').options].some(o=>o.value===current))$('preparer-filter').value=current;
  $('preparer-options').innerHTML=names.map(n=>`<option value="${escapeHtml(n)}"></option>`).join('');
}
async function load() {
  try {const data=await api('/api/meals');meals=data.meals;sortMeals();loaded=true;updateOptions();applyFilters();
    if(data.storageMode==='preview'){
      $('connection').textContent='Spreadsheet preview';$('sync-status').textContent='Read-only local preview';
      notice('Spreadsheet preview · Firebase import approval is pending. You can explore your history and meal ideas; changes cannot be saved yet.');
      $('save-meal').disabled=true;$('delete-meal').disabled=true;
    }else{$('connection').textContent='Connected to Firebase';$('sync-status').textContent='Synced with Firebase';}
  }
  catch(error){$('connection').textContent='Connection unavailable';notice(error.message,true);}
}
function sortMeals(){const order={Breakfast:0,Lunch:1,Dinner:2,Snack:3};meals.sort((a,b)=>b.date.localeCompare(a.date)||order[a.mealType]-order[b.mealType]);}
document.addEventListener('click',event=>{
  const nav=event.target.closest('[data-view],[data-go]');if(nav)setView(nav.dataset.view||nav.dataset.go);
  if(event.target.closest('.add-meal'))openMeal();
  const edit=event.target.closest('[data-edit]');if(edit)openMeal(meals.find(e=>e.id===edit.dataset.edit));
  const recipe=event.target.closest('[data-recipe]');if(recipe){const r=recipes[Number(recipe.dataset.recipe)];openMeal({meal:r.name,mealType:r.type,preparation:'Home cooked'});}
});
['search','period','type-filter','preparer-filter','from','to'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',applyFilters));
['diet','avoid'].forEach(id=>$(id).addEventListener(id==='avoid'?'input':'change',renderIdeas));
$('reset').onclick=()=>{$('search').value='';$('period').value='all';$('type-filter').value='';$('preparer-filter').value='';$('from').value='';$('to').value='';applyFilters();};
$('prev').onclick=()=>{page--;renderJournal();};$('next').onclick=()=>{page++;renderJournal();};
$('close-dialog').onclick=()=>$('meal-dialog').close();
$('meal-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,data=Object.fromEntries(new FormData(form));data.needsReview=form.elements.namedItem('needsReview').checked;
  $('save-meal').disabled=true;$('delete-meal').disabled=true;$('form-error').textContent='';
  try {const entry=await api('/api/meals'+(data.id?'/'+data.id:''),{method:data.id?'PUT':'POST',body:JSON.stringify(data)});meals=meals.filter(e=>e.id!==entry.id);meals.push(entry);sortMeals();updateOptions();applyFilters();$('meal-dialog').close();notice('Meal saved to Firebase.');}
  catch(error){$('form-error').textContent=error.message;}
  finally{$('save-meal').disabled=false;$('delete-meal').disabled=false;}
};
$('delete-meal').onclick=async()=>{
  if(!confirm('Delete this meal entry from Firebase?'))return;
  const id=$('meal-form').elements.namedItem('id').value;$('delete-meal').disabled=true;$('save-meal').disabled=true;
  try{await api('/api/meals/'+id,{method:'DELETE'});meals=meals.filter(e=>e.id!==id);updateOptions();applyFilters();$('meal-dialog').close();notice('Meal deleted from Firebase.');}
  catch(error){$('form-error').textContent=error.message;}
  finally{$('delete-meal').disabled=false;$('save-meal').disabled=false;}
};
$('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'});location.href=window.GatherTransport?'./':'/login';}catch(error){notice(error.message,true);}};
if(window.GatherTransport) document.querySelector('a[href="/api/export"]').onclick=async event=>{event.preventDefault();try{await window.GatherTransport.exportCSV();}catch(error){notice(error.message,true);}};
$('today-label').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
render();load();
api('/api/import-summary').then(s=>{if(s.count)$('import-note').textContent=`Imported ${s.count.toLocaleString()} meal entries from ${s.source}, ${formatDate(s.firstDate)}–${formatDate(s.lastDate)}. ${s.reviewCount} preparer values need review. ${s.warnings.filter(w=>w.startsWith('Duplicate')).length} repeated date/type entries were retained separately; source dates have not been corrected. “Same” means the main meal on that row. Main meal is the spreadsheet’s unlabeled food column. CSV exports the full history.`;}).catch(()=>{});
