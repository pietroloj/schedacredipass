"""Direct professional Instagram and personal LinkedIn authorization.
Tokens remain encrypted; the owner must confirm the returned identity.
"""
import json
import secrets
import time
from urllib.parse import urlencode
from auth import admin

PROVIDERS = {
 'instagram': ('https://www.instagram.com/oauth/authorize', 'instagram_business_basic,instagram_business_content_publish'),
 'linkedin': ('https://www.linkedin.com/oauth/v2/authorization', 'openid profile w_member_social'),
}

class DirectOAuth:
    def __init__(self, hub, provider):
        if provider not in PROVIDERS: raise ValueError('Provider non valido')
        self.hub, self.provider = hub, provider
    def redirect_uri(self):
        if not self.hub.settings.base_url.startswith('https://'): raise ValueError('Configurare un indirizzo HTTPS pubblico')
        return self.hub.settings.base_url+'/oauth/'+self.provider+'/callback'
    def key(self, suffix): return self.hub.vault.read(self.provider+'_app_'+suffix)
    def start(self, actor, data):
        admin(actor); office=self.hub.office(actor,data.get('office_id',''))
        if not self.key('id') or not self.key('secret'): raise ValueError('Completare la configurazione dell’app '+self.provider)
        state=secrets.token_urlsafe(32)
        self.hub.store.put('operations',{'type':'direct-oauth','provider':self.provider,'uid':actor['uid'],'office_id':office['id'],'expires':time.time()+600,'used':False},state)
        query={'client_id':self.key('id'),'redirect_uri':self.redirect_uri(),'response_type':'code','state':state,'scope':PROVIDERS[self.provider][1]}
        if self.provider=='instagram': query['enable_fb_login']='false'
        return {'url':PROVIDERS[self.provider][0]+'?'+urlencode(query)}
    def callback(self, params):
        state=params.get('state',[''])[0]; code=params.get('code',[''])[0]
        if not code: raise ValueError('Autorizzazione annullata')
        def consume(old):
            if not old or old.get('type')!='direct-oauth' or old.get('provider')!=self.provider or old.get('used') or old['expires']<time.time(): raise ValueError('Autorizzazione scaduta: ricomincia dal Social Hub')
            return {**old,'used':True}
        session=self.hub.store.mutate('operations',state,consume)
        endpoint='https://api.instagram.com/oauth/access_token' if self.provider=='instagram' else 'https://www.linkedin.com/oauth/v2/accessToken'
        result=self.hub.http.request('POST',endpoint,urlencode({'client_id':self.key('id'),'client_secret':self.key('secret'),'grant_type':'authorization_code','redirect_uri':self.redirect_uri(),'code':code}).encode(),{'Content-Type':'application/x-www-form-urlencoded'})
        if self.provider=='instagram':
            result=result.get('data',[result])[0]
            permissions=result.get('permissions')
            if permissions is not None and not all(p in permissions for p in PROVIDERS['instagram'][1].split(',')): raise ValueError('Permessi Instagram incompleti')
            result=self.hub.http.request('GET','https://graph.instagram.com/access_token?'+urlencode({'grant_type':'ig_exchange_token','client_secret':self.key('secret'),'access_token':result['access_token']}))
            identity=self.hub.http.request('GET','https://graph.instagram.com/'+self.hub.settings.graph_version+'/me?fields=user_id,username',headers={'Authorization':'Bearer '+result['access_token']})
            external=str(identity.get('user_id','')); name=identity.get('username','Instagram')
            if not external.isdigit(): raise ValueError('Identità Instagram non verificabile')
        else:
            identity=self.hub.http.request('GET','https://api.linkedin.com/v2/userinfo',headers={'Authorization':'Bearer '+result['access_token']})
            if not identity.get('sub'): raise ValueError('Identità LinkedIn non verificabile')
            external='urn:li:person:'+identity['sub']; name=identity.get('name','LinkedIn')
        expires=int(result.get('expires_in',0))
        if expires<=0: raise ValueError('Scadenza del token assente')
        payload={'token':result['access_token'],'external_id':external,'name':name,'expires_at':time.time()+expires}
        self.hub.vault.save('direct-oauth-'+state,json.dumps(payload))
        self.hub.store.put('operations',{**session,'ready':True,'expires':time.time()+600,'name':name,'external_id':external},state)
        return state
    def options(self,actor):
        admin(actor)
        return [{k:d[k] for k in ('id','name','external_id','office_id')} for d in self.hub.store.list('operations') if d.get('type')=='direct-oauth' and d.get('provider')==self.provider and d.get('uid')==actor['uid'] and d.get('ready') and d['expires']>time.time()]
    def select(self,actor,data):
        admin(actor); state=data.get('session','')
        def consume(old):
            if not old or old.get('provider')!=self.provider or old.get('uid')!=actor['uid'] or not old.get('ready') or old['expires']<time.time(): raise ValueError('Selezione scaduta')
            self.hub.office(actor,old['office_id'])
            return {**old,'ready':False}
        session=self.hub.store.mutate('operations',state,consume)
        payload=json.loads(self.hub.vault.read('direct-oauth-'+state))
        try:
            self.hub.save_connection(actor,{**payload,'office_id':session['office_id'],'platform':'Instagram' if self.provider=='instagram' else 'LinkedIn','auth_method':self.provider+'_login'})
        finally: self.hub.vault.save('direct-oauth-'+state,'{}')
        return {'ok':True}
