(function(){
const app=firebase.initializeApp(firebase.app().options,'client-portal'),auth=app.auth(),fn=app.functions('us-central1');
const call=async(name,data)=>(await fn.httpsCallable(name)(data)).data;
let ready;
function hydrate(v){if(!v||typeof v!=='object')return v;if(Number.isFinite(v._seconds))return new firebase.firestore.Timestamp(v._seconds,v._nanoseconds||0);if(Array.isArray(v))return v.map(hydrate);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,hydrate(x)]));}
async function login(practiceId,kind='client'){
 await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
 const secret=new URLSearchParams(location.search).get('access');
 if(kind==='client'&&secret){try{const r=await call('exchangeClientLink',{practiceId,access:secret});await auth.signInWithCustomToken(r.token);const u=new URL(location.href);u.searchParams.delete('access');history.replaceState(null,'',u.pathname+u.search);return;}catch(e){console.warn('Link scaduto: usa il codice email.');}}
 await new Promise(resolve=>{const off=auth.onAuthStateChanged(()=>{off();resolve();});});
 if(auth.currentUser){const t=await auth.currentUser.getIdTokenResult();if((kind==='client'&&t.claims.portal_practice===practiceId||kind==='agency'&&t.claims.agency_id)&&Date.now()/1000-t.claims.auth_time<86400)return;await auth.signOut();}
 return new Promise(resolve=>{
 const modal=document.createElement('div');modal.style.cssText='position:fixed;inset:0;z-index:999999;background:#eef2f7;display:grid;place-items:center;padding:24px';
 modal.innerHTML='<form style="background:white;padding:32px;border-radius:20px;max-width:440px;width:100%;box-shadow:0 15px 50px #002d7218"><h1 style="font-size:24px;color:#002d72">Accesso riservato Credipass</h1><p>Inserisci l’email comunicata al consulente. Riceverai un codice per accedere in sicurezza.</p><label>Email<input type="email" required autocomplete="email" style="display:block;width:100%;padding:12px;margin:12px 0"></label><label hidden id="otp-label">Codice ricevuto<input inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="display:block;width:100%;padding:12px;margin:12px 0"></label><button style="padding:12px;background:#002d72;color:white;border:0;border-radius:8px">Ricevi codice</button><button type="button" id="reset-code" style="background:#64748b">Cambia email / richiedi un nuovo codice</button><p role="status"></p></form>';
 document.body.appendChild(modal);const form=modal.querySelector('form'),button=form.querySelector('button'),status=form.querySelector('[role=status]'),inputs=form.querySelectorAll('input');let challenge;
 form.querySelector('#reset-code').onclick=()=>{challenge=null;form.querySelector('#otp-label').hidden=true;inputs[1].required=false;inputs[1].value='';button.textContent='Ricevi codice';status.textContent='Puoi richiedere un nuovo codice dopo un minuto.';};
 form.onsubmit=async e=>{e.preventDefault();button.disabled=true;try{if(!challenge){const r=await call('requestPortalCode',{email:inputs[0].value,practiceId,kind});challenge=r.challenge;status.textContent=r.message;form.querySelector('#otp-label').hidden=false;inputs[1].required=true;button.textContent='Accedi';inputs[1].focus();}else{const r=await call('verifyPortalCode',{challenge,code:inputs[1].value});await auth.signInWithCustomToken(r.token);modal.remove();resolve();}}catch(e){status.textContent=e.message||'Accesso non riuscito';}finally{button.disabled=false;}};
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
