const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const admin=require('firebase-admin');
const stopped=new Set(['in_verifica','caricato_banca','valutazione_reddituale','integrazione_banca','pre_stipula','stipulato','rinunciata','attesa_perizia','perizia_in_corso','perizia_ok','perizia_ko','attesa_documentazione_notarile','chiamata_atto','delibera_reddituale_ok','delibera_reddituale_ko']);
function changes(before,after){
 const patch={};if(!before)return {stato_pratica:after.stato_pratica||'da_istruire'};
 const added=['elencoDocRichiesti','documenti_versione_richiesta'].some(k=>(after[k]||[]).some(x=>!(before[k]||[]).includes(x)));
 const requested=after.richiestaIntegrazioneAttiva===true&&(before.richiestaIntegrazioneAttiva!==true||added);
 if(requested){Object.assign(patch,{stato_pratica:'attesa_documenti',documentReminderAttivo:true,documentReminderPausa:false});}
 else if(stopped.has(after.stato_pratica)&&after.documentReminderAttivo===true)patch.documentReminderAttivo=false;
 return Object.fromEntries(Object.entries(patch).filter(([k,v])=>after[k]!==v));
}
function agencyChange(before,after){
 const type=String(after.tipo_fonte_pratica||'').toUpperCase(),name=String(after.segnalatore_riferimento||'').trim();
 const changed=before&&(before.tipo_fonte_pratica!==after.tipo_fonte_pratica||before.segnalatore_riferimento!==after.segnalatore_riferimento||before.segnalatore_agenzia_id!==after.segnalatore_agenzia_id);
 if(type==='AGENZIA_IMMOBILIARE'&&name&&(changed||!after.provenienza?.agenziaId))return {categoria:'agenzia_immobiliare',agenziaId:(/^[A-Za-z0-9_-]{1,120}$/.test(String(after.segnalatore_agenzia_id||'')) ? after.segnalatore_agenzia_id : name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,120)),agenziaNome:name};
 if(changed&&before.tipo_fonte_pratica==='AGENZIA_IMMOBILIARE'&&type!=='AGENZIA_IMMOBILIARE')return {categoria:type==='SEGNALATORE'?'passaparola':'diretto',agenziaId:null,agenziaNome:null};
 return null;
}
exports.synchronizePracticeWorkflow=onDocumentWritten({document:'pratiche_mutuo/{practiceId}',region:'us-central1'},async event=>{
 if(!event.data?.after.exists)return;const snapshot=event.data.after,patch=changes(event.data.before.exists?event.data.before.data():null,snapshot.data());const agency=agencyChange(event.data.before.exists?event.data.before.data():null,snapshot.data());if(agency)patch.provenienza=agency;if(!Object.keys(patch).length)return;
 await admin.firestore().runTransaction(async tx=>{const current=await tx.get(snapshot.ref);if(!current.exists||!current.updateTime.isEqual(snapshot.updateTime))return;let agencyRef,agencySnap;if(agency?.agenziaId){agencyRef=admin.firestore().collection("agenzie_immobiliari").doc(agency.agenziaId);agencySnap=await tx.get(agencyRef);}if(patch.stato_pratica){patch.stato_pratica_aggiornato_il=admin.firestore.FieldValue.serverTimestamp();patch.attivita_interne=admin.firestore.FieldValue.arrayUnion({tipo:'stato_automatico',titolo:'Stato aggiornato automaticamente',stato:patch.stato_pratica,creato_il:new Date().toISOString(),descrizione:'Aggiornamento del flusso documentale'});}if(agencyRef&&!agencySnap.exists)tx.set(agencyRef,{nome:agency.agenziaNome,attiva:true});tx.update(snapshot.ref,patch);});
});
exports.changes=changes;

exports.agencyChange=agencyChange;
