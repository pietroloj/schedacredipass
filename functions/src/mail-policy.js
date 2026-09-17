// Subject-only V6 matching. No body, signature or sender-name matching.
const normalizePracticeNumber = value => String(value || "").trim().toUpperCase().replace(/\s+/g, "").replace(/[.,;:]+$/g, "");
const EXCLUDED_SENDERS = new Set([
 "servizio.clienti@credipass.it", "consulenze@consulenza-credipass.it",
 "attivita.pratiche@credipass.it", "calendar-notification@google.com", "clienti@credipass.it"
]);
function addresses(value) {
 const values = Array.isArray(value) ? value : (value?.value || [value]);
 return values.flatMap(x => String(x?.address || x || "").match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+/gi) || []).map(x=>x.toLowerCase());
}
function excludedSender(value) { return addresses(value).some(x=>EXCLUDED_SENDERS.has(x)); }
function normSubject(v="") {
  return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toUpperCase().replace(/[^A-Z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function whole(subject,value) {
  const s=` ${normSubject(subject)} `, v=normSubject(value);
  return !!v && s.includes(` ${v} `);
}
function subjects(data={}) {
  const out=[], add=(n,c)=>{n=String(n||"").trim();c=String(c||"").trim();if(n&&c)out.push({n,c});};
  add(data.cliente_nome,data.cliente_cognome); add(data.cliente2_nome,data.cliente2_cognome);
  add(data.r1_nome,data.r1_cognome); add(data.r2_nome,data.r2_cognome);
  add(data.nome,data.cognome); add(data.nome_cliente,data.cognome_cliente);
  add(data.nomeCliente,data.cognomeCliente); add(data.richiedente_nome,data.richiedente_cognome);
  add(data.richiedenteNome,data.richiedenteCognome); add(data.nome_richiedente,data.cognome_richiedente);
  for(const arr of [data.soggetti_pratica,data.soggetti,data.richiedenti,data.intestatari,data.clienti]){
    if(!arr || typeof arr!=="object")continue;
    for(const p of (Array.isArray(arr)?arr:Object.values(arr))) if(p&&typeof p==="object") add(p.nome||p.firstName||p.nome_cliente,p.cognome||p.lastName||p.cognome_cliente);
  }
  const seen=new Set();
  return out.filter(p=>{const k=`${normSubject(p.n)}|${normSubject(p.c)}`;if(seen.has(k))return false;seen.add(k);return true;});
}
function trustedNumbers(data={}) {
  return [...new Set([...(Array.isArray(data.mail_matching?.numeri_pratica_manual)?data.mail_matching.numeri_pratica_manual:[]),
    ...(Array.isArray(data.numeri_pratica_banca_manual)?data.numeri_pratica_banca_manual:[]),
    ...(data.mail_matching?.numeri_pratica_appresi || []),data.mail_matching?.numero_pratica_manual,
    data.numero_pratica_banca,data.numeroPraticaBanca].map(normalizePracticeNumber).filter(x=>/\d/.test(x)))];
}
function strictSubject(subject,data={}) {
  for(const number of trustedNumbers(data)) if(whole(subject,number))
    return {matched:true,method:"subject_practice_number",practiceNumber:number,score:3000};
  const s=` ${normSubject(subject)} `;
  for(const full of [data.cliente_nome_completo,data.cliente2_nome_completo]) {
    if(normSubject(full).split(" ").length>1 && whole(subject,full))
      return {matched:true,method:"subject_full_name",practiceNumber:"",score:2000};
  }
  for(const p of subjects(data)){
    const n=normSubject(p.n),c=normSubject(p.c);
    if(s.includes(` ${n} ${c} `)||s.includes(` ${c} ${n} `))
      return {matched:true,method:"subject_full_name",practiceNumber:"",score:2000};
  }
  for(const p of subjects(data)){
    const n=normSubject(p.n),c=normSubject(p.c),i=n.charAt(0);
    if(i&&(s.includes(` ${c} ${i} `)||s.includes(` ${i} ${c} `)))
      return {matched:true,method:"subject_surname_initial",practiceNumber:"",score:1500};
  }
  return {matched:false,method:null,practiceNumber:"",score:0};
}
function extractLabeledPracticeNumbersFromSubject(subject = "") {
  const raw = String(subject || "");
  const patterns = [
    /\bn[°º.]\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{4,30})\b/gi,
    /\[([A-Z0-9][A-Z0-9._\/-]{4,30})\]/gi,
    /\b(?:n(?:umero)?\.?\s*)?pratica\s*(?:n(?:umero)?\.?\s*)?[:#\-]?\s*([A-Z0-9][A-Z0-9._\/-]{4,30})\b/gi,
    /\brif(?:erimento)?\.?\s*(?:pratica)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9._\/-]{4,30})\b/gi,
    /\bid\s*pratica\s*[:#\-]?\s*([A-Z0-9][A-Z0-9._\/-]{4,30})\b/gi,
  ];
  const out=[];
  for(const pattern of patterns){
    let m;
    while((m=pattern.exec(raw))!==null){
      const v=normalizePracticeNumber(m[1]);
      if(v&&v.length>=5&&/\d/.test(v)&&!out.includes(v))out.push(v);
    }
  }
  return out;
}

module.exports = {strictSubject, subjects, trustedNumbers, extractLabeledPracticeNumbersFromSubject, excludedSender, addresses};
