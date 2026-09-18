const {addresses}=require('./mail-policy');
function replyRecipients(email,self=[],all=false){
 const own=new Set(addresses(self));
 const clean=x=>[...new Set(addresses(x))].filter(a=>!own.has(a));
 const sent=email.direzione==='inviata';
 const primary=clean(sent?email.destinatari:(email.replyTo?.length?email.replyTo:email.mittente));
 const to=clean(all&&!sent?[...primary,...addresses(email.destinatari)]:primary);
 const cc=all?clean(email.cc).filter(a=>!to.includes(a)):[];
 return {to,cc};
}
function validateRecipients(value,self=[]){
 const pieces=Array.isArray(value)?value:String(value||'').split(/[;,]/);
 if(pieces.length>100)throw new Error('Massimo 100 destinatari.');
 const result=[];
 for(const part of pieces){const email=String(part||'').trim().toLowerCase();if(!email)continue;
  if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email)||/[\r\n]/.test(email))throw new Error('Indirizzo non valido: '+email);
  if(!addresses(self).includes(email)&&!result.includes(email))result.push(email);
 }
 return result;
}
module.exports={replyRecipients,validateRecipients};
