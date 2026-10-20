"""Real API adapters. All public writes explicitly mark ambiguous outcomes."""
import json
import time
import re
import urllib.parse
from network import RemoteError,public_url
from buffer_api import BufferAPI

class Pending(Exception):pass

def platform(channel):
    if channel.startswith('Instagram'):return 'Instagram'
    if channel.startswith('Facebook'):return 'Facebook'
    if channel.startswith('LinkedIn'):return 'LinkedIn'
    return channel

ASSISTED_CHANNELS=('Facebook Reel','Facebook video','LinkedIn documento','LinkedIn video')

def is_video(ref):return bool(re.search(r'\.(mp4|mov|webm)(\?|$)',ref,re.I))

class Publishers:
    def __init__(self,settings,vault,http,assets):self.settings,self.vault,self.http,self.assets=settings,vault,http,assets
    def validate(self,job,connection):
        if job['channel'] in ASSISTED_CHANNELS:raise ValueError('Questo formato richiede la pubblicazione assistita: apri i file e completa l’invio sul social')
        if not connection or not connection.get('enabled'):raise ValueError('Collegare e abilitare un account per questa sede')
        if connection.get('platform')!=platform(job['channel']):raise ValueError('Account di piattaforma diversa')
        if not self.vault.read('connection-'+connection['id']):raise ValueError('Token account mancante')
        if connection.get('expires_at') and connection['expires_at']<=time.time():raise ValueError('Autorizzazione scaduta: ricollega l’account prima di pubblicare')
        media=job.get('media',[]);channel=job['channel']
        if job.get('reel_mode','normal') not in ('normal','trial_manual','trial_auto'):raise ValueError('Modalità Reel non valida')
        if job.get('reel_mode','normal')!='normal' and channel!='Instagram Reel':raise ValueError('La prova è disponibile solo per i Reel Instagram')
        if channel=='Instagram Reel' and (len(media)!=1 or not re.search(r'\.(mp4|mov)(\?|$)',media[0],re.I)):raise ValueError('Per un Reel serve un video MP4 o MOV; una copertina non basta')
        if channel=='TikTok':
            if connection.get('auth_method')!='buffer':raise ValueError('Collega TikTok tramite Buffer')
            if not media:raise ValueError('TikTok richiede immagini o un video')
            videos=[m for m in media if re.search(r'\.(mp4|mov|webm)(\?|$)',m,re.I)]
            if videos and len(media)!=1:raise ValueError('TikTok: scegli un solo video oppure fino a 10 immagini')
            if len(job['body'])>2200:raise ValueError('TikTok: massimo 2200 caratteri')
        if channel.startswith('Instagram'):
            if not media:raise ValueError('Instagram richiede almeno un’immagine o video')
            if len(job['body'])>2200:raise ValueError('Instagram: massimo 2200 caratteri')
            if channel=='Instagram carosello' and not 2<=len(media)<=10:raise ValueError('Carosello: inserire da 2 a 10 immagini')
            if channel not in ('Instagram carosello','Instagram Story') and len(media)!=1:raise ValueError('Per più immagini scegli Instagram carosello')
        if channel=='LinkedIn' and len(job['body'])>3000:raise ValueError('LinkedIn: massimo 3000 caratteri')
        for ref in media:
            if not ref.startswith('asset:'):public_url(ref)
            if channel.startswith('Instagram') or channel.startswith('Facebook') or channel=='TikTok':public_url(self.assets.url(ref,public=True))
        if channel not in ('Instagram Reel','Instagram Story','Instagram carosello','TikTok') and any(re.search(r'\.(mp4|mov|webm)(\?|$)',m,re.I) for m in media):raise ValueError('Questo canale supporta immagini; per un video usa Instagram Reel o esportazione TikTok')
        limit=20 if channel in ('Instagram Story','Facebook Story') else 10
        if len(media)>limit:raise ValueError(f'Massimo {limit} media per pubblicazione')
        if channel=='Facebook Story' and not media:raise ValueError('Le storie richiedono almeno una immagine')
        if any(re.search(r'\.pdf(\?|$)',m,re.I) for m in media):raise ValueError('I PDF richiedono il formato LinkedIn documento con pubblicazione assistita')
    def buffer_payload(self,job,connection,draft=False):
        self.validate(job,connection)
        return {'channelId':connection['external_id'],'text':job['body'],'schedulingType':'automatic','mode':'shareNow','needsApproval':False,'saveToDraft':draft,
            'assets':[{('video' if re.search(r'\.(mp4|mov|webm)(\?|$)',ref,re.I) else 'image'):{'url':self.assets.delivery_url(ref)}} for ref in job.get('media',[])]}
    def graph(self,method,path,token,data=None,final=False,host='facebook'):
        if host not in ('facebook','instagram'):raise ValueError('Host non valido')
        url='https://graph.'+host+'.com/'+self.settings.graph_version+'/'+path
        return self.http.request(method,url,data,{'Authorization':'Bearer '+token},final=final)
    def publish(self,job,connection,checkpoint):
        self.validate(job,connection)
        token=self.vault.read('connection-'+connection['id'])
        pid=connection['external_id'];media=job.get('media',[]);body=job['body']
        remote=job.get('remote',{})
        if connection['platform']=='TikTok':
            api=BufferAPI(self.http)
            if remote.get('buffer_id'):
                result=api.post(token,remote['buffer_id'])
            else:
                if remote.get('buffer_attempted'):raise RemoteError('Invio Buffer già tentato: verifica in Buffer prima di riprogrammare.',uncertain=True)
                api.channel(token,pid)
                payload=self.buffer_payload(job,connection)
                checkpoint({'buffer_attempted':True})
                result=api.create(token,payload)
                checkpoint({'buffer_id':result['id']})
            if result.get('schedulingType')!='automatic':raise RemoteError('Buffer richiede una pubblicazione manuale: verifica il contenuto in Buffer.',uncertain=True)
            if result['status']=='sent':return {'id':result['id'],'url':result.get('externalLink') or ''}
            if result['status'] in ('scheduled','sending'):raise Pending('Buffer sta inviando il contenuto a TikTok; conferma in attesa')
            raise RemoteError('Contenuto presente in Buffer ma non pubblicato: controlla lo stato in Buffer, senza duplicarlo.',uncertain=True)
        if job['channel'] in ('Instagram Story','Facebook Story'):
            published=list(remote.get('story_published',[]));containers=list(remote.get('story_containers',[]))
            index=len(published)
            if index>=len(media):return {'id':','.join(published),'url':''}
            ref=media[index]
            graph=lambda *args,**kwargs:self.graph(*args,**kwargs,host='instagram' if connection.get('auth_method')=='instagram_login' else 'facebook')
            if len(containers)<=index:
                payload={'media_type':'STORIES',('video_url' if is_video(ref) else 'image_url'):self.assets.url(ref,True)} if job['channel']=='Instagram Story' else {'url':self.assets.url(ref,True),'published':False}
                item=graph('POST',pid+('/media' if job['channel']=='Instagram Story' else '/photos'),token,payload)
                containers.append(item['id']);checkpoint({'story_containers':containers})
            container=containers[index]
            if job['channel']=='Instagram Story':
                state=graph('GET',container+'?fields=status_code',token).get('status_code')
                if state in ('ERROR','EXPIRED'):raise ValueError('Storia rifiutata da Instagram; verifica formato e durata')
                if state=='PUBLISHED':raise RemoteError('Storia già pubblicata: verifica sul profilo prima di riprogrammare',uncertain=True)
                if state!='FINISHED':raise Pending(f'Elaborazione storia {index+1} di {len(media)}')
                path=pid+'/media_publish';payload={'creation_id':container}
            else:path=pid+'/photo_stories';payload={'photo_id':container}
            try:result=graph('POST',path,token,payload,final=True)
            except RemoteError as e:
                if e.provider_code==9007 and e.provider_subcode==2207027 and not e.uncertain:raise Pending('Preparazione storia in corso') from None
                raise
            confirmed=result.get('id') or result.get('post_id')
            if not confirmed:raise RemoteError('Conferma storia assente: verifica sul social',uncertain=True)
            published.append(str(confirmed));checkpoint({'story_published':published})
            if len(published)<len(media):raise Pending(f'{len(published)} di {len(media)} storie pubblicate; proseguimento automatico')
            return {'id':','.join(published),'url':''}
        if connection['platform']=='Facebook':
            photo_ids=list(remote.get('photos',[]))
            for ref in media[len(photo_ids):]:
                result=self.graph('POST',pid+'/photos',token,{'url':self.assets.url(ref,public=True),'published':False})
                photo_ids.append(result['id']);checkpoint({'photos':photo_ids})
            payload={'message':body}
            if photo_ids:payload['attached_media']=[{'media_fbid':i} for i in photo_ids]
            result=self.graph('POST',pid+'/feed',token,payload,final=True)
            if not result.get('id'):raise RemoteError('Conferma di pubblicazione Facebook assente',uncertain=True)
            return {'id':result['id'],'url':'https://www.facebook.com/'+result['id']}
        if connection['platform']=='Instagram':
            graph=lambda *args,**kwargs:self.graph(*args,**kwargs,host='instagram' if connection.get('auth_method')=='instagram_login' else 'facebook')
            container=remote.get('container')
            if not container:
                if job['channel']=='Instagram carosello':
                    children=list(remote.get('children',[]))
                    for ref in media[len(children):]:
                        child=graph('POST',pid+'/media',token,{**({'media_type':'VIDEO','video_url':self.assets.url(ref,True)} if is_video(ref) else {'image_url':self.assets.url(ref,True)}),'is_carousel_item':True})
                        children.append(child['id']);checkpoint({'children':children})
                    for child in children:
                        state=graph('GET',child+'?fields=status_code',token)
                        if state.get('status_code') in ('ERROR','EXPIRED'):raise ValueError('Instagram ha rifiutato una slide del carosello; crea una nuova programmazione')
                        if state.get('status_code')!='FINISHED':raise Pending('Instagram sta elaborando le slide del carosello')
                    payload={'media_type':'CAROUSEL','children':','.join(children),'caption':body}
                elif job['channel']=='Instagram Reel':
                    payload={'media_type':'REELS','video_url':self.assets.url(media[0],True),'caption':body}
                    mode=job.get('reel_mode','normal')
                    if mode=='normal':payload['share_to_feed']=True
                    # Meta IG User /media: trial_params.graduation_strategy = MANUAL | SS_PERFORMANCE.
                    else:payload['trial_params']={'graduation_strategy':'SS_PERFORMANCE' if mode=='trial_auto' else 'MANUAL'}
                elif job['channel']=='Instagram Story':payload={'media_type':'STORIES','image_url':self.assets.url(media[0],True)}
                else:payload={'image_url':self.assets.url(media[0],True),'caption':body}
                container=graph('POST',pid+'/media',token,payload)['id'];checkpoint({'container':container})
            state=graph('GET',container+'?fields=status_code',token)
            if state.get('status_code') in ('ERROR','EXPIRED'):raise ValueError('Instagram ha rifiutato o fatto scadere il media; crea una nuova programmazione')
            if state.get('status_code')=='PUBLISHED':raise RemoteError('Instagram segnala il contenitore già pubblicato: verifica sul profilo, senza duplicarlo.',uncertain=True)
            if state.get('status_code')!='FINISHED':raise Pending('Instagram sta elaborando il contenuto')
            try:result=graph('POST',pid+'/media_publish',token,{'creation_id':container},final=True)
            except RemoteError as e:
                # Meta can briefly report FINISHED before the publish endpoint is ready.
                # Retry the same container only for this explicit not-ready response.
                if e.provider_code==9007 and e.provider_subcode==2207027 and not e.uncertain:
                    raise Pending('Instagram sta completando la preparazione: nuovo controllo automatico tra un minuto') from None
                raise
            if not result.get('id'):raise RemoteError('Conferma di pubblicazione Instagram assente',uncertain=True)
            # Do not let an optional permalink lookup turn confirmed publication into an error.
            return {'id':result['id'],'url':''}
        if connection['platform']=='LinkedIn':
            headers={'Authorization':'Bearer '+token,'LinkedIn-Version':self.settings.linkedin_version,'X-Restli-Protocol-Version':'2.0.0'}
            image_ids=list(remote.get('images',[]))
            for ref in media[len(image_ids):]:
                init=self.http.request('POST','https://api.linkedin.com/rest/images?action=initializeUpload',{'initializeUploadRequest':{'owner':pid}},headers)
                value=init['value'];upload=value['uploadUrl'];host=urllib.parse.urlsplit(upload).hostname or ''
                if not (upload.startswith('https://') and (host.endswith('.linkedin.com') or host.endswith('.licdn.com'))):raise ValueError('URL di upload LinkedIn inatteso')
                self.http.request('PUT',upload,self.assets.bytes(ref,self.http),{'Authorization':'Bearer '+token,'Content-Type':'application/octet-stream'},raw=True)
                image_ids.append(value['image']);checkpoint({'images':image_ids})
            for image_id in image_ids:
                result=self.http.request('GET','https://api.linkedin.com/rest/images/'+urllib.parse.quote(image_id,safe=''),headers=headers)
                if result.get('status') in ('PROCESSING_FAILED','WAITING_UPLOAD'):raise ValueError('Caricamento immagine LinkedIn non riuscito')
                if result.get('status')!='AVAILABLE':raise Pending('LinkedIn sta elaborando le immagini')
            payload={'author':pid,'commentary':body,'visibility':'PUBLIC','distribution':{'feedDistribution':'MAIN_FEED','targetEntities':[],'thirdPartyDistributionChannels':[]},'lifecycleState':'PUBLISHED','isReshareDisabledByAuthor':False}
            if len(image_ids)==1:payload['content']={'media':{'id':image_ids[0],'title':job.get('title','')}}
            elif image_ids:payload['content']={'multiImage':{'images':[{'id':i,'altText':job.get('title','')} for i in image_ids]}}
            result=self.http.request('POST','https://api.linkedin.com/rest/posts',payload,headers,final=True)
            remote_id=result.get('_headers',{}).get('x-restli-id')
            if not remote_id:raise RemoteError('Conferma LinkedIn assente: verificare il profilo prima di riprovare',uncertain=True)
            return {'id':remote_id,'url':'https://www.linkedin.com/feed/update/'+remote_id}
        raise ValueError('Piattaforma non supportata')
