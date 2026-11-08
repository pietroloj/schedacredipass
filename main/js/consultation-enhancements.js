(()=>{
const boot=()=>{
 const app=document.getElementById('app_main_container');if(!app)return;
 const panel=document.createElement('section');panel.style.cssText='padding:24px;margin:24px 0;border:1px solid #dbe3ec;border-radius:12px;background:#fff';app.appendChild(panel);
 let manual=false;
 const initial=()=>({income1:CredipassRatio.amount(document.getElementById('cliente_reddito')?.value),income2:CredipassRatio.amount(document.getElementById('cliente2_reddito')?.value),mortgage:0,commitments:[...(typeof getFinanziamentiDettaglio==='function'?getFinanziamentiDettaglio().map(x=>({label:x.istituto||'Finanziamento',amount:CredipassRatio.amount(x.rata)})):[]),...(CredipassRatio.amount(document.getElementById('rata_mutuo_pre')?.value)>0?[{label:'Mutuo già in corso',amount:CredipassRatio.amount(document.getElementById('rata_mutuo_pre').value)}]:[])],extra:typeof getFittiDettaglio==='function'?getFittiDettaglio().map(x=>({label:x.descrizione||'Reddito da affitto',amount:CredipassRatio.amount(x.importo)})):[]});

 function mount(d){window.consultationRatio=CredipassRatio.mount(panel,d,()=>{});}
 mount(initial());const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Riprendi redditi e rate dalla scheda';refresh.onclick=()=>{const old=window.consultationRatio.getData();mount({...initial(),mortgage:old.mortgage,extra:old.extra});panel.appendChild(refresh);};panel.appendChild(refresh);
 document.addEventListener('input',e=>{if(['cliente_reddito','cliente2_reddito','rata_mutuo_pre'].includes(e.target.id)){const d=window.consultationRatio.getData(),current=initial();mount({...d,income1:current.income1,income2:current.income2,mortgage:d.mortgage});panel.appendChild(refresh);}});
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
