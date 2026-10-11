import base64
import datetime as dt
import hashlib
import json
import os
import re
import threading
import time
import uuid
import urllib.parse
from ai import AI
from buffer_api import BufferAPI
from assets import Assets
from auth import Auth,AccessDenied,admin,office_access,visible
from feeds import fetch
from network import HTTP,RemoteError
from publishers import Publishers,Pending,platform
from storage import make_store
from vault import Vault

CHANNELS=('Facebook post','Instagram post','Instagram carosello','Instagram Reel','Instagram Story','LinkedIn','TikTok')
SLOT_CHANNELS={'facebook':'Facebook post','instagram':'Instagram post','linkedin':'LinkedIn','story':'Instagram Story','reel':'Instagram Reel','tiktok':'TikTok'}
EDITABLE=('draft','scheduled','error','cancelled')

def now():return time.time()
def text(data,key,default='',maximum=5000,required=False):
    value=data.get(key,default)
    if not isinstance(value,str) or len(value)>maximum or (required and not value.strip()):raise ValueError(f'{key}: valore non valido')
    return value.strip()
def boolean(value):
    if type(value) is not bool:raise ValueError('Opzione non valida')
    return value

def timestamp(value):
    if not isinstance(value,str) or 'T' not in value:raise ValueError('Inserire data e ora')
    date=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    if date.tzinfo is None:raise ValueError('Data senza fuso orario: ricarica il calendario')
    return date.timestamp()

def personalize(body,office):
    tag=office.get('hashtag','')
    if tag:body=re.sub(r'(?i)(?<!\w)#credipass(?!\w)',lambda _:tag,body)
    signature=office.get('signature','')
    return body.strip()+ ('\n\n'+signature if signature else '')

def category(value):
    value=value.lower()
    for name,words in [('Cessione del quinto',['cessione del quinto','stipendio','pensione']),('Mutui',['mutuo','mutui','prima casa','surroga','consap']),('Prestiti',['prestito','prestiti','finanziamento']),('Assicurazioni',['polizza','assicurazione']),('Pillole',['consigli','lo sapevi','pillole'])]:
        if any(word in value for word in words):return name
    return 'Generale'

def media_list(value):
    if not isinstance(value,list) or len(value)>10:raise ValueError('Inserire al massimo 10 media')
    for item in value:
        if not isinstance(item,str):raise ValueError('Media non valido')
        if not (re.fullmatch(r'asset:[a-f0-9]{32}\.jpg',item) or (item.startswith('https://') and urllib.parse.urlsplit(item).hostname)):
            raise ValueError('Media: usare URL HTTPS o immagini caricate')
    return value

