import concurrent.futures
import datetime as dt
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock,patch
import urllib.error
import urllib.request
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from settings import Settings
from service import Service,now,timestamp,personalize
from auth import AccessDenied
from app import Server,Handler
from oauth import MetaOAuth
from network import RemoteError,public_url,HTTP
from ai import AI
from publishers import Pending
from feeds import parse
from migrate_v4 import migrate
from PIL import Image

ADMIN={'uid':'owner','role':'admin','name':'Owner','offices':[]}
EDITOR={'uid':'editor','role':'editor','name':'Editor','offices':['1']}
FUTURE=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=2)).isoformat()

def response(content):return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(content)}]}]}

def jpeg():
    b=io.BytesIO();Image.new('RGB',(20,20),'blue').save(b,format='JPEG');return b.getvalue()

class HubCase(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'HUB_AUTH':'local','HUB_STORE':'sqlite','HUB_DATA_DIR':self.tmp.name,'PUBLIC_BASE_URL':'','HUB_MASTER_KEY':'','OPENAI_API_KEY':'','PORT':'0'})
        self.env.start();self.settings=Settings(Path(__file__).resolve().parents[1]);self.http=Mock()
        self.hub=Service(self.settings,http=self.http)
    def tearDown(self):self.env.stop();self.tmp.cleanup()
    def post(self,office='1',media=None):
        r=self.hub.save_post(ADMIN,{'office_id':office,'title':'Mutui','body':'Testo #Credipass','media':media or []})
        return r['id']
    def connection(self,provider='Facebook',office='1'):
        key=provider+'-'+office
        self.hub.vault.save('connection-'+key,'test-token')
        return self.hub.store.put('connections',{'platform':provider,'office_id':office,'external_id':'123' if provider!='LinkedIn' else 'urn:li:organization:123','enabled':True,'name':'Test','state':'test'},key)
    def enable(self,office='1'):
        o=self.hub.get('offices',office);o['publishing_enabled']=True;self.hub.store.put('offices',o,office)
    def due(self,provider='Facebook',media=None):
        self.enable();c=self.connection(provider)
        channel={'Facebook':'Facebook post','Instagram':'Instagram post','LinkedIn':'LinkedIn'}[provider]
        pid=self.post(media=media);r=self.hub.create_job(ADMIN,{'post_id':pid,'office_id':'1','channel':channel,'scheduled':FUTURE})
        key=r['id'];j=self.hub.get('jobs',key);j.update(status='scheduled',scheduled_at=now()-1,account_target=c['external_id']);self.hub.store.put('jobs',j,key)
        return key

