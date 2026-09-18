const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../main/js/area-operativa.js'),'utf8');
async function boot(search='',deny=false){
 const nodes=new Map(),calls=[];const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',classList:{toggle(){}},disabled:false});return nodes.get(id)};
 const data={cliente_nome:'Test',cliente_cognome:'Cliente',consulente_nome:'Consulente',stato_pratica:'perizia',documenti_richiesti_portale:['cu',null],attivita_interne:[{titolo:'<script>evil</script>',creato_il:'2026-09-18',descrizione:'Nota reale'}]};
 const db = {collection: collection => ({
  where: (field, op, uid) => {
   calls.push({collection, field, op, uid});
   return {get: async () => ({docs: [{id: 'case', data: () => data}]})};
  }
 })};
 let denied=deny;
 const fn={httpsCallable:name=>async args=>{calls.push({name,args});if(denied)throw Error('Accesso negato');return {data:{practice:data,thread:[{id:args.threadAfter?'second':'first',oggetto:'Richiesta <img>',mittente:['bank@example.com'],data:'2026-09-18'}],threadNext:args.threadAfter?null:'first'}}}};
 const context={window:{CREDIPASS_FIREBASE:{db,functions:fn}},document:{getElementById:node},location:{search},URLSearchParams,CredipassAuth:{guard:async()=>({user:{uid:'owner'},profile:{nome:'Pietro'}})},console};
 vm.runInNewContext(code,context);await new Promise(r=>setImmediate(r));return {nodes,node,calls,setDenied:()=>denied=true};
}
test('home queries only assigned practices, filters real records',async()=>{const x=await boot();assert.equal(x.calls[0].uid,'owner');assert.equal(x.calls[0].field,'consulente_uid');assert.match(x.node('rows').innerHTML,/Test Cliente/);x.node('search').value='missing';x.node('search').oninput();assert.match(x.node('rows').innerHTML,/Nessuna pratica/)});
test('practice links preserve ID and existing actions; text escaped; pagination',async()=>{const x=await boot('?id=case');assert.equal(x.calls[0].args.practiceId,'case');assert.match(x.node('view').innerHTML,/dashboard-consulente.html\?id=case#selectIntegrazione/);assert.match(x.node('view').innerHTML,/&lt;script&gt;/);assert.match(x.node('mailRows').innerHTML,/emailId=first/);await x.node('more').onclick();assert.match(x.node('mailRows').innerHTML,/emailId=second/);assert.equal(x.node('more').hidden,true)});
test('denied reload removes previously rendered case',async()=>{const x=await boot('?id=case');x.setDenied();await x.node('refresh').onclick();assert.equal(x.node('view').innerHTML,'');assert.match(x.node('message').innerHTML,/Accesso negato/)});
