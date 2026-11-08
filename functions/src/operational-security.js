'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const crypto=require('node:crypto');
const {mergePermissions}=require('./config/permissions');
if(!admin.apps.length)admin.initializeApp();
const db=admin.firestore(), options={region:'us-central1',maxInstances:10};
const fail=()=>{throw new HttpsError('permission-denied','Accesso non consentito.');};
const text=(v,n=300)=>String(v||'').trim().slice(0,n);
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
async function staff(request,permission){
 if(!request.auth?.uid)fail();
 const s=await db.collection('consulenti').doc(request.auth.uid).get(),p=s.data();
 if(!p||p.attivo===false)fail();
 if(permission&&p.ruolo!=='admin'&&!mergePermissions(p.ruolo,p.permessi)[permission])fail();
 return p;
}
async function access(request,id,permission){
 if(!id||String(id).includes('/'))fail();
 const s=await db.collection('pratiche_mutuo').doc(id).get();if(!s.exists)fail();
 const p=await staff(request,permission),d=s.data();
 const owner=d.consulente_uid||d.workspace_uid||d.owner_uid;
 if(p.ruolo==='admin'||owner===request.auth.uid)return s;
 if(!['responsabile','segreteria'].includes(p.ruolo))fail();
 if((p.collaboratori_visibili||[]).includes(owner))return s;
 if(owner){const o=(await db.collection('consulenti').doc(owner).get()).data()||{};
 if(p.ruolo==='responsabile'&&o.responsabile_uid===request.auth.uid)return s;
 if(p.ruolo==='segreteria'&&(p.collaboratori_visibili||[]).includes(o.responsabile_uid))return s;}
 fail();
}
function portalClaim(request,id){return request.auth?.token?.portal_practice===id&&Date.now()/1000-request.auth.token.auth_time<86400;}
async function clientAccess(request,id){if(portalClaim(request,id))return;await access(request,id,'vede_documenti');}
const portalKeys=['cliente_nome','cliente_cognome','cliente_nome_completo','nomeCliente','cliente2_nome','cliente2_cognome','stato_pratica','stato_pratica_aggiornato_il','documenti_richiesti_portale','elencoDocRichiesti','documenti_versione_richiesta','documenti_versione_motivi','richiestaIntegrazioneAttiva','notaPerCliente','messaggi_cliente_log','appuntamenti_cliente_log','attivita_cliente_log','documentReminderPrimoUploadIl','documentReminderAttivo','documentReminderPausa','scheda_consulenza_pdf_url','scheda_consulenza_pdf_nome'];
function projection(d){return Object.fromEntries(Object.entries(d).filter(([k])=>portalKeys.includes(k)||/^doc_[a-zA-Z0-9_]+$/.test(k)));}
async function serviceMail(payload){
 const {GoogleAuth}=require('google-auth-library');
 const url='https://consulenza-credipass.it/api/send-email';
 const client=await new GoogleAuth().getIdTokenClient(url);
 await client.request({url,method:'POST',data:payload});
}
exports.requestPortalCode=onCall(options,async request=>{
 const email=text(request.data?.email).toLowerCase(),id=text(request.data?.practiceId),kind=request.data?.kind==='agency'?'agency':'client';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||id.includes('/'))throw new HttpsError('invalid-argument','Indica un indirizzo email valido.');
 const key=hash(kind+'|'+id+'|'+email),ref=db.collection('portal_challenges').doc(key),code=String(crypto.randomInt(100000,1000000));
 const ip=hash(String(request.rawRequest?.ip||'unknown'));const rate=db.collection('portal_rates').doc(ip);
 await db.runTransaction(async tx=>{const [r,c]=await Promise.all([tx.get(rate),tx.get(ref)]);const now=Date.now();
 if(now-(c.data()?.sentAt||0)<60000)throw new HttpsError('resource-exhausted','Attendi un minuto prima di riprovare.');
 const recent=now-(r.data()?.start||0)<3600000;if(recent&&r.data().count>=20)throw new HttpsError('resource-exhausted','Troppi tentativi. Riprova più tardi.');
 tx.set(rate,{start:recent?r.data().start:now,count:recent?r.data().count+1:1});tx.set(ref,{sentAt:now,attempts:0,codeHash:hash(code+'|'+key),expiresAt:now+600000,kind,practiceId:id,email,approved:false});});
 let allowed=false,agencyId='';
 if(kind==='client'&&id){const d=(await db.collection('pratiche_mutuo').doc(id).get()).data()||{};allowed=[d.cliente_email,d.cliente2_email,d.email_cliente].some(e=>String(e||'').trim().toLowerCase()===email);}
 if(kind==='agency'){const a=await db.collection('agency_access').doc(hash(email)).get();if(a.exists&&a.data().active!==false){agencyId=a.data().agencyId;const agency=await db.collection('agenzie_immobiliari').doc(agencyId).get();allowed=agency.exists&&agency.data().attiva!==false;}}
 if(allowed){await ref.update({approved:true,agencyId});await serviceMail({to:email,subject:'Codice di accesso Credipass',html:`<p>Il tuo codice di accesso è <strong>${code}</strong>.</p><p>Scade tra 10 minuti. Se non hai richiesto l’accesso, ignora questo messaggio.</p>`});}
 return {ok:true,challenge:key,message:'Se l’indirizzo è associato alla pratica o all’agenzia, riceverai un codice via email.'};
});
exports.verifyPortalCode=onCall(options,async request=>{
 const key=text(request.data?.challenge),code=text(request.data?.code,6);if(!/^[a-f0-9]{64}$/.test(key))fail();
 const ref=db.collection('portal_challenges').doc(key);
 const d=await db.runTransaction(async tx=>{const s=await tx.get(ref),v=s.data();if(!v||v.expiresAt<Date.now()||v.attempts>=5||v.used)return null;
 const valid=v.approved&&v.codeHash===hash(code+'|'+key);tx.update(ref,{attempts:v.attempts+1,...(valid?{used:true}:{})});return valid?v:null;});
 if(!d)throw new HttpsError('permission-denied','Codice non valido o scaduto.');
 const uid='external_'+hash(d.kind+'|'+d.email).slice(0,48);
 try{await admin.auth().getUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;await admin.auth().createUser({uid});}
 const claims=d.kind==='agency'?{agency_id:d.agencyId,agency_email_hash:hash(d.email)}:{portal_practice:d.practiceId};
 return {token:await admin.auth().createCustomToken(uid,claims)};
});
exports.readClientPortal=onCall(options,async request=>{const id=text(request.data?.practiceId);await clientAccess(request,id);const s=await db.collection('pratiche_mutuo').doc(id).get();return {practice:projection(s.data()||{})};});
exports.updateClientPortal=onCall(options,async request=>{
 const id=text(request.data?.practiceId);await clientAccess(request,id);const fields=request.data?.fields||{},ref=db.collection('pratiche_mutuo').doc(id);
 const codes=new Set(Object.keys(fields).filter(k=>/^doc_[a-zA-Z0-9_]+$/.test(k)&&fields[k]===true).map(k=>k.slice(4)));
 if(fields.documenti_versione_richiesta?.op==='arrayRemove')for(const c of fields.documenti_versione_richiesta.values||[])if(/^[a-zA-Z0-9_]+$/.test(c))codes.add(c);
 const uploaded=new Map();
 for(const code of codes){const [files]=await admin.storage().bucket().getFiles({prefix:`Fascicoli/${id}/doc_${code}_`,maxResults:1000,autoPaginate:false});if(files.length)uploaded.set(code,Math.max(...files.map(f=>Date.parse(f.metadata.timeCreated)||0)));}
 await db.runTransaction(async tx=>{const snap=await tx.get(ref),d=snap.data()||{},patch={};
 const required=[...(d.documenti_richiesti_portale||[]),...(d.elencoDocRichiesti||[]),...(d.documenti_versione_richiesta||[])].map(x=>String(x).replace(/^doc_/,''));
 const requested=new Set(required);
 for(const [code,time] of uploaded){if((d.documenti_versione_richiesta||[]).includes(code)&&time<(d.ultimoAggiornamentoIntegrazione?.toMillis?.()||0)){uploaded.delete(code);continue;}if(requested.has(code)||!Array.isArray(d.documenti_richiesti_portale))patch['doc_'+code]=true;}
 if(uploaded.size){patch.documenti_versione_richiesta=(d.documenti_versione_richiesta||[]).filter(x=>!uploaded.has(x));patch.documentReminderUltimaAttivitaClienteIl=admin.firestore.FieldValue.serverTimestamp();if(!d.documentReminderPrimoUploadIl)patch.documentReminderPrimoUploadIl=admin.firestore.FieldValue.serverTimestamp();}
 const next={...d,...patch};
 if(d.richiestaIntegrazioneAttiva&&required.length&&required.every(c=>next['doc_'+c]===true)&&!(next.documenti_versione_richiesta||[]).length){patch.richiestaIntegrazioneAttiva=false;patch.documentReminderAttivo=false;patch.integrazioneCompletataIl=admin.firestore.FieldValue.serverTimestamp();}
 if(fields.attivita_cliente_log?.op==='arrayUnion'){
  const e=fields.attivita_cliente_log.values?.[0]||{};patch.attivita_cliente_log=admin.firestore.FieldValue.arrayUnion({tipo:'documenti',titolo:'Documentazione caricata',descrizione:text(e.descrizione,1000),data_ms:Date.now(),origine:'portale_cliente',visibile_cliente:true});
 }
 if(Object.keys(patch).length)tx.update(ref,patch);
 });return {ok:true};
});
exports.manageAgencyAccess=onCall(options,async request=>{
 const p=await staff(request,'gestisce_utenti');if(p.ruolo!=='admin')fail();const id=text(request.data?.agencyId),email=text(request.data?.email).toLowerCase();
 if(!id||id.includes('/')||!email.includes('@'))throw new HttpsError('invalid-argument','Seleziona agenzia e indirizzo email.');
 const agency=(await db.collection('agenzie_immobiliari').doc(id).get());if(!agency.exists||agency.data().attiva===false)fail();
 await db.collection('agency_access').doc(hash(email)).set({agencyId:id,email,active:request.data?.active!==false,updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedBy:request.auth.uid});return {ok:true};
});
exports.manageAgency=onCall(options,async request=>{
 const p=await staff(request,'gestisce_utenti');if(p.ruolo!=='admin')fail();
 const id=text(request.data?.agencyId),name=text(request.data?.name,160),action=text(request.data?.action);
 if(!id||id.includes('/'))throw new HttpsError('invalid-argument','Agenzia non valida.');
 const ref=db.collection('agenzie_immobiliari').doc(id),snap=await ref.get();
 if(action==='save'){if(!name)throw new HttpsError('invalid-argument','Inserisci il nome.');await ref.set({nome:name,attiva:true,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});return {ok:true};}
 if(action==='deactivate'){if(!snap.exists)throw new HttpsError('not-found','Agenzia non trovata.');await ref.update({attiva:false,updatedAt:admin.firestore.FieldValue.serverTimestamp()});return {ok:true};}
 throw new HttpsError('invalid-argument','Operazione non valida.');
});
exports.agencyPractices=onCall(options,async request=>{
 const claim=request.auth?.token;if(!claim?.agency_id||Date.now()/1000-claim.auth_time>86400)fail();
 const grant=(await db.collection('agency_access').doc(claim.agency_email_hash||'_').get()).data();if(!grant||grant.active===false||grant.agencyId!==claim.agency_id)fail();
 const agency=await db.collection('agenzie_immobiliari').doc(claim.agency_id).get();if(!agency.exists||agency.data().attiva===false)fail();
 const s=await db.collection('pratiche_mutuo').where('provenienza.agenziaId','==',claim.agency_id).get();
 return {practices:s.docs.map(x=>{const d=x.data();return {id:x.id,cliente:[d.cliente_nome,d.cliente_cognome].filter(Boolean).join(' ')||d.cliente_nome_completo||'Pratica',stato:d.stato_pratica||'da_istruire',updatedAt:d.stato_pratica_aggiornato_il,messages:(d.agency_messages||[]).map(m=>({text:m.text,createdAt:m.createdAt}))};})};
});
exports.shareAgencyMessage=onCall(options,async request=>{
 const id=text(request.data?.practiceId),message=text(request.data?.text,3000);if(!message)throw new HttpsError('invalid-argument','Scrivi un messaggio.');
 const s=await access(request,id,'modifica_timeline');await s.ref.update({agency_messages:admin.firestore.FieldValue.arrayUnion({text:message,createdAt:new Date().toISOString(),authorUid:request.auth.uid})});return {ok:true};
});
exports.access=access;exports.staff=staff;exports.clientAccess=clientAccess;exports.projection=projection;exports.serviceMail=serviceMail;

