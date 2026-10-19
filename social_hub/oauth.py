"""Meta authorization-code flow with single-use state and explicit page selection."""
import json
import secrets
import time
import urllib.parse
from auth import admin
from network import RemoteError

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
        pages,warnings=self.discover_pages(base,extended['access_token'])
        if not pages:raise ValueError('Nessuna pagina disponibile: verifica ruoli e autorizzazioni Meta')
        self.hub.vault.save('oauth-pages-'+state,json.dumps(pages))
        self.hub.store.put('operations',{**session,'ready':True,'expires':time.time()+600,'discovery_warnings':warnings},state)
        return state
    def discover_pages(self,base,token):
        headers={'Authorization':'Bearer '+token};pages={};warnings=[];cursor='';seen=set()
        for _ in range(10):
            query={'fields':'id,name,access_token,instagram_business_account','limit':100}
            if cursor:query['after']=cursor
            data=self.hub.http.request('GET',base+'/me/accounts?'+urllib.parse.urlencode(query),headers=headers)
            for page in data.get('data',[]):
                if isinstance(page,dict) and str(page.get('id','')).isdigit() and page.get('access_token'):pages[str(page['id'])]={**page,'id':str(page['id'])}
            paging=data.get('paging',{})
            if not paging.get('next'):break
            cursor=paging.get('cursors',{}).get('after') or urllib.parse.parse_qs(urllib.parse.urlsplit(paging['next']).query).get('after',[''])[0]
            if not isinstance(cursor,str) or not cursor or len(cursor)>2048 or cursor in seen:raise ValueError('Paginazione Meta non valida: riprova il collegamento')
            seen.add(cursor)
        else:raise ValueError('Elenco Meta oltre il limite: autorizza un gruppo più piccolo di pagine')
        # A selected Page can be absent from /me/accounts. Query only Page IDs
        # explicitly granted to this app; never probe guessed or user-entered IDs.
        try:
            debug=self.hub.http.request('GET',base+'/debug_token?'+urllib.parse.urlencode({'input_token':token}),headers={'Authorization':'Bearer '+self.hub.vault.read('meta_app_id')+'|'+self.hub.vault.read('meta_app_secret')}).get('data',{})
            if debug.get('is_valid') is not True or str(debug.get('app_id'))!=self.hub.vault.read('meta_app_id'):raise ValueError('Grant non verificato')
            targets=set()
            for grant in debug.get('granular_scopes',[]):
                if grant.get('scope') in ('pages_show_list','pages_read_engagement','pages_manage_posts'):
                    targets.update(str(i) for i in grant.get('target_ids',[]) if str(i).isdigit())
            if len(targets)>1000:raise ValueError('Troppe risorse autorizzate')
            for pid in sorted(targets-pages.keys()):
                try:
                    page=self.hub.http.request('GET',base+'/'+pid+'?fields=id,name,access_token',headers=headers)
                    if str(page.get('id'))!=pid or not page.get('access_token'):raise ValueError('Token pagina non disponibile')
                    pages[pid]={**{k:page[k] for k in ('name','access_token') if k in page},'id':pid}
                except (RemoteError,ValueError):warnings.append('Pagina '+pid+': Meta non ha fornito un accesso utilizzabile. Verifica ruolo sulla pagina e permessi dell’app.')
        except (RemoteError,ValueError):warnings.append('Meta non ha consentito la verifica delle pagine selezionate. Sono mostrate le pagine restituite dall’elenco standard.')
        return list(pages.values()),warnings
    def options(self,actor):
        admin(actor);items=[]
        for doc in self.hub.store.list('operations'):
            if doc.get('type')=='oauth' and doc.get('uid')==actor['uid'] and doc.get('ready') and doc['expires']>time.time():
                for page in json.loads(self.hub.vault.read('oauth-pages-'+doc['id']) or '[]'):
                    items.append({'session':doc['id'],'office_id':doc['office_id'],'page_id':page['id'],'name':page.get('name',page['id']),
                       'instagram':page.get('instagram_business_account',{}).get('id',''),'discovery_warnings':doc.get('discovery_warnings',[])})
        return items
    def select(self,actor,d):
        admin(actor);session=self.hub.get('operations',d.get('session',''))
        if session.get('uid')!=actor['uid'] or not session.get('ready') or session['expires']<time.time():raise ValueError('Selezione scaduta')
        pages=json.loads(self.hub.vault.read('oauth-pages-'+session['id']))
        page=next((p for p in pages if p['id']==d.get('page_id')),None)
        if not page:raise ValueError('Pagina inesistente')
        office_id=d.get('office_id',session['office_id'])
        self.hub.office(actor,office_id)
        self.hub.save_connection(actor,{'office_id':office_id,'platform':'Facebook','external_id':page['id'],'name':page.get('name','Facebook'),'token':page['access_token']})
        instagram=page.get('instagram_business_account',{}).get('id')
        if instagram:self.hub.save_connection(actor,{'office_id':office_id,'platform':'Instagram','external_id':instagram,'name':page.get('name','Instagram'),'token':page['access_token']})
        remaining=[p for p in pages if p['id']!=page['id']]
        self.hub.vault.save('oauth-pages-'+session['id'],json.dumps(remaining))
        self.hub.store.put('operations',{**session,'ready':bool(remaining)},session['id'])
        return {'ok':True}
