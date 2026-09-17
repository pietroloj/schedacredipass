const assert=require('node:assert/strict');
const fs=require('node:fs'); const vm=require('node:vm'); const path=require('node:path');
const root=path.resolve(__dirname,'..');
const policy=require(root+'/functions/src/mail-policy');
let count=0;function check(name,fn){fn();count++;console.log('PASS '+name);}
const molino={consulente_uid:'owner',cliente_nome:'Giuseppe',cliente_cognome:'Molino',cliente2_nome:'Anna',cliente2_cognome:'Della Monica'};
for(const name of ['Giuseppe Molino','MOLINO GIUSEPPE','Molino G.','G. MOLINO','Della Monica Anna'])check(name,()=>assert.equal(policy.strictSubject('Re: '+name,molino).matched,true));
check('unrelated name rejected',()=>assert.equal(policy.strictSubject('ROSSETTI EMANUELE n° 4487136',molino).matched,false));
check('subject number parser',()=>assert.deepEqual(policy.extractLabeledPracticeNumbersFromSubject('R: PRATICA ROSSETTI EMANUELE - n° 4487136 - 92.000,00 €'),['4487136']));
check('words never learned',()=>assert.deepEqual(policy.extractLabeledPracticeNumbersFromSubject('pratica HTTPS rif ISTRUTTORIA pratica AMANUEL'),[]));
check('bracket identifier',()=>assert.deepEqual(policy.extractLabeledPracticeNumbersFromSubject('Giuseppe Molino [1048911]'),['1048911']));
check('manual number priority',()=>assert.equal(policy.strictSubject('Giuseppe Molino 7654321',{...molino,mail_matching:{numeri_pratica_manual:['7654321']}}).score,3000));
check('learned identifier reused',()=>assert.equal(policy.strictSubject('rif 4487136',{mail_matching:{numeri_pratica_appresi:['4487136']}}).matched,true));
check('practice subjects read',()=>assert.equal(policy.strictSubject('Anna Della Monica',{soggetti_pratica:[{nome:'Anna',cognome:'Della Monica'}]}).matched,true));
for(const address of ['servizio.clienti@credipass.it','consulenze@consulenza-credipass.it','attivita.pratiche@credipass.it','calendar-notification@google.com','clienti@credipass.it'])check('exclude '+address,()=>assert.equal(policy.excludedSender({value:[{address:address.toUpperCase()}]}),true));
check('bank sender admitted',()=>assert.equal(policy.excludedSender(['bank@example.com']),false));
const records=new Map();
function ref(key){return {id:key.split('/').at(-1),collection:n=>({doc:id=>ref(key+'/'+n+'/'+id),get:async()=>({docs:[...records.keys()].filter(k=>k.startsWith(key+'/'+n+'/')).map(snap)})}),get:async()=>snap(key),set:async v=>{const d=records.get(key)||{};for(const [k,x]of Object.entries(v)){if(k==='mail_matching'){const previous=d[k]?.numeri_pratica_appresi||[];d[k]={...d[k],...x};if(x.numeri_pratica_appresi?.union)d[k].numeri_pratica_appresi=[...new Set([...previous,...x.numeri_pratica_appresi.union])];}else d[k]=x;}records.set(key,d);},delete:async()=>records.delete(key),update:async v=>ref(key).set(v)};}
function snap(key){return {id:key.split('/').at(-1),exists:records.has(key),data:()=>records.get(key),ref:ref(key)};}
const db={collection:n=>({doc:id=>ref(n+'/'+id),get:async()=>({docs:[...records.keys()].filter(k=>k.split('/').length===2&&k.startsWith(n+'/')).map(snap)})}),runTransaction:async fn=>fn({get:r=>r.get(),set:(r,v)=>r.set(v),update:(r,v)=>r.update(v)})};
const firestore=()=>db;firestore.FieldValue={serverTimestamp:()=>123,arrayUnion:(...union)=>({union}),arrayRemove:(...remove)=>({remove})};
const admin={apps:[{}],firestore,storage:()=>({})};
function load(file,additional={}){const sandbox={module:{exports:{}},exports:{},console,require:n=>{
if(additional[n])return additional[n];if(n==='firebase-admin')return admin;
if(n==='firebase-functions/v2/https')return {onCall:(o,f)=>f,HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}}};
if(n==='firebase-functions/v2/scheduler')return {onSchedule:(o,f)=>f};
if(n==='firebase-functions/params')return {defineSecret:()=>({value:()=> 'test'})};
if(n==='./mail-policy')return policy;
if(n==='./mail-matcher')return {normalizePracticeNumber:x=>x};
return {};
}};vm.runInNewContext(fs.readFileSync(root+'/functions/src/'+file,'utf8'),sandbox);return sandbox.module.exports;}
(async()=>{
const engine=load('mail-engine-imap-personal.js');
records.set('consulenti/owner',{attivo:true,ruolo:'consulente'});
records.set('pratiche_mutuo/molino',{...molino,attivita_interne:[{id:'email_bad',meta:{email_doc_id:'bad'}},{id:'email_good',meta:{email_doc_id:'good'}},{id:'email_orphan',descrizione:'ROSSETTI EMANUELE'},{id:'note',tipo:'nota'}]});
records.set('pratiche_mutuo/molino/email_timeline/bad',{oggetto:'ROSSETTI EMANUELE',mittente:['bank@example.com']});
records.set('pratiche_mutuo/molino/email_timeline/good',{oggetto:'Giuseppe Molino',mittente:['bank@example.com']});
await engine.cleanupPracticeTimeline({consultantUid:'owner',practiceId:'molino'});
check('cleanup removes document AND activity, preserves notes',()=>{assert(!records.has('pratiche_mutuo/molino/email_timeline/bad'));assert.deepEqual(records.get('pratiche_mutuo/molino').attivita_interne.map(x=>x.id),['email_good','note']);});
check('valid timeline email retained',()=>assert(records.has('pratiche_mutuo/molino/email_timeline/good')));
await engine.learnPracticeNumberAfterNameMatch({practiceRef:ref('pratiche_mutuo/molino'),practiceData:molino,subject:'Giuseppe Molino n° 4487136',method:'subject_full_name'});
check('learned separate from manual',()=>{const m=records.get('pratiche_mutuo/molino').mail_matching;assert.deepEqual([...m.numeri_pratica_appresi],['4487136']);assert(!m.numeri_pratica_manual);});
records.set('pratiche_mutuo/duplicate',molino);
check('ambiguity rejected',()=>{});
assert.equal((await engine.findPracticeByStrictSubject({mail:{subject:'Giuseppe Molino'},consultantUid:'owner'})).matched,false);
await assert.rejects(engine.segnaEmailGestita({auth:{uid:'stranger'},data:{practiceId:'molino',emailId:'good'}}));
await engine.segnaEmailGestita({auth:{uid:'owner'},data:{practiceId:'molino',emailId:'good'}});
check('handled persists',()=>assert.equal(records.get('pratiche_mutuo/molino/email_timeline/good').gestita,true));
let prompt='';class OpenAI{constructor(){this.chat={completions:{create:async args=>{prompt=JSON.stringify(args.messages);return {choices:[{message:{content:JSON.stringify({summary:'Richiesta CU',requestedDocuments:['CU 2025'],detectedDocuments:['CU 2025'],suggestedReply:'Invieremo la CU 2025 richiesta.',confidence:.93,priority:'high',requiresAction:true})}}]};}}};}}
const ai=load('mail-intelligence.js',{'./mail-engine-imap-personal':engine,openai:OpenAI,'./notification-center':{createNotification:async()=>{}}});
records.get('pratiche_mutuo/molino/email_timeline/good').testo='Inviare CU 2025 entro venerdì';
const result=await ai.analizzaEmailPraticaAI({auth:{uid:'owner'},data:{practiceId:'molino',emailId:'good'}});
check('AI receives selected subject body and real client',()=>{assert(prompt.includes('Inviare CU 2025'));assert(prompt.includes('Giuseppe Molino'));});
check('contextual reply is model output',()=>assert.equal(result.analysis.suggestedReply,'Invieremo la CU 2025 richiesta.'));
await assert.rejects(ai.analizzaEmailPraticaAI({auth:{uid:'stranger'},data:{practiceId:'molino',emailId:'good'}}));
console.log('PASS AI access denied for stranger');
console.log(`Backend: ${count+2} checks passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
