// Display names only: never infer authorisation or ownership from an AI guess.
const {BANK_DOMAIN_SEED}=require("./mail-bank-domains.seed");
const {addresses}=require("./mail-policy");
function bankName(email={},practice={}) {
 const verifiedBrands={"isybank.com":"isybank","fideuram.it":"Fideuram","webank.it":"Webank","widiba.it":"Banca Widiba","findomestic.it":"Findomestic"};
 const domains=[email.dominio,...addresses(email.mittente).map(x=>x.split("@")[1])].filter(Boolean).map(x=>String(x).toLowerCase());
 for(const [domain,name] of Object.entries(verifiedBrands))if(domains.some(x=>x===domain||x.endsWith("."+domain)))return name;
 for(const bank of BANK_DOMAIN_SEED){
  if(bank.domains.some(d=>domains.some(x=>x===d||x.endsWith("."+d))))return bank.bancaNome;
 }
 const value=String(email.banca||practice.banca_nome||practice.banca||"").trim();
 const known=BANK_DOMAIN_SEED.find(x=>x.bancaKey===email.bancaKey || x.bancaNome.toLowerCase()===value.toLowerCase() || x.domains.includes(value.toLowerCase()));
 return known?.bancaNome || (value&&!/^[\w.-]+\.[a-z]{2,}$/i.test(value)?value:"");
}
module.exports={bankName};