class CoreTests(HubCase):
    def test_initial_state(self):
        s=self.hub.public_state(ADMIN);self.assertEqual(len(s['offices']),3);self.assertFalse(s['status']['ai_configured'])
    def test_acl_read_and_write(self):
        self.post('1');self.post('2');state=self.hub.public_state(EDITOR)
        self.assertEqual(len(state['posts']),1);self.assertEqual(len(state['offices']),1)
        with self.assertRaises(AccessDenied):self.hub.save_post(EDITOR,{'office_id':'2','title':'a','body':'b'})
        with self.assertRaises(AccessDenied):self.hub.save_member(EDITOR,{'uid':'evil','offices':['1'],'enabled':True})
    def test_acl_edit_other_office(self):
        pid=self.post('2')
        with self.assertRaises(AccessDenied):self.hub.save_post(EDITOR,{'id':pid,'office_id':'1','title':'a','body':'b'})
    def test_members(self):
        self.hub.save_member(ADMIN,{'uid':'u','name':'Utente','enabled':True,'offices':['1']})
        self.hub.save_member(ADMIN,{'uid':'u','name':'Utente','enabled':False,'offices':['2']})
        self.assertFalse(self.hub.get('members','u')['enabled'])
    def test_bad_post_fields(self):
        for value in ['',None,1,[]]:
            with self.subTest(value=value),self.assertRaises(ValueError):self.hub.save_post(ADMIN,{'office_id':'1','title':value,'body':'b'})
    def test_media_and_office(self):
        for media in [None,{},['file:///tmp/x'],['javascript:alert(1)'],[1]]:
            with self.subTest(media=media),self.assertRaises(ValueError):self.hub.save_post(ADMIN,{'office_id':'1','title':'x','body':'y','media':media})
        with self.assertRaises(ValueError):self.post('999')
    def test_office_validation(self):
        for d in [{'name':'Sede','auto_import':True},{'name':'Sede','publishing_enabled':'false'},{'name':'Sede','hashtag':'two words'}]:
            with self.subTest(d=d),self.assertRaises(ValueError):self.hub.save_office(ADMIN,d)
    def test_personalize(self):
        self.assertEqual(personalize('#Credipass #CredipassRoma',{'hashtag':'#Napoli','signature':'Sede'}),'#Napoli #CredipassRoma\n\nSede')
    def test_dates_timezone(self):
        self.assertEqual(timestamp('2099-01-01T12:00:00+02:00'),timestamp('2099-01-01T10:00:00Z'))
        with self.assertRaises(ValueError):timestamp('2099-01-01T10:00')
    def test_manual_approval_disabled(self):
        pid=self.post();key=self.hub.create_job(ADMIN,{'post_id':pid,'office_id':'1','channel':'Facebook post','scheduled':FUTURE})['id']
        self.assertEqual(self.hub.get('jobs',key)['status'],'draft')
        with self.assertRaises(ValueError):self.hub.job_action(ADMIN,{'id':key,'action':'approve'})
    def test_approval_edit_cancel(self):
        self.enable();self.connection();pid=self.post();key=self.hub.create_job(ADMIN,{'post_id':pid,'office_id':'1','channel':'Facebook post','scheduled':FUTURE})['id']
        self.hub.job_action(ADMIN,{'id':key,'action':'approve'});self.assertEqual(self.hub.get('jobs',key)['status'],'scheduled')
        self.hub.job_action(ADMIN,{'id':key,'action':'edit','body':'Modificato','scheduled':FUTURE});self.assertEqual(self.hub.get('jobs',key)['status'],'draft')
        self.hub.job_action(ADMIN,{'id':key,'action':'cancel'});self.assertEqual(self.hub.get('jobs',key)['status'],'cancelled')
    def test_auto_mode_requires_live_and_account(self):
        o=self.hub.get('offices','1');o['editorial_mode']='automatica';self.hub.store.put('offices',o,'1')
        pid=self.post();payload={'post_id':pid,'office_id':'1','channel':'Facebook post','scheduled':FUTURE}
        key=self.hub.create_job(ADMIN,payload)['id'];self.assertEqual(self.hub.get('jobs',key)['status'],'draft')
        self.enable();self.connection();key=self.hub.create_job(ADMIN,payload)['id'];self.assertEqual(self.hub.get('jobs',key)['status'],'scheduled')
    def test_plans_boundaries_and_idempotency(self):
        for count in [1,7,30,31]:
            slots=[(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=i+1)).isoformat() for i in range(count)]
            d={'office_id':'1','topic':'Mutui','slots':slots,'request_id':'request-'+str(count)}
            result=self.hub.plan(ADMIN,d);self.assertEqual(result['created'],count);self.assertEqual(self.hub.plan(ADMIN,d),result)
        self.assertEqual(len(self.hub.store.list('jobs')),69)
    def test_invalid_plan_atomic(self):
        for slots in [[],[FUTURE,FUTURE],['2000-01-01T00:00:00Z'],[FUTURE,'bad'],[FUTURE]*32]:
            with self.subTest(slots=slots),self.assertRaises(ValueError):self.hub.plan(ADMIN,{'office_id':'1','topic':'x','slots':slots,'request_id':'a'})
        self.assertFalse(self.hub.store.list('posts'))
    def test_no_key_no_fake_ai(self):
        with self.assertRaises(ValueError):self.hub.plan(ADMIN,{'office_id':'1','topic':'x','slots':[FUTURE],'request_id':'a','engine':'ai'})
        self.assertFalse(self.hub.store.list('posts'));self.http.request.assert_not_called()
    def test_vault_not_plaintext(self):
        self.hub.vault.save('openai','SECRET-TEST')
        self.assertEqual(self.hub.vault.read('openai'),'SECRET-TEST')
        self.assertNotIn('SECRET-TEST',json.dumps(self.hub.store.list('secrets')))
        self.assertNotIn('SECRET-TEST',json.dumps(self.hub.public_state(ADMIN)))
        self.assertEqual((self.settings.data/'.master-key').stat().st_mode&0o777,0o600)
    def test_restart(self):
        self.post();self.hub.vault.save('openai','x');other=Service(self.settings,http=self.http)
        self.assertEqual(len(other.store.list('posts')),1);self.assertEqual(other.vault.read('openai'),'x')
    def test_parallel_writes(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(lambda _:self.post(),range(24)))
        self.assertEqual(len(self.hub.store.list('posts')),24)
    def test_images_upload_and_generation(self):
        ref=self.hub.assets.save_image(jpeg());self.assertTrue(ref.startswith('asset:'))
        self.hub.vault.save('openai','x');pid=self.post()
        self.http.request.return_value={'data':[{'b64_json':__import__('base64').b64encode(jpeg()).decode()}]}
        self.hub.generate_image(ADMIN,{'id':pid,'prompt':'Un ufficio'});self.assertEqual(len(self.hub.get('posts',pid)['media']),1)
    def test_image_change_invalidates_job_approval(self):
        key=self.due();pid=self.hub.get('jobs',key)['post_id'];self.hub.vault.save('openai','x')
        self.http.request.return_value={'data':[{'b64_json':__import__('base64').b64encode(jpeg()).decode()}]}
        self.hub.generate_image(ADMIN,{'id':pid,'prompt':'Casa'});self.assertEqual(self.hub.get('jobs',key)['status'],'draft')
    def test_image_quota(self):
        self.hub.quota(ADMIN,'images',1)
        with self.assertRaises(ValueError):self.hub.quota(ADMIN,'images',1)
    def test_import_dedup(self):
        self.http.download.return_value=b'<rss><channel><item><title>T</title><link>https://example.com/1</link><description>B</description></item></channel></rss>'
        d={'office_id':'1','url':'https://example.com/rss'}
        self.assertEqual(self.hub.import_feed(ADMIN,d)['imported'],1);self.assertEqual(self.hub.import_feed(ADMIN,d)['imported'],0)
    def test_atom_media(self):
        data=b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>x</id><title>T</title><summary>B</summary><link href="https://example.com/a"/><link rel="enclosure" href="https://example.com/img.jpg"/></entry></feed>'
        self.assertEqual(parse(data)[0]['media'],['https://example.com/img.jpg'])
    def test_tiktok_blocked(self):
        c=self.connection('TikTok')
        with self.assertRaises(ValueError):self.hub.publishers.validate({'channel':'TikTok','body':'x','media':[]},c)

