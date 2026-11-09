'use strict';
const {subjects}=require('./mail-policy');
const {displaySource}=require('./lead-display');
function norm(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');}
function nameKey(value){const parts=norm(value).split(' ').filter(Boolean);return parts.length>=2?parts.sort().join(' '):'';}
function names(p){const result=subjects(p).map(x=>nameKey(`${x.n} ${x.c}`));for(const key of ['cliente_nome_completo','cliente2_nome_completo','nome_cognome','nomeCompleto','nominativo'])result.push(nameKey(p[key]));return [...new Set(result.filter(Boolean))];}
function owner(p){return String(p.consulente_uid||p.workspace_uid||p.owner_uid||p.assegnato_a_uid||'').trim();}
function sameNetwork(a,b,profiles={}){if(!a||!b)return false;if(a===b)return true;const x=profiles[a]||{},y=profiles[b]||{},xm=String(x.responsabile_uid||''),ym=String(y.responsabile_uid||'');return xm===b||ym===a||!!(xm&&xm===ym)||(Array.isArray(x.collaboratori_visibili)&&x.collaboratori_visibili.includes(b))||(Array.isArray(y.collaboratori_visibili)&&y.collaboratori_visibili.includes(a));}
function explicitDirect(p){return String(p.tipo_fonte_pratica||'').trim().toUpperCase()==='DIRETTA'||(!p.tipo_fonte_pratica&&String(p.provenienza?.categoria||'').trim().toLowerCase()==='diretto');}
function agencyKey(value){return norm(value).replace(/\s/g,'');}
function agency(p){const isAgency=String(p.tipo_fonte_pratica||'').toUpperCase()==='AGENZIA_IMMOBILIARE'||String(p.provenienza?.categoria||'').toLowerCase()==='agenzia_immobiliare';return isAgency?String(p.segnalatore_riferimento||p.provenienza?.agenziaNome||'').trim():'';}
function reconcile(leads,practices,profiles={}){
  const possible=leads.map(l=>{const key=nameKey(l.name),uid=String(l.consultantUid||'');if(!key||!uid)return [];return practices.filter(p=>(sameNetwork(uid,owner(p),profiles)||String(p.collega_segnalato_uid||'')===uid)&&names(p).includes(key));});
  const frequency=new Map();for(const list of possible)for(const p of list)frequency.set(p.id,(frequency.get(p.id)||0)+1);
  const linked=new Map(),ambiguous=new Set(),ambiguousLeadIndices=new Set();possible.forEach((list,i)=>{if(list.length===1&&frequency.get(list[0].id)===1)linked.set(i,list[0]);else if(list.length){ambiguousLeadIndices.add(i);for(const p of list)ambiguous.add(p.id);}});
  const linkedPracticeIds=new Set([...linked.values()].map(p=>p.id));
  return {linked,ambiguous,ambiguousLeadIndices,linkedPracticeIds};
}
function agencyCounts(leads,practices,profiles={}){const groups=new Map(),counts={};for(const lead of leads){const label=displaySource(lead),key=agencyKey(label);if(!key||label==='Da verificare'||!lead.consultantUid)continue;if(!groups.has(label))groups.set(label,new Set());groups.get(label).add(String(lead.consultantUid));}for(const [label,owners] of groups)counts[label]=practices.filter(p=>[...owners].some(uid=>sameNetwork(uid,owner(p),profiles)||String(p.collega_segnalato_uid||'')===uid)&&agencyKey(agency(p))===agencyKey(label)).length;return counts;}
function conversions(items){const result={};for(const item of items){const metric=result[item.source]||(result[item.source]={leads:0,consultations:0,ambiguous:0});metric.leads++;if(item.matchStatus==='collegata'||item.matchStatus==='diretta')metric.consultations++;if(item.matchStatus==='da_verificare')metric.ambiguous++;}return result;}
module.exports={norm,nameKey,names,owner,sameNetwork,explicitDirect,agency,reconcile,agencyCounts,conversions};
