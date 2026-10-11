"""Run ONLY with Auth + Firestore emulators and project demo-credipass-social."""
import os
if not (os.getenv('FIRESTORE_EMULATOR_HOST')=='127.0.0.1:18080' and os.getenv('FIREBASE_AUTH_EMULATOR_HOST')=='127.0.0.1:19099'):
    raise SystemExit('Avvia gli emulatori locali e imposta gli host esatti; nessun test sul progetto reale.')
import concurrent.futures
import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.request
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import firebase_admin
from firebase_admin import auth,credentials,firestore
from google.auth.credentials import AnonymousCredentials
from cryptography.fernet import Fernet
from settings import Settings
from service import Service,now
from auth import AccessDenied
from network import RemoteError

class EmulatorCredentials(credentials.Base):
    def get_credential(self):return AnonymousCredentials()

class FirebaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for url in ['http://127.0.0.1:18080/emulator/v1/projects/demo-credipass-social/databases/(default)/documents','http://127.0.0.1:19099/emulator/v1/projects/demo-credipass-social/accounts']:
            with urllib.request.urlopen(urllib.request.Request(url,method='DELETE')) as r:r.read()
        cls.tmp=tempfile.TemporaryDirectory()
        cls.env=patch.dict(os.environ,{'HUB_AUTH':'firebase','HUB_STORE':'firestore','FIREBASE_PROJECT_ID':'demo-credipass-social','FIREBASE_WEB_API_KEY':'demo-key','HUB_MASTER_KEY':Fernet.generate_key().decode(),'HUB_DATA_DIR':cls.tmp.name,'OPENAI_API_KEY':''})
        cls.env.start()
        cls.app=firebase_admin.initialize_app(EmulatorCredentials(),{'projectId':'demo-credipass-social'},name='social-hub')
        cls.db=firestore.client(app=cls.app)
        cls.owner=auth.create_user(email='owner@local.test',password='EmulatorOnly123!',app=cls.app)
        cls.editor=auth.create_user(email='editor@local.test',password='EmulatorOnly123!',app=cls.app)
        cls.db.collection('consulenti').document(cls.owner.uid).set({'ruolo':'admin','attivo':True})
        cls.db.collection('consulenti').document(cls.editor.uid).set({'ruolo':'consulente','attivo':True})
        cls.db.collection('pratiche_mutuo').document('sentinel').set({'untouched':True})
        def login(email):
            body=json.dumps({'email':email,'password':'EmulatorOnly123!','returnSecureToken':True}).encode()
            req=urllib.request.Request('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',data=body,headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(req) as r:return json.loads(r.read())['idToken']
        cls.owner_headers={'Authorization':'Bearer '+login('owner@local.test')}
        cls.editor_headers={'Authorization':'Bearer '+login('editor@local.test')}
        cls.settings=Settings(Path(__file__).resolve().parents[1]);cls.hub=Service(cls.settings,http=Mock())
        cls.actor=cls.hub.auth.actor(cls.owner_headers)
    @classmethod
    def tearDownClass(cls):
        firebase_admin.delete_app(cls.app);cls.env.stop();cls.tmp.cleanup()
    def test_01_real_token_and_roles(self):
        self.assertEqual(self.actor['role'],'admin')
        with self.assertRaises(AccessDenied):self.hub.auth.actor(self.editor_headers)
        self.hub.save_member(self.actor,{'uid':self.editor.uid,'name':'Editor','offices':['1'],'enabled':True})
        self.assertEqual(self.hub.auth.actor(self.editor_headers)['offices'],['1'])
    def test_02_shared_database_and_isolation(self):
        for office in ['1','2']:self.hub.save_post(self.actor,{'office_id':office,'title':'Post '+office,'body':'Test','media':[]})
        other=Service(self.settings,http=Mock())
        self.assertEqual(len(other.public_state(self.actor)['posts']),2)
        editor=other.auth.actor(self.editor_headers);self.assertEqual(len(other.public_state(editor)['posts']),1)
        self.assertEqual(self.db.collection('pratiche_mutuo').document('sentinel').get().to_dict(),{'untouched':True})
    def test_03_batch_plan_atomic_and_idempotent(self):
        slots=[(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=i+1)).isoformat() for i in range(7)]
        data={'office_id':'1','topic':'Test','slots':slots,'request_id':'firebase-plan'}
        first=self.hub.plan(self.actor,data);self.assertEqual(first['created'],7)
        self.assertEqual(self.hub.plan(self.actor,data),first)
    def test_04_atomic_counter_concurrent(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _:self.hub.store.mutate('operations','counter',lambda old:{'count':(old or {}).get('count',0)+1}),range(12)))
        self.assertEqual(self.hub.store.get('operations','counter')['count'],12)
    def test_05_single_claim_across_instances(self):
        o=self.hub.get('offices','1');o['publishing_enabled']=True;self.hub.store.put('offices',o,'1')
        self.hub.vault.save('connection-fb','fake-test-token')
        self.hub.store.put('connections',{'office_id':'1','platform':'Facebook','external_id':'123','enabled':True},'fb')
        job={'office_id':'1','post_id':'test','title':'T','body':'B','media':[],'channel':'Facebook post','connection_id':'fb','account_target':'123','status':'scheduled','scheduled_at':now()-1,'attempts':0}
        self.hub.store.put('jobs',job,'due')
        provider=Mock(return_value={'id':'remote-test-id','url':''})
        other=Service(self.settings,http=Mock());self.hub.publishers.publish=provider;other.publishers.publish=provider
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(lambda hub:hub.tick(),[self.hub,other]))
        self.assertEqual(provider.call_count,1);self.assertEqual(self.hub.get('jobs','due')['status'],'published')
    def test_06_encrypted_secrets_shared(self):
        self.hub.vault.save('test','secret-value');other=Service(self.settings,http=Mock())
        self.assertEqual(other.vault.read('test'),'secret-value')
        raw=self.db.collection('social_hub').document('main').collection('secrets').document('test').get().to_dict()
        self.assertNotIn('secret-value',json.dumps(raw))
    def test_07_disable_permission(self):
        self.hub.save_member(self.actor,{'uid':self.editor.uid,'name':'Editor','offices':['1'],'enabled':False})
        with self.assertRaises(AccessDenied):self.hub.auth.actor(self.editor_headers)
    def test_08_firebase_disabled_user(self):
        auth.update_user(self.owner.uid,disabled=True,app=self.app)
        with self.assertRaises(AccessDenied):self.hub.auth.actor(self.owner_headers)

    def test_09_browser_cannot_read_secrets(self):
        req=urllib.request.Request('http://127.0.0.1:18080/v1/projects/demo-credipass-social/databases/(default)/documents/social_hub/main/secrets/test',headers=self.editor_headers)
        with self.assertRaises(__import__('urllib.error',fromlist=['HTTPError']).HTTPError) as ctx:urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code,403);ctx.exception.close()

if __name__=='__main__':unittest.main(verbosity=2)
