const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('functions/src/document-reminders.js','utf8');
const start=source.indexOf('async function processPractice('),end=source.indexOf('  const required =',start);
const probe=source.slice(start,end)+'return "eligible"; }';
async function run(state,active=true){const writes=[];const c={};vm.runInNewContext(probe,c);const result=await c.processPractice({id:'test',data:()=>({stato_pratica:state,documentReminderAttivo:active}),ref:{set:async (value)=>writes.push(value)}});return {writes,result};}
test('verification and later stages disable document reminders',async()=>{for(const s of ['in_verifica','caricato_banca','valutazione_reddituale','integrazione_banca','pre_stipula','stipulato','rinunciata']){const r=await run(s);assert.equal(r.writes.length,1,s);assert.equal(r.writes[0].documentReminderAttivo,false,s);assert.equal(r.result,undefined,s);}});
test('collection remains eligible; suspended and inactive practices do not send',async()=>{assert.equal((await run('attesa_documenti')).result,'eligible');assert.equal((await run('sospesa')).result,undefined);assert.equal((await run('attesa_documenti',false)).result,undefined);});
