import json
import unittest
from unittest.mock import Mock,patch
from flask import Flask,request
from test_hub import HubCase,ADMIN
from cloud_http import dispatch

class CloudTests(HubCase):
    def setUp(self):
        super().setUp()
        self.settings.base_path='/social-hub'
        self.settings.base_url='https://consulenza-credipass.it/social-hub'
        self.hub.auth.actor=Mock(return_value=ADMIN)
        self.app=Flask(__name__)
    def req(self,path,method='GET',data=None,headers=None):
        headers={'X-Hub-Request':'1',**(headers or {})}
        with self.app.test_request_context(path,method=method,json=data,headers=headers):
            return dispatch(request,self.hub)
    def test_static_and_prefix(self):
        r=self.req('/social-hub/')
        self.assertEqual(r.status_code,200)
        self.assertIn(b'/social-hub/app.js',r.data)
        self.assertEqual(self.req('/api/state').status_code,404)
        self.assertEqual(self.req('/social-hub/.env').status_code,404)
    def test_authenticated_workflow(self):
        r=self.req('/social-hub/api/post','POST',{'office_id':'1','title':'Titolo','body':'Testo'})
        self.assertEqual(r.status_code,200)
        self.assertEqual(len(self.req('/social-hub/api/state').json['posts']),1)
    def test_origin_restricted(self):
        for origin in ['https://evil.example','https://consulenza-credipass.it.evil.example']:
            self.assertEqual(self.req('/social-hub/api/post','POST',{}, {'Origin':origin}).status_code,403)
    def test_proxy_origin_does_not_depend_on_host(self):
        r=self.req('/social-hub/api/post','POST',{'office_id':'1','title':'Titolo','body':'Testo'}, {'Origin':'https://consulenza-credipass.it','Host':'us-central1-consulenza-credipass.cloudfunctions.net'})
        self.assertEqual(r.status_code,200)
    def test_missing_header_and_malformed_payload(self):
        self.assertEqual(self.req('/social-hub/api/post','POST',{}, {'X-Hub-Request':''}).status_code,403)
        self.assertEqual(self.req('/social-hub/api/post','POST',[]).status_code,400)
    def test_auth_required(self):
        from auth import AccessDenied
        self.hub.auth.actor.side_effect=AccessDenied('Accedi')
        self.assertEqual(self.req('/social-hub/api/state').status_code,403)
        self.assertEqual(self.req('/social-hub/api/post','POST',{}).status_code,403)
    def test_sdk_exports_without_connecting_database(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('cloud_entry',self.settings.root/'main.py')
        module=importlib.util.module_from_spec(spec)
        with patch.dict('os.environ',{},clear=False):spec.loader.exec_module(module)
        self.assertTrue(hasattr(module.socialHub,'__firebase_endpoint__'))
        self.assertTrue(hasattr(module.socialHubSchedule,'__firebase_endpoint__'))
    def test_cors_preflight_and_private_responses(self):
        r=self.req('/social-hub/api/state','OPTIONS',headers={'Origin':'https://consulenza-credipass.it','Access-Control-Request-Method':'GET'})
        self.assertEqual(r.status_code,204)
        self.assertEqual(r.headers['Access-Control-Allow-Origin'],'https://consulenza-credipass.it')
        self.assertEqual(self.req('/social-hub/api/state','OPTIONS',headers={'Origin':'https://evil.example','Access-Control-Request-Method':'GET'}).status_code,403)
        self.assertEqual(self.req('/social-hub/api/state',headers={'Origin':'https://consulenza-credipass.it'}).headers['Cache-Control'],'no-store')
    def test_signed_media_rejects_forgery_and_expiry(self):
        import time
        from urllib.parse import urlsplit,parse_qs
        from unittest.mock import patch
        self.settings.store='firestore'
        self.settings.signed_media_url='https://cloud.example/media'
        self.settings.encryption_key=lambda:b'fake-stable-test-signing-key'
        key='a'*32+'.jpg'
        url=self.hub.assets.url('asset:'+key)
        args=parse_qs(urlsplit(url).query)
        with patch('assets.firebase_app'),patch('firebase_admin.storage.bucket') as bucket:
            bucket.return_value.blob.return_value.download_as_bytes.return_value=b'jpeg'
            self.assertEqual(self.hub.assets.signed_bytes(key,args['expires'][0],args['signature'][0]),b'jpeg')
            with self.assertRaises(ValueError):self.hub.assets.signed_bytes(key,args['expires'][0],'forged')
            expired=int(time.time())-1
            with self.assertRaises(ValueError):self.hub.assets.signed_bytes(key,expired,self.hub.assets.signature(key,expired))
            with self.assertRaises(ValueError):self.hub.assets.signed_bytes('../private',args['expires'][0],args['signature'][0])
            bucket.return_value.blob.assert_called_once_with('social-hub/media/'+key)
