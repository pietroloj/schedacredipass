const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {simpleParser}=require(require.resolve('mailparser',{paths:[path.join(root,'functions')]}));
const raw=Buffer.from([
'From: info.it@ing.com','To: owner@example.com','Message-ID: <ing-fixture@example.com>','Subject: Pratica 18969473, Molino Giuseppe','MIME-Version: 1.0','Content-Type: multipart/alternative; boundary="fixture"','','--fixture','Content-Type: text/plain; charset=utf-8','','Pratica 18969473, Molino Giuseppe\r\nING','--fixture','Content-Type: text/html; charset=utf-8','','<html><head><style>.banner {background-color:#ff6600}</style></head><body><div class="banner">ING</div><p>Ciao LO IACONO PIETRO,</p><p>La pratica è incompleta. Integrare tramite il portale.</p><p>Dati identificativi: Giuseppe Molino.</p></body></html>','--fixture--',''].join('\r\n'));
let update,readOnly=false,loggedOut=false,activeFolder="",sentOnly=false;
const fieldValue={delete:()=>null,serverTimestamp:()=>123,arrayUnion:(...x)=>x};
const connection={connected:true,provider:'imap_app_password',email:'owner@example.com'};
const doc={get:async()=>({data:()=>connection}),collection:()=>({doc:()=>doc}),set:async x=>{update=x}};
const firestore=()=>({collection:()=>({doc:()=>doc})});firestore.FieldValue=fieldValue;
const admin={apps:[{}],firestore,storage:()=>({})};
class ImapFlow{async connect(){}async list(){return [{path:"Sent",specialUse:"\\Sent"}];}async getMailboxLock(folder,options){activeFolder=folder;readOnly=options.readOnly;return {release(){}};}async fetchOne(){return sentOnly&&activeFolder!=="Sent"?false:{source:raw,uid:42};}async search(){return activeFolder==="Sent"?[42]:[];}async logout(){loggedOut=true;}}
const sandbox={Buffer,console,module:{exports:{}},require:name=>{
 if(name==='firebase-admin')return admin;
 if(name==='firebase-functions/v2/https')return {onCall:(o,f)=>f};
 if(name==='firebase-functions/v2/scheduler')return {onSchedule:(o,f)=>f};
 if(name==='firebase-functions/params')return {};
 if(name==='imapflow')return {ImapFlow};if(name==='mailparser')return {simpleParser};
 if(name==='./gmail-token-crypto')return {decryptRefreshToken:()=>({token:'test'})};
 if(name==='./mail-policy')return require(root+'/functions/src/mail-policy');
 if(name==='./mail-bank-names')return require(root+'/functions/src/mail-bank-names');
 return {};
}};
vm.runInNewContext(fs.readFileSync(root+'/functions/src/mail-engine-imap-personal.js','utf8'),sandbox);
(async()=>{
 const data={uid:1,folder:'INBOX',messageId:'<ing-fixture@example.com>',testo:'Vecchio testo scarno'};
 const repaired=await sandbox.module.exports.hydrateOriginalEmail('molino','mail',data,{consulente_uid:'owner'});
 assert(repaired.html.includes('background-color:#ff6600'));
 assert(repaired.html.includes('Integrare tramite il portale'));
 assert(repaired.testo.includes('Integrare tramite il portale'));
 assert.equal(update.bodyVersion,3);assert.equal(update.aiAnalysis,null);
 assert(readOnly);assert(loggedOut);
 sentOnly=true;
 const moved=await sandbox.module.exports.hydrateOriginalEmail('molino','mail',{...data,direzione:'inviata'},{consulente_uid:'owner'});
 assert.equal(update.folder,'Sent');assert.equal(update.uid,42);assert(moved.html.includes('Integrare tramite il portale'));
 console.log('PASS real MIME parser: original HTML restored, richer HTML text sent to AI, old analysis invalidated, IMAP read-only, connection closed, moved sent message located in Sent by Message-ID');
})().catch(e=>{console.error(e);process.exitCode=1});
