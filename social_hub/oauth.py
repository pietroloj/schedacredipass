"""Meta authorization-code flow with single-use state and explicit page selection."""
import json
import secrets
import time
import urllib.parse
from auth import admin

class MetaOAuth:
    def __init__(self,service):self.hub=service
    def redirect_uri(self):
        base=self.hub.settings.base_url
        if not base.startswith('https://'):raise ValueError('Configurare PUBLIC_BASE_URL HTTPS e il redirect Meta autorizzato')
        return base+'/oauth/meta/callback'
    def start(self,actor,d):
        admin(actor);office=self.hub.office(actor,d.get('office_id',''))
        app_id=self.hub.vault.read('meta_app_id')
        if not app_id or not self.hub.vault.read('meta_app_secret'):raise ValueError('Configurare ID e segreto applicazione Meta')
        state=secrets.token_urlsafe(32)
        self.hub.store.put('operations',{'type':'oauth','uid':actor['uid'],'office_id':office['id'],'expires':time.time()+600,'used':False},state)
        query=urllib.parse.urlencode({'client_id':app_id,'redirect_uri':self.redirect_uri(),'state':state,'response_type':'code',
              'scope':('pages_show_list,pages_read_engagement,pages_manage_posts,read_insights,pages_messaging'+(',instagram_basic,instagram_content_publish,instagram_manage_insights,instagram_manage_messages' if d.get('platform')=='Instagram' else '')) if d.get('community') is True else 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish'})
        return {'url':'https://www.facebook.com/'+self.hub.settings.graph_version+'/dialog/oauth?'+query}
    def callback(self,params):
        state=params.get('state',[''])[0];code=params.get('code',[''])[0]
        if not code:raise ValueError('Collegamento annullato o autorizzazione non concessa')
        def consume(old):
            if not old or old.get('type')!='oauth' or old.get('used') or old['expires']<time.time():raise ValueError('Collegamento scaduto: ricomincia dalla pagina Collegamenti')
            return {**old,'used':True}
        session=self.hub.store.mutate('operations',state,consume)
        query=urllib.parse.urlencode({'client_id':self.hub.vault.read('meta_app_id'),'client_secret':self.hub.vault.read('meta_app_secret'),
               'redirect_uri':self.redirect_uri(),'code':code})
        base='https://graph.facebook.com/'+self.hub.settings.graph_version
        result=self.hub.http.request('GET',base+'/oauth/access_token?'+query)
        token=result['access_token']
        # Exchange for a long-lived user token before obtaining page tokens.
        query=urllib.parse.urlencode({'grant_type':'fb_exchange_token','client_id':self.hub.vault.read('meta_app_id'),
              'client_secret':self.hub.vault.read('meta_app_secret'),'fb_exchange_token':token})
        extended=self.hub.http.request('GET',base+'/oauth/access_token?'+query)
        data=self.hub.http.request('GET',base+'/me/accounts?fields=id,name,access_token,instagram_business_account&limit=100',headers={'Authorization':'Bearer '+extended['access_token']})
        pages=data.get('data',[])
        if not pages:raise ValueError('Nessuna pagina disponibile: verifica ruoli e autorizzazioni Meta')
        self.hub.vault.save('oauth-pages-'+state,json.dumps(pages))
        self.hub.store.put('operations',{**session,'ready':True,'expires':time.time()+600},state)
        return state
    def options(self,actor):
        admin(actor);items=[]
        for doc in self.hub.store.list('operations'):
            if doc.get('type')=='oauth' and doc.get('uid')==actor['uid'] and doc.get('ready') and doc['expires']>time.time():
                for page in json.loads(self.hub.vault.read('oauth-pages-'+doc['id']) or '[]'):
                    items.append({'session':doc['id'],'office_id':doc['office_id'],'page_id':page['id'],'name':page.get('name',page['id']),
                       'instagram':page.get('instagram_business_account',{}).get('id','')})
        return items
    def select(self,actor,d):
        admin(actor);session=self.hub.get('operations',d.get('session',''))
        if session.get('uid')!=actor['uid'] or not session.get('ready') or session['expires']<time.time():raise ValueError('Selezione scaduta')
        pages=json.loads(self.hub.vault.read('oauth-pages-'+session['id']))
        page=next((p for p in pages if p['id']==d.get('page_id')),None)
        if not page:raise ValueError('Pagina inesistente')
        self.hub.save_connection(actor,{'office_id':session['office_id'],'platform':'Facebook','external_id':page['id'],'name':page.get('name','Facebook'),'token':page['access_token']})
        instagram=page.get('instagram_business_account',{}).get('id')
        if instagram:self.hub.save_connection(actor,{'office_id':session['office_id'],'platform':'Instagram','external_id':instagram,'name':page.get('name','Instagram'),'token':page['access_token']})
        remaining=[p for p in pages if p['id']!=page['id']]
        self.hub.vault.save('oauth-pages-'+session['id'],json.dumps(remaining))
        self.hub.store.put('operations',{**session,'ready':bool(remaining)},session['id'])
        return {'ok':True}
