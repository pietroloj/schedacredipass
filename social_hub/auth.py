"""Firebase identity plus server-side office ACLs. No client-supplied roles."""
import os
from storage import firebase_app

class AccessDenied(Exception):pass

class Auth:
    def __init__(self,settings,store):self.settings,self.store=settings,store
    def consultants(self,actor):
        admin(actor)
        if self.settings.auth!='firebase':return []
        from firebase_admin import firestore
        db=firestore.client(app=firebase_app(self.settings))
        result=[]
        for doc in db.collection('consulenti').limit(1000).stream():
            profile=doc.to_dict()
            if profile.get('attivo') is False:continue
            name=' '.join(str(profile.get(k,'')) for k in ('nome','cognome')).strip()
            result.append({'id':doc.id,'name':name or profile.get('email') or doc.id})
        return sorted(result,key=lambda p:p['name'].lower())
    def actor(self,headers):
        if self.settings.auth=='local':return {'uid':'local-owner','role':'admin','offices':[],'name':'Amministratore locale'}
        bearer=headers.get('Authorization','')
        if not bearer.startswith('Bearer '):raise AccessDenied('Accedi con il tuo account Firebase')
        from firebase_admin import auth,firestore
        try:
            decoded=auth.verify_id_token(bearer[7:],app=firebase_app(self.settings),check_revoked=True)
        except Exception:raise AccessDenied('Sessione scaduta o non valida') from None
        uid=decoded['uid']
        # Same administrator predicate as the existing Scheda Consulenza.
        db=firestore.client(app=firebase_app(self.settings))
        consultant=db.collection('consulenti').document(uid).get()
        profile=consultant.to_dict() if consultant.exists else {}
        if profile.get('attivo') is False:raise AccessDenied('Utente disabilitato nella Scheda Consulenza')
        admin=str(profile.get('ruolo','')).lower()=='admin' or uid in os.getenv('FIREBASE_ADMIN_UIDS','').split(',')
        member=self.store.get('members',uid) or {}
        if not admin and member.get('enabled') is not True:raise AccessDenied('Accesso Social Hub non abilitato')
        return {'uid':uid,'name':decoded.get('name',decoded.get('email',uid)),
                'role':'admin' if admin else member.get('role','editor'),'offices':member.get('offices',[])}

def admin(actor):
    if actor['role']!='admin':raise AccessDenied('Operazione riservata agli amministratori')

def office_access(actor,office_id):
    if actor['role']!='admin' and office_id not in actor.get('offices',[]):raise AccessDenied('Sede non autorizzata')

def visible(actor,doc):
    return actor['role']=='admin' or doc.get('office_id') in actor.get('offices',[])
