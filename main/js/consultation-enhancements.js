(()=>{
const boot=()=>{
 const app=document.getElementById('app_main_container');if(!app)return;
 const panel=document.createElement('section');panel.style.cssText='padding:24px;margin:24px 0;border:1px solid #dbe3ec;border-radius:12px;background:#fff';app.querySelector(".btn-wrapper")?.before(panel);
 const openQuote=document.createElement('button');openQuote.type='button';openQuote.className='btn-action';openQuote.style.cssText='background:#002d72;color:#fff;margin:12px 0';openQuote.textContent='Apri preventivatore';panel.after(openQuote);const modal=document.createElement('dialog');modal.style.cssText='width:95vw;max-width:1500px;height:92vh;border:0;border-radius:14px;padding:0;box-shadow:0 15px 60px #001c4680';const bar=document.createElement('div');bar.style.cssText='display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#002d72;color:white';const title=document.createElement('strong');title.textContent='Preventivatore · verifica indici e condizioni';const close=document.createElement('button');close.type='button';close.textContent='Chiudi';close.onclick=()=>modal.close();bar.append(title,close);const frame=document.createElement('iframe');frame.title='Preventivatore';frame.sandbox='allow-scripts allow-modals';frame.style.cssText='border:0;width:100%;height:calc(100% - 48px)';modal.append(bar,frame);document.body.append(modal);openQuote.onclick=()=>{frame.src='/main/preventivatore.html';modal.showModal();};frame.onload=()=>{const r=CredipassRatio.calculate(window.consultationRatio.getData());frame.contentWindow.postMessage({type:'credipass-preventivo',values:{importo:CredipassRatio.amount(document.getElementById('mutuo_importo')?.value),valore:CredipassRatio.amount(document.getElementById('immobile_valore')?.value),reddito:r.income}},'*');};
 let manual=false;
 const initial=()=>({income1:CredipassRatio.amount(document.getElementById('cliente_reddito')?.value),income2:CredipassRatio.amount(document.getElementById('cliente2_reddito')?.value),mortgage:0,commitments:[...(typeof getFinanziamentiDettaglio==='function'?getFinanziamentiDettaglio().map(x=>({label:x.istituto||'Finanziamento',amount:CredipassRatio.amount(x.rata)})):[]),...(CredipassRatio.amount(document.getElementById('rata_mutuo_pre')?.value)>0?[{label:'Mutuo già in corso',amount:CredipassRatio.amount(document.getElementById('rata_mutuo_pre').value)}]:[])],extra:typeof getFittiDettaglio==='function'?getFittiDettaglio().map(x=>({label:x.descrizione||'Reddito da affitto',amount:CredipassRatio.amount(x.importo)})):[]});

 function mount(d){window.consultationRatio=CredipassRatio.mount(panel,d,()=>{});}
 mount(initial());
 let refreshTimer;function refresh(){const old=window.consultationRatio.getData();mount({...initial(),mortgage:old.mortgage});}
 app.addEventListener('input',e=>{if(panel.contains(e.target))return;clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,120);});
 app.addEventListener('change',e=>{if(!panel.contains(e.target))refresh();});

 const original=window.compilaPDF;
 window.compilaPDF=function(){original();const sheet=document.getElementById('print-sheet');if(!sheet)return;document.getElementById('complete-sheet-appendix')?.remove();const section=document.createElement('section');section.id='complete-sheet-appendix';section.style.cssText='page-break-before:always;padding:24px;color:#243447;font:12px Arial;';const title=document.createElement('h2');title.textContent='Dettaglio completo della consulenza';section.appendChild(title);const table=document.createElement('table');table.style.cssText='width:100%;border-collapse:collapse';const seen=new Set();
 for(const el of app.querySelectorAll('input,select,textarea')){
 if(panel.contains(el)||['button','submit','hidden','password','file'].includes(el.type)||((el.type==='checkbox'||el.type==='radio')&&!el.checked))continue;
 const key=el.id||el.name;if(!key||seen.has(key))continue;seen.add(key);
 const label=document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent||el.closest('label')?.textContent||el.previousElementSibling?.textContent||key.replace(/_/g,' ');
 const value=el.tagName==='SELECT'?el.selectedOptions[0]?.textContent:el.type==='checkbox'?'Sì':el.value;
 if(!value)continue;
 const row=document.createElement('tr');row.style.breakInside='avoid';for(const t of [label.trim().slice(0,150),String(value)]){const cell=document.createElement('td');cell.textContent=t;cell.style.cssText='padding:7px;border-bottom:1px solid #ddd;vertical-align:top;white-space:pre-wrap';row.appendChild(cell);}table.appendChild(row);
 }
 section.appendChild(table);const r=CredipassRatio.calculate(window.consultationRatio.getData());const summary=document.createElement('p');summary.textContent=`Rapporto rata/reddito: ${r.ratio===null?'non calcolabile':r.ratio.toFixed(1)+'%'} · Redditi: € ${r.income.toFixed(2)} · Rate e impegni: € ${r.total.toFixed(2)} · Residuo: € ${r.residual.toFixed(2)}`;section.appendChild(summary);section.style.flex='0 0 100%';section.style.boxSizing='border-box';sheet.style.flexWrap='wrap';sheet.appendChild(section);sheet.style.height='auto';sheet.style.maxHeight='none';sheet.style.overflow='visible';};
};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
