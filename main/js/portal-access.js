(function(){
const app=firebase.initializeApp(firebase.app().options,'client-portal'),auth=app.auth(),fn=app.functions('us-central1');
const call=async(name,data)=>(await fn.httpsCallable(name)(data)).data;
let ready;
const deviceKey=id=>'credipass-device:'+id;
function getDevice(id){try{return localStorage.getItem(deviceKey(id))||'';}catch(_){return '';}}
function putDevice(id,value){try{if(value)localStorage.setItem(deviceKey(id),value);else localStorage.removeItem(deviceKey(id));return true;}catch(_){return false;}}
function deviceNotice(id){if(!getDevice(id)||document.getElementById('remembered-device-notice'))return;const el=document.createElement('div');el.id='remembered-device-notice';el.style.cssText='padding:10px 16px;background:#eef4fb;color:#173259;font:13px Arial,sans-serif;text-align:center';el.append(document.createTextNode('Dispositivo riconosciuto per 90 giorni. Non usare questa opzione su dispositivi condivisi. '));const b=document.createElement('button');b.type='button';b.textContent='Dimentica questo dispositivo';b.style.cssText='border:0;background:transparent;color:#002d72;text-decoration:underline;cursor:pointer;font:inherit';b.onclick=async()=>{const secret=getDevice(id);b.disabled=true;try{if(secret)await call('forgetClientDevice',{practiceId:id,secret});putDevice(id,'');el.remove();}catch(e){b.disabled=false;alert('Impossibile rimuovere il dispositivo. Riprova.');}};el.append(b);(document.querySelector('.upload-container')||document.body).prepend(el);}
async function remember(id){try{const r=await call('rememberClientDevice',{practiceId:id});if(putDevice(id,r.secret))deviceNotice(id);}catch(e){console.warn('Dispositivo non memorizzato:',e.code||e.message);}}

function hydrate(v){if(!v||typeof v!=='object')return v;if(Number.isFinite(v._seconds))return new firebase.firestore.Timestamp(v._seconds,v._nanoseconds||0);if(Array.isArray(v))return v.map(hydrate);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,hydrate(x)]));}
async function login(practiceId,kind='client'){
 await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
 const secret=new URLSearchParams(location.search).get('access');
 if(kind==='client'&&secret){try{const r=await call('exchangeClientLink',{practiceId,access:secret});await auth.signInWithCustomToken(r.token);await remember(practiceId);const u=new URL(location.href);u.searchParams.delete('access');history.replaceState(null,'',u.pathname+u.search);return;}catch(e){console.warn('Link scaduto: usa il codice email.');}}
 await new Promise(resolve=>{const off=auth.onAuthStateChanged(()=>{off();resolve();});});
 if(auth.currentUser){const t=await auth.currentUser.getIdTokenResult();if((kind==='client'&&t.claims.portal_practice===practiceId||kind==='agency'&&t.claims.agency_id)&&Date.now()/1000-t.claims.auth_time<86400){if(kind==='client')deviceNotice(practiceId);return;}await auth.signOut();}
 if(kind==='client'&&getDevice(practiceId)){try{const r=await call('exchangeClientDevice',{practiceId,secret:getDevice(practiceId)});await auth.signInWithCustomToken(r.token);deviceNotice(practiceId);return;}catch(e){if(['functions/permission-denied','permission-denied','functions/not-found'].includes(e.code))putDevice(practiceId,'');}}
 return new Promise(resolve=>{
 const modal=document.createElement('div');modal.style.cssText='position:fixed;inset:0;z-index:999999;background:#eef2f7;display:grid;place-items:center;padding:24px';
 modal.innerHTML='<form style="background:white;padding:32px;border-radius:20px;max-width:440px;width:100%;box-shadow:0 15px 50px #002d7218"><h1 style="font-size:24px;color:#002d72">Accesso riservato Credipass</h1><p>Inserisci l’email comunicata al consulente. Riceverai un codice per accedere in sicurezza.</p><label>Email<input type="email" required autocomplete="email" style="display:block;width:100%;padding:12px;margin:12px 0"></label><label hidden id="otp-label">Codice ricevuto<input inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="display:block;width:100%;padding:12px;margin:12px 0"></label><label id="remember-choice" style="display:block;margin:12px 0;font-size:13px"><input type="checkbox" checked> Ricorda questo dispositivo per 90 giorni. Non selezionare su un dispositivo condiviso.</label><button style="padding:12px;background:#002d72;color:white;border:0;border-radius:8px">Ricevi codice</button><button type="button" id="reset-code" style="background:#64748b">Cambia email / richiedi un nuovo codice</button><p role="status"></p></form>';
 document.body.appendChild(modal);const form=modal.querySelector('form'),button=form.querySelector('button'),status=form.querySelector('[role=status]'),inputs=form.querySelectorAll('input');let challenge;if(kind!=='client')form.querySelector('#remember-choice').hidden=true;
 form.querySelector('#reset-code').onclick=()=>{challenge=null;form.querySelector('#otp-label').hidden=true;inputs[1].required=false;inputs[1].value='';button.textContent='Ricevi codice';status.textContent='Puoi richiedere un nuovo codice dopo un minuto.';};
 form.onsubmit=async e=>{e.preventDefault();button.disabled=true;try{if(!challenge){const r=await call('requestPortalCode',{email:inputs[0].value,practiceId,kind});challenge=r.challenge;status.textContent=r.message;form.querySelector('#otp-label').hidden=false;inputs[1].required=true;button.textContent='Accedi';inputs[1].focus();}else{const r=await call('verifyPortalCode',{challenge,code:inputs[1].value});await auth.signInWithCustomToken(r.token);if(kind==='client'&&form.querySelector('#remember-choice input').checked)await remember(practiceId);modal.remove();resolve();}}catch(e){status.textContent=e.message||'Accesso non riuscito';}finally{button.disabled=false;}};
 });
}
const get=id=>async()=>{await(ready||(ready=login(id)));const r=await call('readClientPortal',{practiceId:id});return {exists:true,data:()=>hydrate(r.practice)};};
function doc(id) {
 return {
  get:get(id),
  async set(fields) { await(ready||(ready=login(id)));return call('updateClientPortal',{practiceId:id,fields}); },
  async update(fields) { return this.set(fields); },
  onSnapshot(callback,error) {
   let stopped=false;
   const poll=async()=>{try{const s=await get(id)();if(!stopped)callback(s);}catch(e){if(error)error(e);else console.error(e);}finally{if(!stopped)setTimeout(poll,15000);}};
   poll();return()=>{stopped=true;};
  }
 };
}
window.CredipassPortal={login,call,auth,storage:app.storage(),fieldValue:{serverTimestamp:()=>({op:'timestamp'}),delete:()=>({op:'delete'}),arrayUnion:(...values)=>({op:'arrayUnion',values}),arrayRemove:(...values)=>({op:'arrayRemove',values})},db:{collection(name){if(name!=='pratiche_mutuo')throw Error('Collezione non disponibile');return {doc};}}};
})();
