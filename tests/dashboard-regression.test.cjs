const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(require('path').join(__dirname,'../main/dashboard-consulente.html'),'utf8');
const nodes={statoPraticaSelect:{value:'valutazione_reddituale'},statoPraticaUpdated:{},dashboardCollegaSegnalato:{},dashboardCollegaSegnalatoInfo:{}};
let saved={stato_pratica:'valutazione_reddituale'};
const context={idCliente:'molino',console,alert:message=>{throw Error(message)},db:{collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({...saved})}),set:async update=>{saved={...saved,...update}}})})},
STATO_PRATICA_CLIENTE_META:{},STATO_PRATICA_CONFIG:{perizia_ok:{label:'Perizia OK'},valutazione_reddituale:{label:'Valutazione reddituale'}},getStatoPraticaConfig:s=>({label:s}),statoRichiedeReminderInterno:()=>false,STATI_NOTIFICA_AUTOMATICA:new Set(),registraAttivitaCliente:async()=>{},registraAttivitaInterna:async()=>{},aggiornaVisualStatoPratica:s=>{nodes.statoPraticaSelect.value=s},
document:{getElementById:id=>nodes[id]},escapeHtml:x=>x,
firebase:{firestore:{FieldValue:{serverTimestamp:()=>123}},auth:()=>({currentUser:{uid:'owner'}}),app:()=>({functions:()=>({httpsCallable:()=>async()=>({data:{consultants:[{uid:'owner',nome:'Me'},{uid:'colleague',nome:'Anna',cognome:'Rossi'}]}})})})}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('    async function caricaStatoPratica()'),source.indexOf('    let statoReminderPending')),context);
vm.runInContext(source.slice(source.indexOf('    let dashboardColleghiCache'),source.indexOf('    async function salvaCollegaSegnalatoDashboard')),context);
(async()=>{
 await context.salvaStatoPraticaEffettivo('perizia_ok');assert.equal(saved.stato_pratica,'perizia_ok');
 nodes.statoPraticaSelect.value='valutazione_reddituale';await context.caricaStatoPratica();assert.equal(nodes.statoPraticaSelect.value,'perizia_ok');
 const onload=source.slice(source.indexOf('    window.onload = async'),source.indexOf('    async function caricaIdentikitCompleto'));
 assert(onload.includes('await caricaStatoPratica()'));
 await context.caricaColleghiDashboard();assert(nodes.dashboardCollegaSegnalato.innerHTML.includes('Anna Rossi'));assert(!nodes.dashboardCollegaSegnalato.innerHTML.includes('value="owner"'));
 console.log('PASS dashboard: status save/reload, startup reload, colleague response contract, current user excluded');
})().catch(e=>{console.error(e);process.exitCode=1});
