const crypto=require('node:crypto');
const {OAuth2Client}=require('google-auth-library');
let cached;
async function verify(event){
 const token=String(event.headers?.authorization||event.headers?.Authorization||'').replace(/^Bearer /,'');if(!token)throw Error('Accesso richiesto');
 const parts=token.split('.');if(parts.length!==3)throw Error('Token non valido');
 const payload=JSON.parse(Buffer.from(parts[1],'base64url')),header=JSON.parse(Buffer.from(parts[0],'base64url'));
 if(payload.iss==='https://securetoken.google.com/consulenza-credipass'){
 if(header.alg!=='RS256'||payload.aud!=='consulenza-credipass'||payload.exp<Date.now()/1000||payload.iat>Date.now()/1000+60||!payload.sub)throw Error('Sessione scaduta');
 if(!cached||cached.expires<Date.now()){const r=await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');if(!r.ok)throw Error('Verifica accesso non disponibile');cached={keys:await r.json(),expires:Date.now()+1800000};}
 const cert=cached.keys[header.kid];if(!cert||!crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),cert,Buffer.from(parts[2],'base64url')))throw Error('Token non valido');
 const url='https://firestore.googleapis.com/v1/projects/consulenza-credipass/databases/(default)/documents/consulenti/'+encodeURIComponent(payload.sub);
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Account non abilitato');const d=(await r.json()).fields||{};
 if(d.attivo?.booleanValue===false)throw Error('Account disattivato');
 const role=d.ruolo?.stringValue;const enabled=d.permessi?.mapValue?.fields?.invia_email?.booleanValue;
 if(role!=='admin'&&!(enabled===true||(enabled===undefined&&['consulente','responsabile','segreteria','collaboratore'].includes(role))))throw Error('Invio email non consentito');
 return payload;
 }
 const ticket=await new OAuth2Client().verifyIdToken({idToken:token,audience:'https://consulenza-credipass.it/api/send-email'}),p=ticket.getPayload();
 if(!p.email_verified||!['446449843576-compute@developer.gserviceaccount.com','consulenza-credipass@appspot.gserviceaccount.com'].includes(p.email))throw Error('Servizio non autorizzato');
 return p;
}
module.exports={verify};