class PublishingTests(HubCase):
    def test_facebook_success(self):
        key=self.due();self.http.request.return_value={'id':'123_post'}
        self.hub.tick();job=self.hub.get('jobs',key);self.assertEqual(job['status'],'published');self.assertEqual(job['remote_id'],'123_post')
        self.assertTrue(self.http.request.call_args.kwargs['final']);self.hub.tick();self.assertEqual(self.http.request.call_count,1)
    def test_no_publish_while_disabled(self):
        key=self.due();o=self.hub.get('offices','1');o['publishing_enabled']=False;self.hub.store.put('offices',o,'1')
        self.hub.tick();self.http.request.assert_not_called()
    def test_changed_account_never_receives_old_job(self):
        key=self.due();c=self.hub.get('connections','Facebook-1');c['external_id']='456';self.hub.store.put('connections',c,c['id'])
        self.hub.tick();self.assertEqual(self.hub.get('jobs',key)['status'],'error');self.http.request.assert_not_called()
    def test_uncertain_does_not_retry(self):
        key=self.due();self.http.request.side_effect=RemoteError('timeout',uncertain=True)
        self.hub.tick();self.hub.tick();self.assertEqual(self.hub.get('jobs',key)['status'],'uncertain');self.assertEqual(self.http.request.call_count,1)
        with self.assertRaises(ValueError):self.hub.job_action(ADMIN,{'id':key,'action':'approve'})
    def test_rate_limit_retry_and_definitive_error(self):
        key=self.due();self.http.request.side_effect=RemoteError('Rate limit',429)
        self.hub.tick();job=self.hub.get('jobs',key);self.assertEqual(job['status'],'scheduled');self.assertGreater(job['retry_at'],now())
        job['retry_at']=0;self.hub.store.put('jobs',job,key);self.http.request.side_effect=RemoteError('Forbidden',403)
        self.hub.tick();self.assertEqual(self.hub.get('jobs',key)['status'],'error')
    def test_stale_claim_is_uncertain(self):
        key=self.due();j=self.hub.get('jobs',key);j.update(status='processing',claimed_at=now()-1000);self.hub.store.put('jobs',j,key)
        self.hub.tick();self.assertEqual(self.hub.get('jobs',key)['status'],'uncertain');self.http.request.assert_not_called()
    def test_concurrent_claim_one_publication(self):
        key=self.due();self.http.request.return_value={'id':'posted'}
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(lambda _:self.hub.tick(),range(3)))
        self.assertEqual(self.http.request.call_count,1);self.assertEqual(self.hub.get('jobs',key)['status'],'published')
    @patch('publishers.public_url',side_effect=lambda url:url)
    def test_instagram_checkpoint_resume(self,_):
        key=self.due('Instagram',['https://example.com/image.jpg'])
        self.http.request.side_effect=[{'id':'container'},{'status_code':'IN_PROGRESS'}]
        self.hub.tick();j=self.hub.get('jobs',key);self.assertEqual(j['remote']['container'],'container');self.assertEqual(j['status'],'scheduled')
        j['retry_at']=0;self.hub.store.put('jobs',j,key)
        self.http.request.side_effect=[{'status_code':'FINISHED'},{'id':'ig-post'}]
        self.hub.tick();self.assertEqual(self.hub.get('jobs',key)['status'],'published');self.assertEqual(self.http.request.call_count,4)
    @patch('publishers.public_url',side_effect=lambda url:url)
    def test_carousel_payload_and_order(self,_):
        key=self.due('Instagram',['https://example.com/1.jpg','https://example.com/2.jpg']);j=self.hub.get('jobs',key);j['channel']='Instagram carosello';self.hub.store.put('jobs',j,key)
        self.http.request.side_effect=[{'id':'child1'},{'id':'child2'},{'id':'parent'},{'status_code':'FINISHED'},{'id':'post'}]
        self.hub.tick();self.assertEqual(self.hub.get('jobs',key)['status'],'published')
        self.assertEqual(self.http.request.call_args_list[2].args[2]['children'],'child1,child2')
    def test_linkedin_text(self):
        key=self.due('LinkedIn');self.http.request.return_value={'_headers':{'x-restli-id':'urn:li:share:123'}}
        self.hub.tick();self.assertEqual(self.hub.get('jobs',key)['status'],'published')
        request=self.http.request.call_args;self.assertEqual(request.args[1],'https://api.linkedin.com/rest/posts');self.assertIn('LinkedIn-Version',request.args[3])
    def test_missing_confirmation_is_uncertain(self):
        key=self.due();self.http.request.return_value={};self.hub.tick();self.assertEqual(self.hub.get('jobs',key)['status'],'uncertain')

