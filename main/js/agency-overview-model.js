(function(root){'use strict';
function project(doc){const d=doc.data||{};const p=d.provenienza||{};return {id:doc.id,agencyId:String(p.agenziaId||''),cliente:[d.cliente_nome,d.cliente_cognome].filter(Boolean).join(' ')||d.cliente_nome_completo||'Pratica',stato:d.stato_pratica||'da_istruire',messages:Array.isArray(d.agency_messages)?d.agency_messages.map(m=>({text:String(m?.text||''),createdAt:String(m?.createdAt||'')})):[]};}
function group(agencies,docs){const map=new Map(agencies.map(a=>[a.id,{id:a.id,nome:a.nome||a.id,practices:[]} ]));for(const doc of docs){const p=project(doc);if(map.has(p.agencyId))map.get(p.agencyId).practices.push(p);}return [...map.values()].sort((a,b)=>a.nome.localeCompare(b.nome,'it'));}
root.AgencyOverviewModel={project,group};if(typeof module!=='undefined')module.exports=root.AgencyOverviewModel;
})(typeof window==='undefined'?globalThis:window);
