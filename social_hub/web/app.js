'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null,tab='dashboard',boot={},session=null,editing=null,noticeTimer;
const channels=['Facebook post','Instagram post','Instagram carosello','Instagram Reel','Instagram Story'];
const labels={draft:'Da approvare',scheduled:'In programma',processing:'Invio in corso',published:'Pubblicato',error:'Da correggere',uncertain:'Esito da verificare sul social',cancelled:'Annullato'};
function toast(message){$('notice').textContent=message;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').textContent='',12000)}
const hubBase=document.querySelector('meta[name="hub-base"]').content;
let sharedAuth=null;
async function loadScript(src){return new Promise((resolve,reject)=>{const tag=document.createElement('script');tag.src=src;tag.onload=resolve;tag.onerror=()=>reject(Error('Impossibile caricare il servizio di accesso'));document.head.appendChild(tag)})}
async function setupSharedAuth(){
 if(window.CREDIPASS_FIREBASE?.auth){sharedAuth=window.CREDIPASS_FIREBASE.auth;if(sharedAuth.app.options.projectId!==boot.project)throw Error('Progetto Firebase non corrispondente');return}
 if(!window.firebase)await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
 if(!firebase.auth)await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js');
 if(!firebase.apps.length)firebase.initializeApp({apiKey:boot.firebase_api_key,projectId:boot.project,authDomain:boot.project+'.firebaseapp.com'});
 if(firebase.app().options.projectId!==boot.project)throw Error('Il progetto di accesso non corrisponde alla Scheda Consulenza');
 sharedAuth=firebase.auth();
}
async function idToken(){return sharedAuth?.currentUser?sharedAuth.currentUser.getIdToken():''}
async function api(path,data){
 const token=await idToken();const headers={'X-Hub-Request':'1'};
 if(token)headers.Authorization='Bearer '+token;
 if(data!==undefined)headers['Content-Type']='application/json';
 const r=await fetch((boot.api_base||hubBase+'/api/')+path,{method:data===undefined?'GET':'POST',headers,body:data===undefined?undefined:JSON.stringify(data)});
 const v=await r.json();if(!r.ok)throw Error(v.error||'Operazione non riuscita');return v;
}
function showLogin(){$('login').hidden=false;$('workspace').hidden=true;$('identity').textContent=''}
async function load(){state=await api('state');$('workspace').hidden=false;$('login').hidden=true;render()}
function options(items,value){return items.map(x=>`<option value="${esc(x.id)}" ${x.id===value?'selected':''}>${esc(x.name)}</option>`).join('')}
function channelOptions(value){return channels.map(c=>`<option ${c===value?'selected':''}>${esc(c)}</option>`).join('')}
function officeName(id){return state.offices.find(o=>o.id===id)?.name||id}
function localTime(ts){const date=new Date(ts*1000);date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,16)}
function action(name,id,label,cls='secondary'){return `<button type="button" class="${cls}" data-action="${name}" data-id="${esc(id)}">${label}</button>`}
function render(){
 $('identity').innerHTML=`${esc(state.actor.name)}${boot.auth==='firebase'?action('logout','','Esci'):''}`;
 const tabs={dashboard:'Dashboard',archive:'Archivio',new:'Nuovo post',studio:'Creative Studio',calendar:'Calendario',offices:'Sedi',connections:'Collegamenti',members:'Utenti'};
 $('tabs').innerHTML=Object.entries(tabs).filter(([k])=>!['connections','members','offices'].includes(k)||state.actor.role==='admin').map(([k,v])=>`<button data-tab="${k}" class="${tab===k?'active':''}">${v}</button>`).join('');
 const renderers={dashboard,archive,new:postForm,studio,calendar,offices,connections,members};$('page').innerHTML=renderers[tab]();
}
function dashboard(){
 const counts=Object.keys(labels).map(k=>`<div class="card stat">${state.jobs.filter(j=>j.status===k).length}<small>${labels[k]}</small></div>`).join('');
 return `<h1>Centro operativo</h1><p>${state.status.auth==='local'?'Modalità locale: accesso dal tuo computer.':'Accesso Firebase: visibilità limitata alle sedi autorizzate.'}</p><div class="stats">${counts}</div><section><h2>Stato collegamenti</h2><p>Intelligenza artificiale: <b>${state.status.ai_configured?'chiave configurata':'da collegare'}</b> · Database: <b>${state.status.database==='firestore'?'Firebase Firestore':'locale'}</b></p><p>${state.connections.filter(c=>c.enabled).length} account social configurati. La pubblicazione parte soltanto per sedi abilitate e contenuti approvati o creati in modalità automatica.</p><p class="muted">Questi contatori descrivono la coda e gli esiti di invio. Le statistiche di visualizzazioni e interazioni dei social non sono incluse.</p></section><section><h2>Inizia da qui</h2><div class="actions">${action('go-studio','','Prepara un piano','')}${action('go-connections','','Configura i servizi')}</div><p>Un esito incerto resta fermo: verifica il social prima di creare un nuovo invio.</p></section>`;
}
function mediaPreview(p){return `<div class="media">${(p.previews||[]).map(m=>/^https:\/\/|^\/media\//.test(m)?(/\.(mp4|mov)(\?|$)/i.test(m)?`<video src="${esc(m)}" controls preload="none"></video>`:`<img src="${esc(m)}" loading="lazy" alt="Anteprima contenuto">`):'').join('')}</div>`}
function sources(p){return (p.sources||[]).filter(s=>s.url?.startsWith('https://')).map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title||s.url)}</a>`).join(' · ')}
function archive(){return `<h1>Archivio</h1><label>Cerca nei testi<input id="search" placeholder="Tema, titolo o parola"></label><label>Categoria<select id="category"><option value="">Tutte le categorie</option>${[...new Set(state.posts.map(p=>p.category||'Generale'))].map(c=>`<option>${esc(c)}</option>`).join('')}</select></label><div id="posts" class="grid">${postCards(state.posts)}</div>`}
function postCards(posts){return posts.map(p=>`<article class="card"><span class="badge">${esc(officeName(p.office_id))} · ${esc(p.category||'Generale')}</span><h2>${esc(p.title)}</h2><p>${esc(p.body).replace(/\n/g,'<br>')}</p>${mediaPreview(p)}<small>${sources(p)}</small><div class="actions">${action('edit-post',p.id,'Modifica')}${action('schedule',p.id,'Programma')}${state.status.ai_configured?action('image',p.id,'Genera immagine AI'):''}${action('export',p.id,'Esporta testo / TikTok')}</div></article>`).join('')||'<section>Nessun contenuto trovato.</section>'}
function postForm(){const p=state.posts.find(p=>p.id===editing);return `<section><h1>${p?'Modifica contenuto':'Crea un post'}</h1><form data-form="post" data-id="${esc(p?.id||'')}"><label>Sede<select name="office_id">${options(state.offices,p?.office_id)}</select></label><label>Titolo<input name="title" value="${esc(p?.title||'')}" maxlength="500" required></label><label>Testo<textarea name="body" maxlength="5000" required>${esc(p?.body||'')}</textarea></label><label>Link immagini o video, uno per riga<textarea name="media" placeholder="https://...">${esc((p?.media||[]).filter(m=>!m.startsWith('asset:')).join('\n'))}</textarea></label><label>Carica immagini<input name="files" type="file" accept="image/jpeg,image/png,image/webp" multiple></label>${p?.media.some(m=>m.startsWith('asset:'))?'<p>Le immagini già caricate restano associate al post.</p>':''}<button>Salva contenuto</button></form><p class="muted">Le programmazioni già create conservano il proprio testo: modificale nel calendario. La generazione di una nuova immagine rimette in approvazione le programmazioni ancora modificabili.</p></section>`}
function studio(){return `<section><h1>Creative Studio</h1><form data-form="plan"><label>Sede<select name="office_id">${options(state.offices)}</select></label><label>Tema<input name="topic" value="Mutui prima casa" maxlength="120" required></label><label>Preparazione<select name="engine"><option value="local">Spunti locali, senza servizi esterni</option value="ai" ${state.status.ai_configured?'':'disabled'}>AI: contenuti originali dall’archivio</option></select></label><label><input name="research" type="checkbox"> Ricerca web con fonti (modalità AI)</label><div class="grid"><label>Periodo<select name="days"><option value="7">Settimana</option><option value="30">30 giorni</option></select></label><label>Frequenza<select name="every"><option value="1">Ogni giorno</option><option value="2">Ogni 2 giorni</option><option value="3">Ogni 3 giorni</option><option value="7">Ogni settimana</option></select></label></div><label>Prima data<input name="start" type="date" value="${localTime(Date.now()/1000+86400).slice(0,10)}" required></label><label>Orario<input name="time" type="time" value="10:00" required></label><label>Canale<select name="channel">${channelOptions('Instagram post')}</select></label><button>Genera il piano</button></form><p>Il piano segue la modalità di approvazione impostata nella sede. I servizi AI usano la tua chiave API e possono avere costi. Le immagini si generano separatamente dall’archivio, una alla volta.</p></section><section><h2>Piani creati</h2>${state.plans.map(p=>`<p><b>${esc(p.topic)}</b> · ${p.count} post · ${esc(officeName(p.office_id))} · ${p.engine==='ai'?'AI':'spunti locali'}</p>`).join('')||'Nessun piano'}</section>`}
function calendar(){return `<section><h1>Programma un contenuto</h1><form data-form="job"><label>Post<select name="post_id" required>${state.posts.map(p=>`<option value="${esc(p.id)}" ${editing===p.id?'selected':''}>${esc(p.title)} · ${esc(officeName(p.office_id))}</option>`).join('')}</select></label><label>Sede<select name="office_id">${options(state.offices,state.posts.find(p=>p.id===editing)?.office_id)}</select></label><label>Canale<select name="channel">${channelOptions('Facebook post')}</select></label><label>Data e ora<input name="scheduled" type="datetime-local" required></label><button ${state.posts.length?'':'disabled'}>Aggiungi al calendario</button></form></section><h2>Coda editoriale</h2>${state.jobs.map(j=>`<section><span class="badge ${j.status==='published'?'success':''}">${esc(labels[j.status]||j.status)}</span><h3>${esc(j.title)}</h3><p>${esc(officeName(j.office_id))} · ${esc(j.channel)} · ${new Date(j.scheduled_at*1000).toLocaleString('it-IT')}</p>${j.last_error?`<p class="warn">${esc(j.last_error)}</p>`:''}<details><summary>Testo e gestione</summary><pre>${esc(j.body)}</pre>${j.remote_id?`<p>Conferma social: ${esc(j.remote_id)}</p>`:''}${['draft','scheduled','error','cancelled'].includes(j.status)?`<form data-form="edit-job" data-id="${esc(j.id)}"><label>Testo<textarea name="body" required>${esc(j.body)}</textarea></label><label>Nuova data<input name="scheduled" type="datetime-local" value="${localTime(j.scheduled_at)}" required></label><button>Salva e rimetti in approvazione</button></form>`:''}</details><div class="actions">${['draft','error','cancelled'].includes(j.status)&&j.channel!=='TikTok'?action('approve',j.id,'Approva invio',''):''}${['draft','scheduled','error'].includes(j.status)?action('cancel',j.id,'Annulla'):''}${j.published_url?.startsWith('https://')?`<a class="button secondary" href="${esc(j.published_url)}" target="_blank" rel="noopener noreferrer">Apri sul social</a>`:''}</div></section>`).join('')||'<p>Nessuna programmazione.</p>'}`}
function offices(){return `<h1>Sedi e regole editoriali</h1>${[...state.offices,{id:'',name:'',hashtag:'',signature:''}].map(o=>`<section><h2>${esc(o.name||'Aggiungi sede')}</h2><form data-form="office" data-id="${esc(o.id)}"><label>Nome<input name="name" value="${esc(o.name)}" required></label><label>Hashtag<input name="hashtag" value="${esc(o.hashtag)}"></label><div class="grid"><label>Telefono<input name="phone" value="${esc(o.phone)}"></label><label>WhatsApp<input name="whatsapp" value="${esc(o.whatsapp)}"></label></div><label>Firma aggiunta ai post<textarea name="signature">${esc(o.signature)}</textarea></label><label>Modalità<select name="editorial_mode"><option value="approvazione">Approvazione manuale</option><option value="automatica" ${o.editorial_mode==='automatica'?'selected':''}>Automatica per i nuovi contenuti</option></select></label><label><input name="publishing_enabled" type="checkbox" ${o.publishing_enabled?'checked':''}> Abilita gli invii reali per questa sede</label><p class="muted">Con modalità automatica, account collegato e invii abilitati, i nuovi contenuti entrano direttamente in programma. TikTok resta in esportazione assistita.</p><label>Feed RSS / Atom<input name="feed" type="url" value="${esc(o.feed)}" placeholder="https://..."></label><label><input name="auto_import" type="checkbox" ${o.auto_import?'checked':''}> Importa ogni 30 minuti mentre il server è attivo</label><button>Salva sede</button>${o.id?action('import',o.id,'Importa adesso'):''}</form>${o.import_error?`<p class="warn">${esc(o.import_error)}</p>`:''}</section>`).join('')}`}
function connections(){return `<h1>Collegamenti</h1><p>Sede Aversa: <a href="https://www.instagram.com/credipass.aversa/" target="_blank" rel="noopener">Instagram credipass.aversa</a> · <a href="https://www.facebook.com/profile.php?id=61595395165258" target="_blank" rel="noopener">Pagina Facebook</a>. Questi riferimenti non equivalgono a un’autorizzazione: collega gli account qui sotto.</p><section><h2>OpenAI</h2><p>${state.status.ai_configured?'Chiave configurata.':'Nessuna chiave configurata.'} Le chiavi sono cifrate sul server e non vengono mostrate agli utenti.</p>${boot.server_ai?'<p>OpenAI è gestito dal server della Scheda Consulenza. Non occorre inserire una nuova chiave.</p>':`<form data-form="keys"><label>Chiave API OpenAI<input name="openai" type="password" autocomplete="off" placeholder="Incolla una nuova chiave per salvarla" required></label><button>Salva chiave</button></form>`}</section><section><h2>Collega Facebook e Instagram</h2><form data-form="meta-keys"><label>ID applicazione Meta<input name="meta_app_id" required></label><label>Segreto applicazione Meta<input name="meta_app_secret" type="password" autocomplete="off" required></label><button>Salva configurazione Meta</button></form><form data-form="oauth"><label>Sede<select name="office_id">${options(state.offices)}</select></label><button ${state.status.meta_oauth_configured?'':'disabled'}>Autorizza su Facebook</button></form><p class="muted">Il collegamento guidato richiede l’app Meta e un indirizzo HTTPS configurati. Dopo l’autorizzazione scegli qui la pagina.</p>${action('meta-options','','Mostra pagine autorizzate')}<div id="metaOptions"></div></section><details><summary>Configurazione avanzata con token autorizzato</summary><form data-form="connection"><label>Sede<select name="office_id">${options(state.offices)}</select></label><label>Social<select name="platform"><option>Facebook</option><option>Instagram</option><option>LinkedIn</option></select></label><label>Nome riconoscibile<input name="name" required></label><label>ID account / autore LinkedIn<input name="external_id" required placeholder="ID numerico oppure urn:li:organization:..."></label><label>Token di accesso<input name="token" type="password" autocomplete="off" required></label><button>Collega account</button></form></details><section><h2>Account configurati</h2>${state.connections.map(c=>`<p><b>${esc(c.name)}</b> · ${esc(c.platform)} · ${esc(officeName(c.office_id))} · ${c.enabled?esc(c.state):'disabilitato'} ${c.enabled?action('disable-connection',c.id,'Disabilita'):''}</p>`).join('')||'Nessun account collegato'}</section><section><h2>Firebase e Scheda Consulenza</h2><p>Modalità: ${esc(state.status.auth)} · Database: ${esc(state.status.database)}.</p><p>Sul medesimo dominio il Social Hub riutilizza la sessione Firebase della Scheda Consulenza. Uscire disconnette entrambi i moduli. Il database editoriale usa un’area separata dalle pratiche.</p></section>`}
function members(){return `<section><h1>Accessi per sede</h1><p>${state.status.auth==='local'?'In modalità locale questi permessi si applicheranno quando attivi Firebase.':'Gli utenti accedono solo alle sedi assegnate. Gli amministratori della Scheda Consulenza mantengono il ruolo amministratore.'}</p><form data-form="member"><label>Utente della Scheda Consulenza${state.consultants?.length?`<select name="uid">${options(state.consultants)}</select>`:`<input name="uid" required placeholder="Identificativo utente Firebase">`}</label><label>Nome<input name="name" required></label><label>Sedi<select name="offices" multiple size="4">${options(state.offices)}</select></label><label><input name="enabled" type="checkbox" checked> Accesso Social Hub abilitato</label><button>Salva accesso</button></form></section><section>${state.members.map(m=>`<p><b>${esc(m.name)}</b> · ${m.enabled?'abilitato':'disabilitato'} · ${m.offices.map(officeName).map(esc).join(', ')} ${action('toggle-member',m.id,m.enabled?'Disabilita':'Abilita')}</p>`).join('')||'Nessun accesso configurato'}</section>`}
async function file64(file){if(file.size>15000000)throw Error('Massimo 15 MB per immagine');return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file)})}
document.addEventListener('submit',async event=>{
 const f=event.target;if(f.id==='loginForm')return;
 if(!f.dataset.form)return;event.preventDefault();const buttons=[...f.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
 const data=Object.fromEntries(new FormData(f));
 try{
  const type=f.dataset.form;
  if(type==='post'){
   const old=state.posts.find(p=>p.id===f.dataset.id);let media=[...(old?.media||[]).filter(m=>m.startsWith('asset:')),...data.media.split('\n').map(s=>s.trim()).filter(Boolean)];
   for(const file of f.elements.files.files){const r=await api('upload',{office_id:data.office_id,data:await file64(file)});media.push(r.media)}
   await api('post',{...data,id:f.dataset.id,media});editing=null;tab='archive';
  }else if(type==='plan'){
   const slots=[];for(let i=0;i<Number(data.days);i+=Number(data.every)){const date=new Date(data.start+'T'+data.time);date.setDate(date.getDate()+i);slots.push(date.toISOString())}
   toast(data.engine==='ai'?'Preparazione AI in corso. Può richiedere qualche minuto.':'Preparazione del piano…');
   const r=await api('plan',{...data,research:f.elements.research.checked,slots,request_id:crypto.randomUUID()});toast(r.created+' bozze create');tab='calendar';
  }else if(type==='job'){await api('job',{...data,scheduled:new Date(data.scheduled).toISOString()})}
  else if(type==='edit-job'){await api('job/action',{...data,id:f.dataset.id,action:'edit',scheduled:new Date(data.scheduled).toISOString()})}
  else if(type==='office'){await api('office',{...data,id:f.dataset.id,auto_import:f.elements.auto_import.checked,publishing_enabled:f.elements.publishing_enabled.checked})}
  else if(type==='keys'||type==='meta-keys'){await api('keys',data);f.reset()}
  else if(type==='connection'){await api('connection',data);f.reset()}
  else if(type==='member'){await api('member',{...data,offices:[...f.elements.offices.selectedOptions].map(o=>o.value),enabled:f.elements.enabled.checked})}
  else if(type==='oauth'){const r=await api('oauth/start',data);location.assign(r.url);return}
  if(type!=='plan')toast('Operazione completata');await load();
 }catch(e){toast(e.message)}finally{buttons.forEach(b=>b.disabled=false)}
});
document.addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.tab){tab=button.dataset.tab;editing=null;render();return}
 const action=button.dataset.action,id=button.dataset.id;if(!action)return;button.disabled=true;
 try{
  if(action==='logout'){if(sharedAuth)await sharedAuth.signOut();session=null;state=null;showLogin();return}
  if(action==='go-studio'||action==='go-connections'){tab=action==='go-studio'?'studio':'connections';render();return}
  if(action==='edit-post'||action==='schedule'){editing=id;tab=action==='edit-post'?'new':'calendar';render();return}
  if(action==='approve'||action==='cancel')await api('job/action',{id,action:action==='approve'?'approve':'cancel'});
  if(action==='image'){
   const p=state.posts.find(p=>p.id===id);const prompt=window.prompt('Descrivi l’immagine da generare (usa la tua API OpenAI):',p.image_prompt||'Immagine editoriale professionale sul tema '+p.title);
   if(!prompt)return;toast('Generazione immagine in corso…');await api('image',{id,prompt});
  }
  if(action==='export'){
   const p=state.posts.find(p=>p.id===id);const blob=new Blob([p.title+'\n\n'+p.body+'\n\nFonti:\n'+(p.sources||[]).map(s=>s.url).join('\n')],{type:'text/plain;charset=utf-8'});
   const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='post-credipass.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Testo esportato. Per TikTok carica manualmente anche i media dal tuo archivio.');return;
  }
  if(action==='import')await api('import',{office_id:id});
  if(action==='disable-connection')await api('connection/disable',{id});
  if(action==='toggle-member'){const m=state.members.find(m=>m.id===id);await api('member',{uid:id,name:m.name,offices:m.offices,enabled:!m.enabled})}
  if(action==='meta-options'){
   const result=await api('oauth/options');$('metaOptions').innerHTML=result.options.map(p=>`<p>${esc(p.name)} · ${esc(officeName(p.office_id))}<button data-action="meta-select" data-id="${esc(p.page_id)}" data-session="${esc(p.session)}">Associa questa pagina${p.instagram?' e Instagram':''}</button></p>`).join('')||'<p>Nessuna autorizzazione in attesa.</p>';return;
  }
  if(action==='meta-select')await api('oauth/select',{page_id:id,session:button.dataset.session});
  await load();toast('Operazione completata');
 }catch(e){toast(e.message)}finally{button.disabled=false}
});
function filterArchive(){if(!$('posts'))return;const query=$('search').value.toLocaleLowerCase('it'),cat=$('category').value;$('posts').innerHTML=postCards(state.posts.filter(p=>(p.title+' '+p.body).toLocaleLowerCase('it').includes(query)&&(!cat||(p.category||'Generale')===cat)))}
document.addEventListener('input',e=>{if(e.target.id==='search')filterArchive()});
document.addEventListener('change',e=>{if(e.target.id==='category')filterArchive()});
$('loginForm').addEventListener('submit',async e=>{
 e.preventDefault();const f=e.target,b=f.querySelector('button');b.disabled=true;
 try{
  await sharedAuth.signInWithEmailAndPassword(f.elements.email.value,f.elements.password.value);f.elements.password.value='';await load();
 }catch(e){toast(e.message)}finally{b.disabled=false}
});
(async()=>{try{boot=await api('bootstrap');if(boot.auth==='firebase'){await setupSharedAuth();sharedAuth.onAuthStateChanged(async user=>{state=null;if(user){try{await load()}catch(e){showLogin();toast(e.message)}}else showLogin()})}else await load()}catch(e){toast(e.message)}})();
// Refresh only the visible queue/dashboard, preserving unsaved edits elsewhere.
setInterval(async()=>{if(state&&['dashboard','calendar'].includes(tab)&&!document.querySelector('form:focus-within')){try{await load()}catch(_){}}},30000);