class ExtendedTests(HubCase):
    def test_public_local_configuration_refused(self):
        with patch.dict(os.environ,{'PUBLIC_BASE_URL':'https://example.com'}),self.assertRaises(ValueError):Settings(self.settings.root)
    def test_category_preserved(self):
        from service import category
        self.assertEqual(category('Finanziamento cessione del quinto'),'Cessione del quinto')
        key=self.post();self.assertEqual(self.hub.get('posts',key)['category'],'Mutui')
    def test_feed_worker_failure_is_recorded(self):
        o=self.hub.get('offices','1');o.update(auto_import=True,feed='https://example.com/rss');self.hub.store.put('offices',o,'1')
        self.http.download.side_effect=RemoteError('timeout')
        self.hub.import_tick();self.assertTrue(self.hub.get('offices','1')['import_error'])
        self.hub.import_tick();self.assertEqual(self.http.download.call_count,1)
    def test_worker_recovers_after_backend_failure(self):
        self.hub.tick=Mock(side_effect=RuntimeError('backend down'));self.hub.import_tick=Mock()
        self.hub.stop.wait=Mock(side_effect=lambda _:self.hub.stop.set())
        with patch('builtins.print'):self.hub.worker()
        self.hub.import_tick.assert_called_once();self.hub.stop.wait.assert_called_once_with(15)
    @patch('publishers.public_url',side_effect=lambda url:url)
    def test_facebook_multiple_photos(self,_):
        key=self.due('Facebook',['https://example.com/1.jpg','https://example.com/2.jpg'])
        self.http.request.side_effect=[{'id':'p1'},{'id':'p2'},{'id':'final'}]
        self.hub.tick();self.assertEqual(self.hub.get('jobs',key)['status'],'published')
        self.assertEqual(self.http.request.call_args.args[2]['attached_media'],[{'media_fbid':'p1'},{'media_fbid':'p2'}])
    @patch('publishers.public_url',side_effect=lambda url:url)
    def test_reel_and_story_payloads(self,_):
        for channel,field in [('Instagram Reel','video_url'),('Instagram Story','image_url')]:
            key=self.due('Instagram',['https://example.com/asset.mp4' if channel=='Instagram Reel' else 'https://example.com/asset.jpg']);job=self.hub.get('jobs',key);job['channel']=channel;self.hub.store.put('jobs',job,key)
            self.http.request.reset_mock();self.http.request.side_effect=[{'id':'c'},{'status_code':'FINISHED'},{'id':'published'}]
            self.hub.tick();self.assertEqual(self.hub.get('jobs',key)['status'],'published');self.assertIn(field,self.http.request.call_args_list[0].args[2])
    @patch('publishers.public_url',side_effect=lambda url:url)
    def test_linkedin_image_upload(self,_):
        key=self.due('LinkedIn',['https://example.com/image.jpg']);self.http.download.return_value=jpeg()
        self.http.request.side_effect=[{'value':{'uploadUrl':'https://www.linkedin.com/upload','image':'urn:li:image:abc'}},(b'',{}),{'status':'AVAILABLE'},{'_headers':{'x-restli-id':'urn:li:share:xyz'}}]
        self.hub.tick();self.assertEqual(self.hub.get('jobs',key)['status'],'published')
        self.assertEqual(self.http.request.call_args.args[2]['content']['media']['id'],'urn:li:image:abc')