class Service:
    def __init__(self,settings,store=None,http=None):
        self.settings=settings;self.store=store or make_store(settings);self.http=http or HTTP()
        self.vault=Vault(settings,self.store);self.auth=Auth(settings,self.store)
        self.assets=Assets(settings);self.ai=AI(settings,self.vault,self.http)
        self.publishers=Publishers(settings,self.vault,self.http,self.assets)
        self.stop=threading.Event()
        for i,name,tag in [('1','Aversa','#CredipassAversa'),('2','Santa Maria Capua Vetere','#CredipassSantaMaria'),('3','Caserta','#CredipassCaserta')]:
            self.store.mutate('offices',i,lambda old,n=name,t=tag:None if old else {'name':n,'hashtag':t,'phone':'','whatsapp':'','signature':'Credipass '+n,'publishing_enabled':False,'editorial_mode':'approvazione','feed':'','auto_import':False})
    def get(self,collection,key):
        value=self.store.get(collection,str(key))
        if not value:raise ValueError('Elemento inesistente')
        return value
    def office(self,actor,key):
        office=self.get('offices',key);office_access(actor,office['id']);return office
    def public_state(self,actor):
        result={'actor':actor,'offices':[o for o in self.store.list('offices') if actor['role']=='admin' or o['id'] in actor['offices']]}
        for collection in ['posts','jobs','plans','connections']:
            result[collection]=[d for d in self.store.list(collection) if visible(actor,d)]
        for post in result['posts']+result['jobs']:
            try:post['previews']=[self.assets.url(m) for m in post.get('media',[])]
            except Exception:post['previews']=[]
            for slot in post.get('slots',{}).values():
                try:slot['preview']=self.assets.url(slot['media']) if slot.get('media') else ''
                except Exception:slot['preview']=''
        result['consultants']=self.auth.consultants(actor) if actor['role']=='admin' else []
        result['members']=self.store.list('members') if actor['role']=='admin' else []
        result['status']={'auth':self.settings.auth,'database':self.settings.store,'project':self.settings.project,
           'ai_configured':bool(self.ai.key()),'image_model':self.settings.image_model,'text_model':self.settings.openai_model,
           **{p+'_oauth_configured':bool(self.vault.read(p+'_app_id') and self.vault.read(p+'_app_secret') and self.settings.base_url) for p in ('instagram','linkedin')},
           'meta_oauth_configured':bool(self.vault.read('meta_app_id') and self.vault.read('meta_app_secret') and self.settings.base_url)}
        result['jobs'].sort(key=lambda j:j.get('scheduled_at',0))
        result['posts'].sort(key=lambda p:p.get('created_at',0),reverse=True)
        return result
    def connection(self,office_id,channel):
        candidates=[c for c in self.store.list('connections') if c['office_id']==office_id and c['platform']==platform(channel) and c.get('enabled')]
        return candidates[0] if candidates else None
    def save_office(self,actor,d):
        admin(actor);key=text(d,'id') or uuid.uuid4().hex
        old=self.store.get('offices',key) or {}
        mode=d.get('editorial_mode','approvazione')
        if mode not in ('approvazione','automatica'):raise ValueError('Modalità non valida')
        tag=text(d,'hashtag',maximum=100)
        if tag and not re.fullmatch(r'#\w+',tag):raise ValueError('Hashtag non valido')
        feed=text(d,'feed',maximum=2000)
        if feed and not feed.startswith('https://'):raise ValueError('Feed: usare un URL HTTPS')
        auto=boolean(d.get('auto_import',False))
        if auto and not feed:raise ValueError('Inserire il feed per attivare l’importazione')
        value={**old,'name':text(d,'name',required=True,maximum=200),'hashtag':tag,
          'phone':text(d,'phone',maximum=100),'whatsapp':text(d,'whatsapp',maximum=100),
          'signature':text(d,'signature'),'publishing_enabled':boolean(d.get('publishing_enabled',False)),
          'editorial_mode':mode,'feed':feed,'auto_import':auto}
        self.store.put('offices',value,key);return {'ok':True}
    def save_post(self,actor,d):
        office=self.office(actor,d.get('office_id',''))
        key=text(d,'id') or uuid.uuid4().hex
        old=self.store.get('posts',key)
        if old:office_access(actor,old['office_id'])
        value={**(old or {}),'office_id':office['id'],'title':text(d,'title',required=True,maximum=500),
             'body':text(d,'body',required=True),'media':media_list(d.get('media',[])),
             'created_at':(old or {}).get('created_at',now()),'sources':(old or {}).get('sources',[])}
        slots=d.get('slots',(old or {}).get('slots',{}))
        if not isinstance(slots,dict) or any(k not in SLOT_CHANNELS for k in slots):raise ValueError('Formato social non valido')
        clean={}
        for k,v in slots.items():
            if not isinstance(v,dict):raise ValueError('Slot non valido')
            media=media_list([v['media']]) if v.get('media') else []
            clean[k]={'media':media[0] if media else '', 'body':text(v,'body'),
                      'width':int(v.get('width',0)), 'height':int(v.get('height',0))}
            if not 0<=clean[k]['width']<=30000 or not 0<=clean[k]['height']<=30000:raise ValueError('Dimensioni non valide')
        value['slots']=clean
        value['day_label']=text(d,'day_label',(old or {}).get('day_label',''),maximum=80)
        value['category']=category(value['title']+' '+value['body'])
        self.store.put('posts',value,key);return {'ok':True,'id':key}
    def make_job(self,post,office,channel,when,mode='approvazione'):
        if channel not in CHANNELS:raise ValueError('Canale non valido')
        if when<=now():raise ValueError('Inserire date future')
        connection=self.connection(office['id'],channel)
        slot=next((post.get('slots',{}).get(k) for k,c in SLOT_CHANNELS.items() if c==channel),None)
        if slot and not slot.get('media'):raise ValueError('Carica l’immagine nello slot del social scelto')
        if slot and channel=='Instagram Reel':raise ValueError('La copertina Reel è un’immagine: per pubblicare serve un video, non la copertina')
        media=[slot['media']] if slot else post.get('media',[])
        body=(slot.get('body') or post['body']) if slot else post['body']
        return {'office_id':office['id'],'post_id':post['id'],'title':post['title'],
           'body':personalize(body,office),'media':media,'channel':channel,
           'scheduled_at':when,'created_at':now(),'status':'scheduled' if mode=='automatica' and office.get('publishing_enabled') and connection else 'draft',
           'connection_id':connection['id'] if connection else '', 'account_target':connection['external_id'] if connection else '', 'attempts':0,'last_error':'','remote':{}}
    def create_job(self,actor,d):
        post=self.get('posts',d.get('post_id',''));office_access(actor,post['office_id'])
        office=self.office(actor,d.get('office_id',''))
        if actor['role']!='admin' and office['id']!=post['office_id']:raise AccessDenied('Il post appartiene a un’altra sede')
        job=self.make_job(post,office,d.get('channel'),timestamp(d.get('scheduled')),office.get('editorial_mode'))
        job['approved_by']=actor['uid'] if job['status']=='scheduled' else ''
        job=self.store.put('jobs',job);return {'ok':True,'id':job['id']}
    def job_action(self,actor,d):
        key=text(d,'id',required=True);action=d.get('action')
        original=self.get('jobs',key);office=self.office(actor,original['office_id'])
        connection=self.connection(original['office_id'],original['channel'])
        if action=='approve':
            if not office.get('publishing_enabled'):raise ValueError('Abilita la pubblicazione nella sede prima di approvare')
            self.publishers.validate(original,connection)
        def change(job):
            if not job:raise ValueError('Programmazione inesistente')
            if job.get('_rev')!=original.get('_rev'):raise ValueError('La programmazione è cambiata: ricarica prima di modificarla')
            if job.get('remote',{}).get('buffer_attempted') or job['status'] in ('processing','published','manual_published','uncertain'):raise ValueError('Questa pubblicazione non può essere modificata o ripetuta automaticamente')
            if action=='assist':
                if job['status'] not in ('draft','error','cancelled','assisted'):raise ValueError('Annulla prima l’invio automatico programmato')
                job.update(status='assisted',connection_id='',account_target='',remote={},last_error='')
            elif action=='manual-published':
                if job['status']!='assisted':raise ValueError('Apri prima la pubblicazione assistita')
                from urllib.parse import urlsplit
                link=text(d,'url',required=True,maximum=2000); parsed=urlsplit(link)
                domains={'Instagram':('instagram.com','www.instagram.com'),'Facebook':('facebook.com','www.facebook.com'),'LinkedIn':('linkedin.com','www.linkedin.com'),'TikTok':('tiktok.com','www.tiktok.com')}
                if parsed.scheme!='https' or parsed.hostname not in domains.get(platform(job['channel']),()) or parsed.username or parsed.password or parsed.port not in (None,443):raise ValueError('Inserisci il link HTTPS della pubblicazione sul social corretto')
                job.update(status='manual_published',manual_url=link,manual_confirmed_by=actor['uid'],manual_confirmed_at=now())
            elif action=='cancel':job.update(status='cancelled')
            elif action=='approve':
                if job['scheduled_at']<=now():raise ValueError('La data è passata: riprogramma prima di approvare')
                job.update(status='scheduled',connection_id=connection['id'],account_target=connection['external_id'],approved_by=actor['uid'],approved_at=now(),last_error='')
            elif action=='edit':
                body=text(d,'body',required=True)
                when=timestamp(d.get('scheduled'))
                if when<=now():raise ValueError('Inserire date future')
                job.update(body=body,scheduled_at=when,media=media_list(d.get('media',job.get('media',[]))),status='draft',last_error='',remote={})
            else:raise ValueError('Azione non valida')
            return job
        self.store.mutate('jobs',key,change);return {'ok':True}
    def plan(self,actor,d):
        office=self.office(actor,d.get('office_id',''));topic=text(d,'topic',required=True,maximum=120)
        slots=d.get('slots');channel=d.get('channel','Instagram post')
        if channel not in CHANNELS:raise ValueError('Canale non valido')
        if not isinstance(slots,list) or not 1<=len(slots)<=31:raise ValueError('Specificare da 1 a 31 date')
        times=[timestamp(s) for s in slots]
        if min(times)<=now() or len(set(times))!=len(times):raise ValueError('Usare date future e distinte')
        engine=d.get('engine','local')
        if engine not in ('local','ai'):raise ValueError('Motore non valido')
        request_id=text(d,'request_id',required=True,maximum=64)
        if not re.fullmatch('[A-Za-z0-9-]+',request_id):raise ValueError('Richiesta non valida')
        op_key=hashlib.sha256((actor['uid']+request_id).encode()).hexdigest()
        prior=self.store.get('operations',op_key)
        if prior:
            if prior.get('status')=='complete':return prior['result']
            raise ValueError('Richiesta già avviata. Controlla archivio e calendario prima di generarne un’altra.')
        def reserve(old):
            if old:raise ValueError('Richiesta già avviata')
            return {'uid':actor['uid'],'status':'running','created_at':now()}
        self.store.mutate('operations',op_key,reserve)
        try:
            archive=[p for p in self.store.list('posts') if p['office_id']==office['id']]
            if engine=='ai':
                if not self.ai.key():raise ValueError('Configurare prima la chiave OpenAI')
                self.quota(actor,'plans',int(os.getenv('AI_DAILY_PLANS','5')))
                images=[]
                for post in archive[:12]:
                    for ref in post.get('media',[]):
                        if len(images)>=3:break
                        try:
                            import io
                            from PIL import Image
                            with Image.open(io.BytesIO(self.assets.bytes(ref,self.http))) as image:
                                image.thumbnail((512,512));buffer=io.BytesIO();image.convert('RGB').save(buffer,format='JPEG',quality=80)
                                images.append('data:image/jpeg;base64,'+base64.b64encode(buffer.getvalue()).decode())
                        except Exception:pass
                generated=self.ai.plan(topic,len(slots),archive,boolean(d.get('research',False)),images)
            else:
                generated=[{'title':f'{topic} · spunto {i+1}','body':f'{topic}\n\nApprofondire il tema con informazioni verificate. #Credipass','image_prompt':'','sources':[]} for i in range(len(slots))]
            plan_id=uuid.uuid4().hex;items=[]
            for index,content in enumerate(generated):
                post={**content,'category':category(content['title']+' '+content['body']),'office_id':office['id'],'created_at':now(),'media':[],'engine':engine,'plan_id':plan_id,'id':uuid.uuid4().hex}
                job=self.make_job(post,office,channel,times[index],office['editorial_mode'])
                if job['status']=='scheduled':job['approved_by']=actor['uid']
                items.extend([('posts',post['id'],post),('jobs',uuid.uuid4().hex,job)])
            items.append(('plans',plan_id,{'office_id':office['id'],'topic':topic,'engine':engine,'count':len(slots),'created_at':now()}))
            self.store.batch_create(items)
            result={'ok':True,'created':len(slots),'plan_id':plan_id}
            self.store.put('operations',{'uid':actor['uid'],'status':'complete','result':result},op_key)
            return result
        except Exception:
            self.store.put('operations',{'uid':actor['uid'],'status':'failed','created_at':now()},op_key)
            raise
    def quota(self,actor,kind,limit):
        key=hashlib.sha256((actor['uid']+kind+dt.datetime.now(dt.timezone.utc).date().isoformat()).encode()).hexdigest()
        def take(old):
            count=(old or {}).get('count',0)
            if count>=limit:raise ValueError('Limite AI giornaliero raggiunto')
            return {'count':count+1,'uid':actor['uid'],'kind':kind}
        self.store.mutate('operations',key,take)
    def generate_image(self,actor,d):
        post=self.get('posts',d.get('id',''));self.office(actor,post['office_id'])
        prompt=text(d,'prompt',post.get('image_prompt',''),required=True,maximum=3000)
        if not self.ai.key():raise ValueError('Configurare prima la chiave OpenAI')
        self.quota(actor,'images',int(os.getenv('AI_DAILY_IMAGES','10')))
        ref=self.assets.save_image(self.ai.image(prompt))
        post['media']=[ref];post['image_prompt']=prompt;self.store.put('posts',post,post['id'])
        # Jobs are snapshots. Invalidate approval when changing associated creative.
        for job in self.store.list('jobs'):
            if job['post_id']==post['id'] and job['status'] in ('draft','scheduled','error'):
                self.store.mutate('jobs',job['id'],lambda j: {**j,'media':[ref],'status':'draft','remote':{}} if j and not j.get('remote',{}).get('buffer_attempted') and j['status'] in ('draft','scheduled','error') else None)
        return {'ok':True,'media':ref}
    def save_connection(self,actor,d):
        admin(actor);office=self.office(actor,d.get('office_id',''));provider=d.get('platform')
        if provider not in ('Facebook','Instagram','LinkedIn','TikTok'):raise ValueError('Piattaforma non collegabile direttamente')
        external=text(d,'external_id',required=True,maximum=150)
        if provider in ('Facebook','Instagram') and not external.isdigit():raise ValueError('Inserire l’ID numerico dell’account')
        if provider=='LinkedIn' and not re.fullmatch(r'urn:li:(person|organization):[A-Za-z0-9_-]+',external):raise ValueError('Inserire un autore LinkedIn urn:li:person:ID o urn:li:organization:ID')
        token=text(d,'token',required=True,maximum=10000)
        key=hashlib.sha256((office['id']+provider).encode()).hexdigest()
        method=d.get('auth_method','facebook_login' if provider in ('Facebook','Instagram') else 'manual_token')
        if method not in ('facebook_login','instagram_login','linkedin_login','manual_token','buffer') or (method=='instagram_login' and provider!='Instagram') or (method=='linkedin_login' and provider!='LinkedIn'):raise ValueError('Metodo di accesso non valido')
        if (provider=='TikTok') != (method=='buffer'):raise ValueError('TikTok richiede il collegamento Buffer')
        if provider=='TikTok':
            verified=BufferAPI(self.http).channel(token,external)
            d={**d,'name':verified['name']}
            expiry=float(d.get('expires_at',0))
            if not expiry>now():raise ValueError('Inserisci la scadenza futura della chiave Buffer')
        # Probe access for Meta before replacing a working connection.
        if provider in ('Facebook','Instagram'):
            data=self.publishers.graph('GET','me?fields=user_id' if method=='instagram_login' else external+'?fields=id',token,host='instagram' if method=='instagram_login' else 'facebook')
            if str(data.get('user_id') if method=='instagram_login' else data.get('id'))!=external:raise ValueError('Il token non corrisponde all’account richiesto')
        self.vault.save('connection-'+key,token)
        self.store.put('connections',{'office_id':office['id'],'platform':provider,'external_id':external,
            'auth_method':method,'expires_at':float(d.get('expires_at',0)),
            'name':text(d,'name',provider,maximum=200),'enabled':True,'checked_at':now() if provider!='LinkedIn' else None,
            'state':'accesso verificato' if provider!='LinkedIn' else 'configurato; permessi da verificare alla prima pubblicazione'},key)
        return {'ok':True}
    def save_member(self,actor,d):
        admin(actor);uid=text(d,'uid',required=True,maximum=128)
        offices=d.get('offices',[])
        if not isinstance(offices,list):raise ValueError('Sedi non valide')
        for key in offices:self.get('offices',key)
        self.store.put('members',{'name':text(d,'name',uid,maximum=200),'role':'editor','offices':offices,'enabled':boolean(d.get('enabled',False))},uid)
        return {'ok':True}
    def import_feed(self,actor,d):
        office=self.office(actor,d.get('office_id',''));url=text(d,'url',office.get('feed',''),required=True,maximum=2000)
        entries=fetch(self.http,url);count=0
        for entry in entries:
            key=hashlib.sha256((office['id']+entry['source_key']).encode()).hexdigest()
            if not self.store.get('posts',key):
                self.store.mutate('posts',key,lambda old,e=entry:None if old else {**e,'category':category(e['title']+' '+e['body']),'office_id':office['id'],'created_at':now(),'engine':'rss'})
                count+=1
        return {'ok':True,'imported':count,'examined':len(entries)}
    def tick(self):
        for job in self.store.list('jobs'):
            if job['status']=='processing' and job.get('claimed_at',0)<now()-600:
                self.store.mutate('jobs',job['id'],lambda j:{**j,'status':'uncertain','last_error':'Esecuzione interrotta: verificare sul social prima di riprogrammare.'} if j['status']=='processing' and j.get('claimed_at',0)<now()-600 else None)
                continue
            if job['status']!='scheduled' or max(job['scheduled_at'],job.get('retry_at',0))>now():continue
            office=self.get('offices',job['office_id'])
            if not office.get('publishing_enabled'):continue
            owner=uuid.uuid4().hex
            def claim(j):
                if j['status']!='scheduled' or max(j['scheduled_at'],j.get('retry_at',0))>now():return None
                return {**j,'status':'processing','claim':owner,'claimed_at':now(),'attempts':j.get('attempts',0)+1}
            job=self.store.mutate('jobs',job['id'],claim)
            if job.get('claim')!=owner:continue
            def finish(changes):
                return self.store.mutate('jobs',job['id'],lambda current:{**current,**changes} if current.get('claim')==owner and current['status']=='processing' else None)
            def checkpoint(changes):
                self.store.mutate('jobs',job['id'],lambda current:{**current,'remote':{**current.get('remote',{}),**changes}} if current.get('claim')==owner and current['status']=='processing' else None)
            try:
                connection=self.get('connections',job['connection_id'])
                if connection['office_id']!=job['office_id']:raise ValueError('Account di un’altra sede')
                if connection['external_id']!=job.get('account_target'):raise ValueError('L’account è cambiato dopo l’approvazione: rivedere la programmazione')
                result=self.publishers.publish(job,connection,checkpoint)
                finish({'status':'published','published_at':now(),'remote_id':result['id'],'published_url':result.get('url',''),'last_error':''})
            except Pending as e:
                finish({'status':'scheduled' if job['attempts']<40 else 'error','retry_at':now()+60,'last_error':str(e)})
            except RemoteError as e:
                retry=not e.uncertain and (e.status==429 or e.status>=500 or e.status==0) and job['attempts']<3
                finish({'status':'uncertain' if e.uncertain else 'scheduled' if retry else 'error','retry_at':now()+60*job['attempts'],'last_error':str(e)})
            except Exception as e:
                finish({'status':'error','last_error':str(e) if isinstance(e,ValueError) else 'Errore interno. Controllare il servizio prima di riprovare.'})
    def import_tick(self):
        for office in self.store.list('offices'):
            if office.get('auto_import') and office.get('feed') and office.get('last_import',0)<now()-1800:
                owner=uuid.uuid4().hex
                def claim(o):
                    if o.get('last_import',0)>=now()-1800:return None
                    return {**o,'last_import':now(),'import_owner':owner}
                claimed=self.store.mutate('offices',office['id'],claim)
                if claimed.get('import_owner')==owner:
                    try:
                        self.import_feed({'role':'admin'}, {'office_id':office['id']})
                        error=''
                    except Exception:error='Importazione non riuscita: controllare il feed o la rete.'
                    self.store.mutate('offices',office['id'],lambda o:{**o,'import_error':error})
    def worker(self):
        while not self.stop.is_set():
            for operation in (self.tick,self.import_tick):
                try:operation()
                except Exception:print('Servizio: errore temporaneo o configurazione incompleta; nuovo controllo fra 15 secondi.',flush=True)
            self.stop.wait(15)
    def route(self,actor,path,d):
        routes={'office':self.save_office,'post':self.save_post,'job':self.create_job,'job/action':self.job_action,
          'plan':self.plan,'image':self.generate_image,'connection':self.save_connection,'member':self.save_member,'import':self.import_feed}
        if path in routes:return routes[path](actor,d)
        if path=='buffer/test':
            admin(actor);post=self.get('posts',text(d,'post_id',required=True));office=self.office(actor,post['office_id'])
            connection=self.connection(office['id'],'TikTok')
            if not connection:raise ValueError('Collega prima TikTok con Buffer')
            job=self.make_job(post,office,'TikTok',now()+3600,'approvazione')
            payload=self.publishers.buffer_payload(job,connection,draft=True)
            payload['text']='TEST SOCIAL HUB — BOZZA NON DA PUBBLICARE\n\n'+payload['text'][:2000]
            # Claim once per operator/post. Ambiguous draft creation is never repeated automatically.
            key=hashlib.sha256((actor['uid']+post['id']+'buffer-draft-test').encode()).hexdigest()
            owner=uuid.uuid4().hex
            claimed=self.store.mutate('operations',key,lambda old:None if old else {'owner':owner,'created_at':now()})
            if claimed.get('owner')!=owner:raise ValueError('Test già richiesto per questo contenuto: controlla le bozze in Buffer')
            result=BufferAPI(self.http).create(self.vault.read('connection-'+connection['id']),payload)
            self.store.put('operations',{'owner':owner,'created_at':now(),'buffer_id':result['id'],'status':result['status']},key)
            if result['status']!='draft':raise RemoteError('Stato del test inatteso: verificare subito il contenuto in Buffer',uncertain=True)
            return {'ok':True,'id':result['id'],'status':'draft'}
        if path=='buffer/channels':
            admin(actor);self.office(actor,d.get('office_id',''))
            return {'channels':BufferAPI(self.http).channels(text(d,'token',required=True,maximum=10000))}
        if path=='keys':
            admin(actor)
            for field in ['openai','meta_app_id','meta_app_secret','instagram_app_id','instagram_app_secret','linkedin_app_id','linkedin_app_secret']:
                if field in d:self.vault.save(field,text(d,field,required=True,maximum=10000))
            return {'ok':True}
        if path=='upload':
            self.office(actor,d.get('office_id',''))
            try:raw=base64.b64decode(d.get('data',''),validate=True)
            except ValueError:raise ValueError('File non valido') from None
            return {'ok':True,'media':self.assets.save_image(raw)}
        if path=='connection/disable':
            admin(actor);c=self.get('connections',d.get('id',''));c['enabled']=False
            self.store.put('connections',c,c['id']);return {'ok':True}
        raise ValueError('Operazione non trovata')
