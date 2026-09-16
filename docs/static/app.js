'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const formatDate = value => new Date(value+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
const icons = {Breakfast:'☀',Lunch:'◒',Dinner:'☾',Snack:'✧'};
let meals = [], filtered = [], healthRecords = [], wellnessRecords = [], healthLoaded = false, wellnessLoaded = false, currentView = 'dashboard', page = 0, loaded = false;
let selectedDay = today();
let lastTodayRefresh = 0;
const checkedMealDays = new Set();
const trackerRefreshTimes = new Map();
let calendarToday = today();
const titles = {dashboard:['Overview','One day at your table.','Breakfast, lunch, and dinner — together in one daily card.'],journal:['Meal journal','Your daily meal cards.','Move between days or choose a date to see the whole day.'],trends:['Trends','Your family’s food rhythm.','See how meals and preparation change over time.'],ideas:['Meal ideas','A little inspiration for your table.','Simple, colorful ideas to make your everyday meals feel fresh.'],health:['Daily health','Your daily health check.','Track activity and everyday measurements over time.'],wellness:['Daily wellness','Your daily wellness check.','A simple private record for each day.']};

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
  document.querySelector('.filters').hidden=['ideas','health','wellness'].includes(view);
  if(view==='health')loadTracker('health').then(()=>refreshTrackerDate('health',$('health-form').elements.date.value||today()));
  if(view==='wellness')loadTracker('wellness').then(()=>refreshTrackerDate('wellness',$('wellness-form').elements.date.value||today()));
  window.scrollTo({top:0,behavior:'smooth'});
}
async function loadTracker(kind){
  if(kind==='health'?healthLoaded:wellnessLoaded)return;
  try{
    const records=(await api('/api/'+kind)).records;
    if(kind==='health'){healthRecords=records;healthLoaded=true;}else{wellnessRecords=records;wellnessLoaded=true;}
    render();
  }catch(error){notice(error.message,true);}
}
async function refreshTrackerDate(kind,date,silent=true){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
  const key=kind+':'+date,now=Date.now();if(now-(trackerRefreshTimes.get(key)||0)<30000)return;
  trackerRefreshTimes.set(key,now);
  try{
    const records=(await api('/api/'+kind+'/date/'+date)).records;
    if(kind==='health'){healthRecords=[...healthRecords.filter(record=>record.date!==date),...records];renderHealth();}
    else{wellnessRecords=[...wellnessRecords.filter(record=>record.date!==date),...records];renderWellness();}
    if(!silent)notice(`${kind==='health'?'Daily health':'Daily wellness'} refreshed from Firebase.`);
  }catch(error){if(!silent)notice(error.message,true);}
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
  const days=availableDays();
  if(days.length&&!days.includes(selectedDay)) selectedDay=days[days.length-1];
  render();
}
function render() {
  $('stats').innerHTML=stats(filtered); $('trend-stats').innerHTML=stats(filtered);
  $('recent').innerHTML=dayCard();
  $('cooks').innerHTML=bars(Object.fromEntries(sortedCounts(group(knownCooks(filtered),'preparer')).slice(0,5)));
  renderJournal(); renderTrends(); renderIdeas(); renderHealth(); renderWellness();
}
function healthFor(date){return healthRecords.find(record=>record.date===date)||{};}
function wellnessFor(date){return wellnessRecords.find(record=>record.date===date)||{};}
function renderHealth(){
  const form=$('health-form');if(!form)return;
  const date=form.elements.date.value||today(),current=healthFor(date);
  const isNew=!current.id, defaults={date,distanceWalked:'',distanceUnit:'miles',waterIntake:'36',waterUnit:'fl oz',bloodSugar:'136',bloodSugarUnit:'mg/dL',weight:'212',weightUnit:'lb',bloodPressure:'126/89',waterNeedsReview:isNew,bloodSugarNeedsReview:isNew,weightNeedsReview:isNew,bloodPressureNeedsReview:isNew,...current};
  Object.entries(defaults).forEach(([key,value])=>{if(form.elements[key])form.elements[key].value=value;});
  const reviews={waterIntake:defaults.waterNeedsReview,bloodSugar:defaults.bloodSugarNeedsReview,weight:defaults.weightNeedsReview,bloodPressure:defaults.bloodPressureNeedsReview};Object.entries(reviews).forEach(([field,needed])=>form.elements[field]?.classList.toggle('needs-review',needed===true||needed==='true'));
  $('health-next').disabled=date>=today();
  const recent=[...healthRecords].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,7);
  $('health-history').innerHTML=recent.length?`<div class="table-scroll"><table><thead><tr><th>Date</th><th>Pressure</th><th>Sugar</th><th>Weight</th><th>Water</th></tr></thead><tbody>${recent.map(r=>`<tr><td>${formatDate(r.date)}</td><td>${escapeHtml(r.bloodPressure||'—')}</td><td>${escapeHtml(r.bloodSugar||'—')} ${escapeHtml(r.bloodSugar?r.bloodSugarUnit:'')}</td><td>${escapeHtml(r.weight||'—')} ${escapeHtml(r.weight?r.weightUnit:'')}</td><td>${escapeHtml(r.waterIntake||'—')} ${escapeHtml(r.waterIntake?r.waterUnit:'')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No health records saved yet.</div>';
}
function renderWellness(){
  const form=$('wellness-form');if(!form)return;
  const date=form.elements.date.value||today(),current=wellnessFor(date);
  Object.entries({date,bowelMovement:'',time:'',notes:'',...current}).forEach(([key,value])=>{if(form.elements[key])form.elements[key].value=value;});
  $('wellness-next').disabled=date>=today();
  const days=Array.from({length:7},(_,index)=>shiftDate(today(),index-6));
  $('wellness-week-grid').innerHTML=days.map(date=>{const record=wellnessFor(date),label=new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short'});return `<article class="wellness-day ${record.bowelMovement==='Yes'?'wellness-yes':record.bowelMovement==='No'?'wellness-no':'wellness-empty'}"><span>${label}</span><b>${record.bowelMovement||'—'}</b><small>${new Date(date+'T12:00:00').toLocaleDateString(undefined,{month:'numeric',day:'numeric'})}</small></article>`;}).join('');
  const recent=[...wellnessRecords].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,14);
  $('wellness-history').innerHTML=recent.length?`<div class="table-scroll"><table><thead><tr><th>Date</th><th>Bowel movement</th><th>Time</th><th>Notes</th></tr></thead><tbody>${recent.map(r=>`<tr><td>${formatDate(r.date)}</td><td>${escapeHtml(r.bowelMovement)}</td><td>${escapeHtml(r.time||'—')}</td><td>${escapeHtml(r.notes||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No wellness checks saved yet.</div>';
}
function shiftDate(value,amount) {
  const date=new Date(value+'T12:00:00'); date.setDate(date.getDate()+amount);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function hasMealFilters(){return !!($('search').value.trim()||$('type-filter').value||$('preparer-filter').value);}
function availableDays(){
  const range=$('period').value;
  const dates=meals.map(e=>e.date).concat(today());
  let first=range==='all'?dates.concat(selectedDay).sort()[0]:range==='custom'?($('from').value||dates.sort()[0]):shiftDate(today(),-Number(range)+1);
  let last=range==='all'?dates.sort().at(-1):range==='custom'?($('to').value||today()):today();
  if(hasMealFilters())return [...new Set(filtered.map(e=>e.date))].sort();
  const days=[];for(let d=first;d<=last;d=shiftDate(d,1))days.push(d);
  return days;
}
function dayCard(){
  const days=availableDays();
  if(!days.length)return '<div class="empty"><b>No days match these filters.</b>Clear your filters or return to today.<br><button class="secondary" data-day-today>Today</button></div>';
  const index=days.indexOf(selectedDay), entries=meals.filter(e=>e.date===selectedDay);
  const types=['Breakfast','Lunch','Dinner'];if(entries.some(e=>e.mealType==='Snack'))types.push('Snack');
  const complete=types.slice(0,3).filter(t=>entries.some(e=>e.mealType===t)).length;
  const label=new Date(selectedDay+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const matchIds=new Set(filtered.map(e=>e.id));
  return `<div class="day-navigation" aria-label="Day navigation"><button class="secondary" data-day-shift="-1" ${index<=0?'disabled':''}>← Previous day</button><label class="day-picker">Choose a day<input type="date" data-day-date value="${selectedDay}" aria-label="Choose a day"></label><button class="secondary" data-day-shift="1" ${index>=days.length-1?'disabled':''}>Next day →</button><button class="text-button" data-day-today>Today</button></div>
  <article class="day-card" data-date="${selectedDay}" aria-label="Meals for ${label}"><header class="day-card-header"><div><p class="eyebrow">${selectedDay===today()?'TODAY’S CARD':'DAILY MEAL CARD'}</p><h2>${label}</h2><p>${complete} of 3 meals recorded${hasMealFilters()?' · Showing the full day for your matching meals':''}</p></div><span class="day-progress" aria-label="${complete} of 3 meals recorded">${complete}/3</span></header>
  <div class="day-meals">${types.map(type=>{
    const rows=entries.filter(e=>e.mealType===type);
    return `<section class="day-meal" data-meal-type="${type}"><div class="day-meal-heading"><span class="meal-icon ${type}">${icons[type]}</span><h3>${type}</h3><span class="meal-state">${rows.length?'Recorded':'Not recorded'}</span></div>${rows.length?rows.map(e=>`<div class="day-entry"><h4>${escapeHtml(e.meal||'Main meal not recorded')}</h4>${e.derickMeal?`<p class="day-other"><b>Derick</b> ${escapeHtml(e.derickMeal.toLowerCase()==='same'?(e.meal||'Same (main meal not recorded)'):e.derickMeal)}</p>`:''}<p class="day-preparer">Prepared / bought by <b>${escapeHtml(e.preparer||'Not recorded')}</b></p>${e.notes?`<p class="day-notes">${escapeHtml(e.notes)}</p>`:''}${e.needsReview?'<span class="review-badge">Review preparer</span>':''}${hasMealFilters()&&matchIds.has(e.id)?'<span class="match-badge">Matches search</span>':''}<button class="secondary" data-edit="${escapeHtml(e.id)}" aria-label="Edit ${type} on ${selectedDay}">Edit ${type.toLowerCase()} ↗</button></div>`).join(''):`<div class="day-blank"><p>A space for your ${type.toLowerCase()}.</p><button class="secondary" data-day-add="${type}" data-date="${selectedDay}">＋ Add ${type.toLowerCase()}</button></div>`}</section>`;
  }).join('')}</div><div class="day-card-footer"><span>${entries.length} saved meal ${entries.length===1?'entry':'entries'} · ${hasMealFilters()?`${days.length} matching days`:'A fresh card is ready every day'}</span><button class="text-button" data-day-add="Snack" data-date="${selectedDay}">＋ Add snack</button></div></article>`;
}
function journalHistoryGrid(){
  const dates=Array.from({length:7},(_,index)=>shiftDate(selectedDay,-(index+1)));
  return `<section class="journal-history"><div class="panel-head"><div><h2>Previous daily meals</h2><p class="muted">Choose a card to open that day’s meal record.</p></div></div><div class="journal-day-grid">${dates.map(date=>{
    const entries=meals.filter(entry=>entry.date===date), label=new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
    const summary=['Breakfast','Lunch','Dinner'].map(type=>{const entry=entries.find(item=>item.mealType===type);return `<li><span>${icons[type]} ${type}</span><b>${escapeHtml(entry?(entry.meal||entry.derickMeal||'Recorded'):'—')}</b></li>`;}).join('');
    return `<button type="button" class="journal-day ${entries.length?'has-meals':''}" data-journal-day="${date}" aria-label="Open meals for ${label}"><header><span class="journal-day-date">${label}</span><strong class="journal-day-count">${entries.length}/3</strong></header><ul>${summary}</ul></button>`;
  }).join('')}</div></section>`;
}
function renderJournal() {
  $('journal-count').textContent=`${filtered.length.toLocaleString()} meal occasions · grouped by day`;
  $('journal-list').innerHTML=dayCard()+journalHistoryGrid();
}
async function loadMealDay(value){
  if(checkedMealDays.has(value))return;
  checkedMealDays.add(value);
  try{const data=await api('/api/meals/date/'+value);meals=[...meals.filter(entry=>entry.date!==value),...data.meals];sortMeals();updateOptions();applyFilters();}
  catch(error){checkedMealDays.delete(value);notice(error.message,true);}
}
function goToDay(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||isNaN(Date.parse(value)))return;
  selectedDay=value;
  $('search').value='';$('period').value='all';$('type-filter').value='';$('preparer-filter').value='';
  applyFilters();loadMealDay(value);
}
function checkNewDay(){
  const current=today();if(current===calendarToday)return;
  if(selectedDay===calendarToday)selectedDay=current;
  calendarToday=current;
  $('today-label').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  applyFilters();
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
function applyMeals(data){
  meals=data.meals;meals.forEach(entry=>checkedMealDays.add(entry.date));checkedMealDays.add(today());sortMeals();loaded=true;updateOptions();applyFilters();
}
async function load() {
  try {const data=await api('/api/meals');applyMeals(data);
    if(data.storageMode==='preview'){
      $('connection').textContent='Spreadsheet preview';$('sync-status').textContent='Read-only local preview';
      notice('Spreadsheet preview · Firebase import approval is pending. You can explore your history and meal ideas; changes cannot be saved yet.');
      $('save-meal').disabled=true;$('delete-meal').disabled=true;
    }else{$('connection').textContent='Connected to Firebase';$('sync-status').textContent='Synced with Firebase';}
  }
  catch(error){$('connection').textContent='Connection unavailable';notice(error.message,true);}
}
function sortMeals(){const order={Breakfast:0,Lunch:1,Dinner:2,Snack:3};meals.sort((a,b)=>b.date.localeCompare(a.date)||order[a.mealType]-order[b.mealType]);}
async function refreshToday(silent=false){
  if(Date.now()-lastTodayRefresh<60*1000)return;
  lastTodayRefresh=Date.now();
  const button=$('refresh-today');if(button)button.disabled=true;
  try{applyMeals(await api('/api/meals/refresh-today'));if(!silent)notice('Today’s meals refreshed from Firebase.');}
  catch(error){if(!silent)notice(error.message,true);}
  finally{if(button)button.disabled=false;}
}

document.addEventListener('click',event=>{
  const nav=event.target.closest('[data-view],[data-go]');if(nav)setView(nav.dataset.view||nav.dataset.go);
  if(event.target.closest('.add-meal'))openMeal({date:selectedDay});
  const dayAdd=event.target.closest('[data-day-add]');if(dayAdd)openMeal({date:dayAdd.dataset.date,mealType:dayAdd.dataset.dayAdd});
  const dayShift=event.target.closest('[data-day-shift]');if(dayShift){const days=availableDays();selectedDay=days[days.indexOf(selectedDay)+Number(dayShift.dataset.dayShift)]||selectedDay;render();}
  if(event.target.closest('[data-day-today]'))goToDay(today());
  const journalDay=event.target.closest('[data-journal-day]');if(journalDay)goToDay(journalDay.dataset.journalDay);
  const edit=event.target.closest('[data-edit]');if(edit)openMeal(meals.find(e=>e.id===edit.dataset.edit));
  const recipe=event.target.closest('[data-recipe]');if(recipe){const r=recipes[Number(recipe.dataset.recipe)];openMeal({meal:r.name,mealType:r.type,preparation:'Home cooked'});}
});
['search','period','type-filter','preparer-filter','from','to'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',applyFilters));
['diet','avoid'].forEach(id=>$(id).addEventListener(id==='avoid'?'input':'change',renderIdeas));
$('refresh-today').onclick=()=>refreshToday();
$('rename-pat').onclick=async()=>{const button=$('rename-pat');button.disabled=true;try{const updated=(await api('/api/meals/rename-preparer',{method:'POST',body:JSON.stringify({from:'Pat',to:'Georgette'})})).meals;meals=[...meals.filter(old=>!updated.some(entry=>entry.id===old.id)),...updated];sortMeals();updateOptions();applyFilters();notice(updated.length?`${updated.length} meal ${updated.length===1?'record was':'records were'} updated from Pat to Georgette.`:'No meal records prepared by Pat were found.');}catch(error){notice(error.message,true);}finally{button.disabled=false;}};
$('reset').onclick=()=>{$('search').value='';$('period').value='all';$('type-filter').value='';$('preparer-filter').value='';$('from').value='';$('to').value='';applyFilters();};
document.addEventListener('change',event=>{if(event.target.matches('[data-day-date]'))goToDay(event.target.value);});
setInterval(checkNewDay,30000);
function refreshActiveTracker(){if(currentView==='health')refreshTrackerDate('health',$('health-form').elements.date.value||today());if(currentView==='wellness')refreshTrackerDate('wellness',$('wellness-form').elements.date.value||today());}
window.addEventListener('focus',()=>{checkNewDay();refreshToday(true);refreshActiveTracker();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){checkNewDay();refreshToday(true);refreshActiveTracker();}});
$('close-dialog').onclick=()=>$('meal-dialog').close();
function clearHealthReview(field){const marker={waterIntake:'waterNeedsReview',waterUnit:'waterNeedsReview',bloodSugar:'bloodSugarNeedsReview',bloodSugarUnit:'bloodSugarNeedsReview',weight:'weightNeedsReview',weightUnit:'weightNeedsReview',bloodPressure:'bloodPressureNeedsReview'}[field];if(marker){const form=$('health-form');form.elements[marker].value='false';const inputField={waterUnit:'waterIntake',bloodSugarUnit:'bloodSugar',weightUnit:'weight'}[field]||field;form.elements[inputField]?.classList.remove('needs-review');}}
const autosaveTimers={};
function scheduleAutosave(form,canSave){
  clearTimeout(autosaveTimers[form.id]);
  if(!canSave())return;
  autosaveTimers[form.id]=setTimeout(()=>{if(form.dataset.saving!=='true'&&canSave()){form.dataset.automatic='true';form.requestSubmit();}},900);
}
$('meal-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target;if(form.dataset.saving==='true')return;form.dataset.saving='true';
  const automatic=form.dataset.automatic==='true';delete form.dataset.automatic;
  const data=Object.fromEntries(new FormData(form));data.needsReview=form.elements.namedItem('needsReview').checked;
  $('save-meal').disabled=true;$('delete-meal').disabled=true;$('form-error').textContent='';
  try {const entry=await api('/api/meals'+(data.id?'/'+data.id:''),{method:data.id?'PUT':'POST',body:JSON.stringify(data)});form.elements.namedItem('id').value=entry.id;meals=meals.filter(e=>e.id!==entry.id);meals.push(entry);selectedDay=entry.date;sortMeals();updateOptions();applyFilters();if(!automatic)$('meal-dialog').close();notice(automatic?'Meal saved automatically.':'Meal saved to Firebase.');}
  catch(error){$('form-error').textContent=error.message;}
  finally{delete form.dataset.saving;$('save-meal').disabled=false;$('delete-meal').disabled=false;}
};
$('delete-meal').onclick=async()=>{
  if(!confirm('Delete this meal entry from Firebase?'))return;
  const id=$('meal-form').elements.namedItem('id').value;$('delete-meal').disabled=true;$('save-meal').disabled=true;
  try{await api('/api/meals/'+id,{method:'DELETE'});meals=meals.filter(e=>e.id!==id);updateOptions();applyFilters();$('meal-dialog').close();notice('Meal deleted from Firebase.');}
  catch(error){$('form-error').textContent=error.message;}
  finally{$('delete-meal').disabled=false;$('save-meal').disabled=false;}
};
$('health-form').onsubmit=async event=>{event.preventDefault();const form=event.target;if(form.dataset.saving==='true')return;form.dataset.saving='true';const automatic=form.dataset.automatic==='true';delete form.dataset.automatic;const data=Object.fromEntries(new FormData(form)),id='health_'+data.date.replaceAll('-','');$('save-health').disabled=true;$('health-error').textContent='';try{const record=await api('/api/health/'+id,{method:'PUT',body:JSON.stringify(data)});healthRecords=healthRecords.filter(item=>item.id!==record.id);healthRecords.push(record);$('health-status').textContent=automatic?'Saved automatically.':'Saved to Firebase.';renderHealth();if(!automatic)notice('Daily health saved to Firebase.');}catch(error){$('health-error').textContent=error.message;}finally{delete form.dataset.saving;$('save-health').disabled=false;}};
$('wellness-form').onsubmit=async event=>{event.preventDefault();const form=event.target;if(form.dataset.saving==='true')return;form.dataset.saving='true';const automatic=form.dataset.automatic==='true';delete form.dataset.automatic;const data=Object.fromEntries(new FormData(form)),id='wellness_'+data.date.replaceAll('-','');$('save-wellness').disabled=true;$('wellness-error').textContent='';try{const record=await api('/api/wellness/'+id,{method:'PUT',body:JSON.stringify(data)});wellnessRecords=wellnessRecords.filter(item=>item.id!==record.id);wellnessRecords.push(record);$('wellness-status').textContent=automatic?'Saved automatically.':'Saved to Firebase.';renderWellness();if(!automatic)notice('Daily wellness check saved to Firebase.');}catch(error){$('wellness-error').textContent=error.message;}finally{delete form.dataset.saving;$('save-wellness').disabled=false;}};
$('meal-form').addEventListener('input',()=>scheduleAutosave($('meal-form'),()=>{const form=$('meal-form');return !!(form.elements.namedItem('meal').value.trim()||form.elements.namedItem('derickMeal').value.trim());}));
$('meal-form').addEventListener('change',()=>scheduleAutosave($('meal-form'),()=>{const form=$('meal-form');return !!(form.elements.namedItem('meal').value.trim()||form.elements.namedItem('derickMeal').value.trim());}));
['health-form','wellness-form'].forEach(id=>$(id).addEventListener('change',event=>{if(event.target.name==='date'){id==='health-form'?setHealthDate(event.target.value):setWellnessDate(event.target.value);return;}if(id==='health-form')clearHealthReview(event.target.name);scheduleAutosave($(id),()=>true);}));
['health-form','wellness-form'].forEach(id=>$(id).addEventListener('input',event=>{if(event.target.name!=='date'){if(id==='health-form')clearHealthReview(event.target.name);scheduleAutosave($(id),()=>true);}}));
$('health-status').textContent='Autosave is on.';$('wellness-status').textContent='Autosave is on.';
$('accept-health-defaults').onclick=()=>{const form=$('health-form');['waterNeedsReview','bloodSugarNeedsReview','weightNeedsReview','bloodPressureNeedsReview'].forEach(name=>form.elements[name].value='false');['waterIntake','bloodSugar','weight','bloodPressure'].forEach(name=>form.elements[name].classList.remove('needs-review'));scheduleAutosave(form,()=>true);};
function setHealthDate(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;$('health-form').elements.namedItem('date').value=date;renderHealth();refreshTrackerDate('health',date);}
$('health-previous').onclick=()=>setHealthDate(shiftDate($('health-form').elements.namedItem('date').value||today(),-1));
$('health-next').onclick=()=>setHealthDate(shiftDate($('health-form').elements.namedItem('date').value||today(),1));
$('health-today').onclick=()=>setHealthDate(today());
function setWellnessDate(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;$('wellness-form').elements.namedItem('date').value=date;renderWellness();refreshTrackerDate('wellness',date);}
$('wellness-previous').onclick=()=>setWellnessDate(shiftDate($('wellness-form').elements.namedItem('date').value||today(),-1));
$('wellness-next').onclick=()=>setWellnessDate(shiftDate($('wellness-form').elements.namedItem('date').value||today(),1));
$('wellness-today').onclick=()=>setWellnessDate(today());
$('refresh-wellness').onclick=async()=>{const button=$('refresh-wellness');button.disabled=true;try{wellnessRecords=(await api('/api/wellness/refresh')).records;wellnessLoaded=true;renderWellness();notice('Wellness history refreshed from Firebase.');}catch(error){$('wellness-error').textContent=error.message;}finally{button.disabled=false;}};
$('wellness-import').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  $('wellness-error').textContent='';$('save-wellness').disabled=true;
  try{
    const payload=JSON.parse(await file.text()),records=Array.isArray(payload)?payload:payload.records;
    const imported=(await api('/api/wellness/import',{method:'POST',body:JSON.stringify({records})})).records;
    wellnessRecords=[...wellnessRecords.filter(old=>!imported.some(entry=>entry.id===old.id)),...imported];wellnessLoaded=true;renderWellness();
    notice(`${imported.length} historical wellness records saved to Firebase.`);
  }catch(error){$('wellness-error').textContent=error.message;}
  finally{$('save-wellness').disabled=false;event.target.value='';}
};
$('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'});location.href=window.GatherTransport?'./':'/login';}catch(error){notice(error.message,true);}};
if(window.GatherTransport) document.querySelector('a[href="/api/export"]').onclick=async event=>{event.preventDefault();try{await window.GatherTransport.exportCSV();}catch(error){notice(error.message,true);}};
$('today-label').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
setView('dashboard');render();load();
api('/api/import-summary').then(s=>{if(s.count)$('import-note').textContent=`Imported ${s.count.toLocaleString()} meal entries from ${s.source}, ${formatDate(s.firstDate)}–${formatDate(s.lastDate)}. ${s.reviewCount} preparer values need review. ${s.warnings.filter(w=>w.startsWith('Duplicate')).length} repeated date/type entries were retained separately; source dates have not been corrected. “Same” means the main meal on that row. Main meal is the spreadsheet’s unlabeled food column. CSV exports the full history.`;}).catch(()=>{});
