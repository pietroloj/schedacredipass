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
    return channel

class Publishers:
    def __init__(self,settings,vault,http,assets):self.settings,self.vault,self.http,self.assets=settings,vault,http,assets
    def validate(self,job,connection):
        if not connection or not connection.get('enabled'):raise ValueError('Collegare e abilitare un account per questa sede')
        if connection.get('platform')!=platform(job['channel']):raise ValueError('Account di piattaforma diversa')
        if not self.vault.read('connection-'+connection['id']):raise ValueError('Token account mancante')
        if connection.get('expires_at') and connection['expires_at']<=time.time():raise ValueError('Autorizzazione scaduta: ricollega l’account prima di pubblicare')
        media=job.get('media',[]);channel=job['channel']
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
            if channel!='Instagram carosello' and len(media)!=1:raise ValueError('Per più immagini scegli Instagram carosello')
        if channel=='LinkedIn' and len(job['body'])>3000:raise ValueError('LinkedIn: massimo 3000 caratteri')
        for ref in media:
            if not ref.startswith('asset:'):public_url(ref)
            if channel.startswith('Instagram') or channel.startswith('Facebook') or channel=='TikTok':public_url(self.assets.url(ref,public=True))
        if channel not in ('Instagram Reel','TikTok') and any(re.search(r'\.(mp4|mov|webm)(\?|$)',m,re.I) for m in media):raise ValueError('Questo canale supporta immagini; per un video usa Instagram Reel o esportazione TikTok')
        if len(media)>10:raise ValueError('Massimo 10 media per pubblicazione')
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
                        child=graph('POST',pid+'/media',token,{'image_url':self.assets.url(ref,True),'is_carousel_item':True})
                        children.append(child['id']);checkpoint({'children':children})
                    payload={'media_type':'CAROUSEL','children':','.join(children),'caption':body}
                elif job['channel']=='Instagram Reel':payload={'media_type':'REELS','video_url':self.assets.url(media[0],True),'caption':body}
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
