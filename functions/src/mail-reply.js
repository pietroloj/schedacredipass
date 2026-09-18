const {replyRecipients,validateRecipients}=require("./mail-recipients");
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const nodemailer=require('nodemailer');
const {createHash}=require('node:crypto');
const {GMAIL_TOKEN_ENCRYPTION_KEY,decryptRefreshToken}=require('./gmail-token-crypto');
const {canReadTimelinePractice,imapCredentialPayload}=require('./mail-engine-imap-personal');
const {addresses}=require('./mail-policy');
if(!admin.apps.length)admin.initializeApp();
const db=admin.firestore();
const inviaRispostaEmailPratica=onCall({region:'us-central1',timeoutSeconds:120,memory:'256MiB',secrets:[GMAIL_TOKEN_ENCRYPTION_KEY]},async request=>{
 const uid=request.auth?.uid,{practiceId,emailId,requestId,text}=request.data||{};
 if(!uid)throw new HttpsError('unauthenticated','Accesso richiesto.');
 if(!practiceId||!emailId||!/^[-a-z0-9]{16,80}$/i.test(requestId||'')||typeof text!=='string'||!text.trim()||text.length>30000)
  throw new HttpsError('invalid-argument','Pratica, email, identificativo invio e testo sono obbligatori.');
 const ref=db.collection('pratiche_mutuo').doc(practiceId);
 const practice=await ref.get();
 if(!practice.exists||!(await canReadTimelinePractice(uid,practice.data())))throw new HttpsError('permission-denied','Pratica non accessibile.');
 const emailSnap=await ref.collection('email_timeline').doc(emailId).get();
 if(!emailSnap.exists)throw new HttpsError('not-found','Email originale non trovata.');
 const email=emailSnap.data();
 const connectionSnap=await db.collection('gmail_connections').doc(uid).get();
 const connection=connectionSnap.data()||{};
 if(!connection.connected||connection.provider!=='imap_app_password')throw new HttpsError('failed-precondition','Per inviare collega la tua Gmail con Password per le app.');
 const from=connection.email;
 const defaults=replyRecipients(email,[from,request.auth.token?.email],request.data?.replyAll===true);
 let to,cc;
 try{to=validateRecipients(request.data.to ?? defaults.to,[from]);cc=validateRecipients(request.data.cc ?? defaults.cc,[from]).filter(a=>!to.includes(a));}
 catch(e){throw new HttpsError('invalid-argument',e.message);}
 if(!to.length)throw new HttpsError('invalid-argument','Inserisci almeno un destinatario nel campo A.');
 if(to.length+cc.length>100)throw new HttpsError('invalid-argument','Troppi destinatari.');
 const subject=/^re:/i.test(email.oggetto||'')?email.oggetto:'Re: '+(email.oggetto||'');
 const messageId=`<${uid}.${requestId}@${String(from).split('@')[1]}>`;
 const hash=createHash('sha256').update(JSON.stringify({emailId,text,to,cc,from,subject})).digest('hex');
 const operation=ref.collection('email_reply_requests').doc(uid+'_'+requestId);
 const prior=await db.runTransaction(async tx=>{
  const snap=await tx.get(operation);
  if(snap.exists){const d=snap.data();if(d.hash!==hash)throw new HttpsError('failed-precondition','La bozza è cambiata: prepara un nuovo invio.');return d;}
  tx.set(operation,{hash,status:'sending',messageId,emailId,uid,createdAt:admin.firestore.FieldValue.serverTimestamp()});return null;
 });
 if(prior?.status==='sent')return {ok:true,sent:true,to,cc,messageId,alreadySent:true};
 if(prior)throw new HttpsError('failed-precondition','Invio già avviato o esito da verificare: controlla la posta inviata prima di riprovare.');
 let transport;
 try{
  const pass=String(decryptRefreshToken(imapCredentialPayload(connection)).token).replace(/\s+/g,'');
  transport=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:from,pass},connectionTimeout:20000,socketTimeout:60000});
  const info=await transport.sendMail({from,to,cc,subject,text:text.trim(),messageId,inReplyTo:email.messageId||undefined,references:email.messageId?[email.messageId]:undefined});
  if(!info.accepted?.length)throw new Error('Il server non ha accettato i destinatari.');
  if(info.rejected?.length){await operation.update({status:'partial',rejected:info.rejected});throw new Error('Alcuni destinatari sono stati rifiutati: '+info.rejected.join(', '));}
  await operation.update({status:'sent',sentAt:admin.firestore.FieldValue.serverTimestamp()});
 }catch(e){
  await operation.set({status:'uncertain',error:String(e.message||e).slice(0,500)},{merge:true}).catch(()=>{});
  throw new HttpsError('unavailable','Invio non confermato. Controlla la posta inviata prima di un nuovo tentativo. '+String(e.message||''));
 }finally{transport?.close();}
 // SMTP Gmail retains the original sent message. Failure to materialize the local copy must not cause a second send.
 let timelineWarning=null;
 try{
  const id=Buffer.from(messageId).toString('base64url').slice(0,180);
  await ref.collection('email_timeline').doc(id).set({messageId,oggetto:subject,testo:text.trim(),html:'',bodyVersion:3,direzione:'inviata',mittente:[from],destinatari:to,cc,recipientsVersion:1,replyTo:[],allegati:[],data:admin.firestore.FieldValue.serverTimestamp(),autoAssociata:false,matchMethod:'manual',banca:email.banca||null,consultantUid:uid,casella:from,inReplyTo:email.messageId||null});
 }catch(_){timelineWarning='Email inviata; la copia in conversazione sarà disponibile alla sincronizzazione.';}
 return {ok:true,sent:true,to,cc,messageId,timelineWarning};
});
module.exports={inviaRispostaEmailPratica};
