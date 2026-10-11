"""On-demand Meta reporting and inbox. No message bodies are persisted or logged."""
import datetime as dt
import hashlib
import re
import time
import uuid
from urllib.parse import urlencode
from auth import admin
from network import RemoteError

SOURCES=[
 {'name':'Credipass Italia · LinkedIn','url':'https://www.linkedin.com/company/credipass-spa'},
 {'name':'Credipass Italia · Instagram','url':'https://www.instagram.com/credipass_italia/'},
 {'name':'Credipass Italia · Facebook','url':'https://www.facebook.com/credipass'},
 {'name':'Credipass Italia · TikTok','url':'https://www.tiktok.com/@credipass_italia'},
]

def ident(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,300}',value):raise ValueError('Identificativo non valido')
    return value

class Community:
    def __init__(self,hub):self.hub=hub
    def account(self,actor,data):
        c=self.hub.get('connections',data.get('connection_id',''))
        self.hub.office(actor,c['office_id'])
        if not c.get('enabled'):raise ValueError('Account disabilitato')
        if c['platform'] not in ('Facebook','Instagram'):raise ValueError('Questo collegamento non espone ancora statistiche e messaggi nel Social Hub. Usa il social originale.')
        if c.get('expires_at') and c['expires_at']<=time.time():raise ValueError('Autorizzazione scaduta: ricollega l’account')
        return c
    def graph(self,c,path,params=None,data=None):
        token=self.hub.vault.read('connection-'+c['id'])
        if not token:raise ValueError('Autorizzazione mancante')
        if params:path+='?'+urlencode(params)
        try:return self.hub.publishers.graph('POST' if data is not None else 'GET',path,token,data,final=data is not None,host='instagram' if c.get('auth_method')=='instagram_login' else 'facebook')
        except RemoteError as e:
            raise RemoteError('Meta non ha consentito l’operazione. Controlla permessi, configurazione dell’app e validità dell’accesso; non significa che non ci siano dati.',e.status,e.uncertain) from None
    def stats(self,actor,data):
        c=self.account(actor,data);pid=ident(c['external_id']);cards=[];warnings=[]
        fields={'Facebook':{'followers_count':'Follower','fan_count':'Mi piace alla pagina'},'Instagram':{'followers_count':'Follower','media_count':'Contenuti'}}[c['platform']]
        for field,label in fields.items():
            try:
                value=self.graph(c,pid,{'fields':field}).get(field)
                cards.append({'label':label,'value':value,'period':'Totale attuale'})
            except RemoteError:warnings.append(label+': dato non disponibile con questo accesso.')
        if c['platform']=='Instagram':
            until=int(time.time());since=until-7*86400
            for metric,label in [('reach','Account raggiunti'),('views','Visualizzazioni')]:
                try:
                    result=self.graph(c,pid+'/insights',{'metric':metric,'period':'day','metric_type':'total_value','since':since,'until':until})
                    entries=result.get('data',[]);value=entries[0].get('total_value',{}).get('value') if entries else None
                    cards.append({'label':label,'value':value,'period':'Ultimi 7 giorni'})
                except RemoteError:warnings.append(label+': richiede accesso alle statistiche o metrica supportata dall’account.')
        else:warnings.append('Copertura e visualizzazioni Facebook non ancora integrate; i contatori mostrati sono totali della pagina.')
        return {'cards':cards,'warnings':warnings,'checked_at':time.time()}
    def inbox(self,actor,data):
        admin(actor);c=self.account(actor,data)
        params={'fields':'id,updated_time,participants','limit':25}
        if c['platform']=='Instagram':params['platform']='instagram'
        cursor=data.get('after','')
        if cursor:
            if not isinstance(cursor,str) or len(cursor)>2000:raise ValueError('Pagina non valida')
            params['after']=cursor
        result=self.graph(c,ident(c['external_id'])+'/conversations',params);items=[]
        for item in result.get('data',[]):
            token=uuid.uuid4().hex
            self.hub.store.put('operations',{'type':'inbox','uid':actor['uid'],'connection_id':c['id'],'conversation_id':ident(item['id']),'expires':time.time()+3600},token)
            participants=item.get('participants',{}).get('data',[])
            name=', '.join(str(p.get('name') or p.get('username') or 'Contatto') for p in participants if str(p.get('id'))!=c['external_id'])
            items.append({'ticket':token,'name':name or 'Conversazione','updated_time':item.get('updated_time','')})
        paging=result.get('paging',{})
        return {'items':items,'after':paging.get('cursors',{}).get('after','') if paging.get('next') else ''}
    def thread(self,actor,data):
        admin(actor);ticket=self.hub.get('operations',ident(data.get('ticket','')))
        if ticket.get('type')!='inbox' or ticket.get('uid')!=actor['uid'] or ticket.get('expires',0)<time.time():raise ValueError('Conversazione scaduta: aggiorna la lista messaggi')
        c=self.account(actor,{'connection_id':ticket['connection_id']})
        result=self.graph(c,ticket['conversation_id']+'/messages',{'fields':'id,created_time,from,to,message','limit':100})
        messages=result.get('data',[])
        return c,messages,bool(result.get('paging',{}).get('next'))
    def messages(self,actor,data):
        c,messages,more=self.thread(actor,data)
        return {'messages':[{'text':m.get('message') or '[Allegato o contenuto da aprire nel social]','from':m.get('from',{}).get('name') or m.get('from',{}).get('username') or 'Contatto','own':str(m.get('from',{}).get('id'))==c['external_id'],'time':m.get('created_time','')} for m in reversed(messages)],'more':more}
    def reply(self,actor,data):
        admin(actor);body=data.get('body','')
        if not isinstance(body,str) or not 1<=len(body.strip())<=1000:raise ValueError('Scrivi una risposta da 1 a 1000 caratteri')
        c,messages,_=self.thread(actor,data)
        incoming=[]
        for m in messages:
            sender=m.get('from',{}).get('id');targets=m.get('to',{}).get('data',[])
            if sender and str(sender)!=c['external_id'] and any(str(t.get('id'))==c['external_id'] for t in targets):
                try:ts=dt.datetime.fromisoformat(m['created_time'].replace('Z','+00:00')).timestamp()
                except (KeyError,ValueError):continue
                incoming.append((ts,str(sender)))
        if not incoming:raise ValueError('Nessun messaggio ricevuto verificabile: rispondi dal social')
        ts,recipient=max(incoming)
        if not 0<=time.time()-ts<86400:raise ValueError('Sono trascorse 24 ore dall’ultimo messaggio ricevuto. Apri il social per verificare le opzioni disponibili.')
        request=ident(data.get('request_id',''));key=hashlib.sha256((actor['uid']+request).encode()).hexdigest();owner=uuid.uuid4().hex
        claim=self.hub.store.mutate('operations',key,lambda old:None if old else {'type':'reply','owner':owner,'created_at':time.time()})
        if claim.get('owner')!=owner:raise ValueError('Invio già tentato: aggiorna la conversazione prima di inviare ancora')
        payload={'recipient':{'id':ident(recipient)},'message':{'text':body.strip()}}
        if c['platform']=='Facebook':payload['messaging_type']='RESPONSE'
        result=self.graph(c,ident(c['external_id'])+'/messages',data=payload)
        if not result.get('message_id'):raise RemoteError('Conferma assente: verifica la conversazione prima di riprovare.',uncertain=True)
        return {'ok':True}