exports.notifyClientUpload=onCall(options,async request=>{
 const id=text(request.data?.practiceId);await clientAccess(request,id);const ref=db.collection('pratiche_mutuo').doc(id);
 const d=await db.runTransaction(async tx=>{const s=await tx.get(ref),v=s.data()||{};const last=v.portal_notification_at?.toMillis?.()||0;if(Date.now()-last<60000)return null;tx.update(ref,{portal_notification_at:admin.firestore.FieldValue.serverTimestamp()});return v;});
 if(!d)return {ok:true};
 const recipients=[...new Set([d.consulente_email,d.referente_email,d.backoffice_email].filter(e=>typeof e==='string'&&e.includes('@')))];
 if(recipients.length)await serviceMail({to:recipients,subject:'Documentazione caricata nel portale Credipass',html:'<p>Il cliente ha caricato documentazione nella pratica. Apri il fascicolo per verificarla.</p><p><a href="https://consulenza-credipass.it/main/dashboard-consulente.html?id='+encodeURIComponent(id)+'">Apri fascicolo</a></p>'});
 return {ok:true};
});
exports.createClientAccessLink=onCall(options,async request=>{
 const id=text(request.data?.practiceId);await access(request,id,'vede_documenti');const secret=crypto.randomBytes(32).toString('base64url'),key=hash(secret);
 await db.collection('portal_links').doc(key).set({practiceId:id,expiresAt:Date.now()+7*86400000,createdBy:request.auth.uid,active:true});
 return {url:'https://consulenza-credipass.it/upload.html?id='+encodeURIComponent(id)+'&access='+secret,expiresInDays:7};
});
exports.exchangeClientLink=onCall(options,async request=>{
 const secret=text(request.data?.access,80),id=text(request.data?.practiceId);if(!/^[A-Za-z0-9_-]{43}$/.test(secret))fail();
 const key=hash(secret),d=(await db.collection('portal_links').doc(key).get()).data();if(!d||!d.active||d.practiceId!==id||d.expiresAt<Date.now())fail();
 const uid='portal_link_'+key.slice(0,48);try{await admin.auth().getUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;await admin.auth().createUser({uid});}
 return {token:await admin.auth().createCustomToken(uid,{portal_practice:id})};
});