class AITests(HubCase):
    def setUp(self):super().setUp();self.hub.vault.save('openai','test-key')
    def test_structured_plan(self):
        self.http.request.return_value=response({'posts':[{'title':'Titolo','body':'Corpo','image_prompt':'Casa'}]})
        result=self.hub.ai.plan('Mutui',1,[]);self.assertEqual(result[0]['title'],'Titolo')
        payload=self.http.request.call_args.args[2];self.assertFalse(payload['store']);self.assertTrue(payload['text']['format']['strict'])
    def test_web_citations_retained(self):
        research={'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'Fonte verificata','annotations':[{'type':'url_citation','url':'https://example.com/source','title':'Fonte'}]}]}]}
        self.http.request.side_effect=[research,response({'posts':[{'title':'T','body':'B','image_prompt':'P'}]})]
        self.assertEqual(self.hub.ai.plan('Mutui',1,[],True)[0]['sources'][0]['url'],'https://example.com/source')
    def test_unfounded_research_rejected(self):
        self.http.request.return_value=response({'anything':'no citations'})
        with self.assertRaises(ValueError):self.hub.ai.plan('Tema',1,[],True)
    def test_partial_generation_not_saved(self):
        self.http.request.return_value={'status':'incomplete','output':[]}
        with self.assertRaises(ValueError):self.hub.plan(ADMIN,{'office_id':'1','topic':'Mutui','slots':[FUTURE],'request_id':'x','engine':'ai'})
        self.assertFalse(self.hub.store.list('posts'))
    def test_wrong_count_rejected(self):
        self.http.request.return_value=response({'posts':[]})
        with self.assertRaises(ValueError):self.hub.ai.plan('Tema',1,[])
    def test_image_inputs(self):
        self.http.request.return_value=response({'posts':[{'title':'T','body':'B','image_prompt':'P'}]})
        self.hub.ai.plan('Tema',1,[],images=['data:image/jpeg;base64,AAA'])
        self.assertEqual(self.http.request.call_args.args[2]['input'][0]['content'][1]['type'],'input_image')

class OAuthTests(HubCase):
    def setUp(self):
        super().setUp();self.settings.base_url='https://hub.example.com';self.hub.vault.save('meta_app_id','app');self.hub.vault.save('meta_app_secret','secret');self.oauth=MetaOAuth(self.hub)
    def test_state_single_use(self):
        from urllib.parse import parse_qs,urlsplit
        url=self.oauth.start(ADMIN,{'office_id':'1'})['url'];state=parse_qs(urlsplit(url).query)['state'][0]
        self.http.request.side_effect=[{'access_token':'short'},{'access_token':'long'},{'data':[{'id':'123','name':'Pagina','access_token':'page-secret'}]}]
        self.oauth.callback({'state':[state],'code':['code']})
        with self.assertRaises(ValueError):self.oauth.callback({'state':[state],'code':['code']})
        options=self.oauth.options(ADMIN);self.assertEqual(len(options),1);self.assertNotIn('page-secret',json.dumps(options))
    def test_oauth_wrong_user_and_expiry(self):
        self.hub.store.put('operations',{'type':'oauth','uid':'other','ready':True,'expires':now()+500},'state')
        with self.assertRaises(ValueError):self.oauth.select(ADMIN,{'session':'state','page_id':'123'})
        self.hub.store.put('operations',{'type':'oauth','used':False,'expires':0},'expired')
        with self.assertRaises(ValueError):self.oauth.callback({'state':['expired'],'code':['x']})

class AuthTests(HubCase):
    def test_local_and_missing_token(self):
        self.assertEqual(self.hub.auth.actor({})['role'],'admin');self.settings.auth='firebase'
        with self.assertRaises(AccessDenied):self.hub.auth.actor({})
    @patch('auth.firebase_app')
    @patch('firebase_admin.firestore.client')
    @patch('firebase_admin.auth.verify_id_token')
    def test_revoked_and_office_permissions(self,verify,client,app):
        self.settings.auth='firebase';verify.return_value={'uid':'u','email':'u@example.com'}
        snap=client.return_value.collection.return_value.document.return_value.get.return_value;snap.exists=True;snap.to_dict.return_value={'ruolo':'consulente','attivo':True}
        with self.assertRaises(AccessDenied):self.hub.auth.actor({'Authorization':'Bearer token'})
        self.hub.save_member(ADMIN,{'uid':'u','name':'U','enabled':True,'offices':['2']})
        actor=self.hub.auth.actor({'Authorization':'Bearer token'});self.assertEqual(actor['offices'],['2']);self.assertEqual(actor['role'],'editor')
        self.assertTrue(verify.call_args.kwargs['check_revoked'])
        snap.to_dict.return_value={'ruolo':'admin','attivo':False}
        with self.assertRaises(AccessDenied):self.hub.auth.actor({'Authorization':'Bearer token'})
        verify.side_effect=ValueError('bad token')
        with self.assertRaises(AccessDenied):self.hub.auth.actor({'Authorization':'Bearer token'})

class HTTPTests(HubCase):
    def setUp(self):
        super().setUp();self.server=Server(('127.0.0.1',0),Handler);self.server.hub=self.hub;self.server.oauth=MetaOAuth(self.hub)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.base='http://127.0.0.1:'+str(self.server.server_port)
    def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join();super().tearDown()
    def req(self,path,data=None,headers=None):
        h={'Content-Type':'application/json','X-Hub-Request':'1',**(headers or {})};body=json.dumps(data).encode() if data is not None else None
        try:
            with urllib.request.urlopen(urllib.request.Request(self.base+path,data=body,headers=h),timeout=5) as r:return r.status,r.read()
        except urllib.error.HTTPError as e:
            with e:return e.code,e.read()
    def test_static_and_secrets_not_exposed(self):
        for path in ['/','/app.js','/style.css','/api/bootstrap','/healthz']:self.assertEqual(self.req(path)[0],200)
        for path in ['/.env','/data/.master-key','/settings.py','/data/hub-v5.sqlite3']:self.assertEqual(self.req(path)[0],404)
    def test_origin_and_dns_rebinding(self):
        d={'office_id':'1','title':'T','body':'B'}
        self.assertEqual(self.req('/api/post',d,{'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.req('/api/state',headers={'Host':'evil.example'})[0],403)
        self.assertEqual(self.req('/api/post',d,{'X-Hub-Request':''})[0],403)
    def test_real_http_workflow(self):
        code,body=self.req('/api/post',{'office_id':'1','title':'Titolo','body':'Corpo','media':[]});self.assertEqual(code,200)
        state=json.loads(self.req('/api/state')[1]);self.assertEqual(len(state['posts']),1)
    def test_shared_site_prefix(self):
        self.settings.base_path='/social-hub'
        code,body=self.req('/social-hub/')
        self.assertEqual(code,200)
        self.assertIn(b'/social-hub/app.js',body)
        self.assertNotIn(b'__HUB_BASE__',body)
        self.assertEqual(self.req('/social-hub/api/state')[0],200)
        self.assertEqual(self.req('/api/state')[0],404)
        self.assertEqual(self.req('/social-hub-other/api/state')[0],404)
        self.assertEqual(self.req('/social-hub/api/post',{'office_id':'1','title':'Titolo','body':'Corpo'})[0],200)
    def test_server_ai_reports_presence_only(self):
        with patch.dict(os.environ,{'OPENAI_API_KEY':'fake-server-secret'}):
            code,body=self.req('/api/bootstrap')
            self.assertEqual(code,200)
            self.assertTrue(json.loads(body)['server_ai'])
            self.assertNotIn(b'fake-server-secret',body)
    def test_private_urls(self):
        with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]),self.assertRaises(ValueError):public_url('https://example.com/test')
    def test_no_client_self_grant(self):
        self.hub.auth.actor=Mock(return_value=EDITOR)
        self.assertEqual(self.req('/api/keys',{'openai':'x'})[0],403)
        self.assertEqual(self.req('/api/office',{'name':'x'})[0],403)

class MigrationTests(HubCase):
    def test_v4_migration_preserves_and_is_repeatable(self):
        file=Path(self.tmp.name)/'legacy.db'
        with sqlite3.connect(file) as c:
            c.executescript("CREATE TABLE offices(id,name,hashtag,phone,whatsapp,signature); INSERT INTO offices VALUES(1,'Aversa','#A','','','Firma'); CREATE TABLE posts(id,title,body,media); INSERT INTO posts VALUES(1,'T','B','[]'); CREATE TABLE jobs(id,post_id,office_id,body,channel,scheduled); INSERT INTO jobs VALUES(1,1,1,'B','Facebook post','2099-01-01T12:00');")
        before=file.read_bytes();migrate(self.hub,file);migrate(self.hub,file)
        self.assertEqual(file.read_bytes(),before);self.assertEqual(len(self.hub.store.list('posts')),1);self.assertEqual(len(self.hub.store.list('jobs')),1)
        self.assertEqual(self.hub.store.list('jobs')[0]['status'],'draft')


class ProviderErrorTests(unittest.TestCase):
    def failure(self,url,payload):
        transport=HTTP()
        transport.opener=Mock()
        transport.opener.open.side_effect=urllib.error.HTTPError(url,429,'limited',{},io.BytesIO(payload))
        with self.assertRaises(RemoteError) as ctx:
            transport.request('POST',url,{})
        self.assertEqual(ctx.exception.status,429)
        self.assertNotIn('SECRET',str(ctx.exception))
        return str(ctx.exception)
    def test_openai_quota_vs_temporary_limit(self):
        for code,expected in [('insufficient_quota','credito o quota'),('credit_balance_exhausted','credito o quota'),('project_spend_limit_exceeded','limite di spesa'),('rate_limit_exceeded','troppe richieste')]:
            with self.subTest(code=code):
                message=self.failure('https://api.openai.com/v1/responses',json.dumps({'error':{'code':code,'message':'SECRET'}}).encode())
                self.assertIn(expected,message)
    def test_non_openai_error_is_not_classified_as_openai(self):
        message=self.failure('https://graph.facebook.com/me',b'{"error":{"code":"insufficient_quota","message":"SECRET"}}')
        self.assertNotIn('OpenAI',message)
    def test_malformed_provider_error_stays_sanitized(self):
        for payload in (b'SECRET',b'{"error":null}',b'[]'):
            self.assertIn('limite di utilizzo',self.failure('https://api.openai.com/v1/responses',payload))

if __name__=='__main__':unittest.main(verbosity=2)
