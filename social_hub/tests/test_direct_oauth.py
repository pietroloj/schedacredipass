import time
from urllib.parse import urlsplit,parse_qs
from unittest.mock import patch
from test_hub import HubCase, ADMIN, EDITOR, FUTURE
from direct_oauth import DirectOAuth
from auth import AccessDenied

class DirectTests(HubCase):
    def flow(self,provider='instagram'):
        self.settings.base_url='https://example.com/social-hub'
        self.hub.vault.save(provider+'_app_id','123')
        self.hub.vault.save(provider+'_app_secret','private-app-secret')
        oauth=DirectOAuth(self.hub,provider)
        query=parse_qs(urlsplit(oauth.start(ADMIN,{'office_id':'1'})['url']).query)
        return oauth,query['state'][0],query
    def test_instagram_flow_and_explicit_identity_confirmation(self):
        oauth,state,query=self.flow()
        self.assertEqual(query['scope'],['instagram_business_basic,instagram_business_content_publish'])
        self.assertEqual(query['enable_fb_login'],['false'])
        self.http.request.side_effect=[{'data':[{'access_token':'short','permissions':query['scope'][0]}]}, {'access_token':'long','expires_in':5000000}, {'user_id':'987','username':'credipass.aversa'}, {'user_id':'987'}]
        oauth.callback({'state':[state],'code':['code']})
        self.assertEqual(self.hub.store.list('connections'),[])
        opts=oauth.options(ADMIN);self.assertEqual(opts[0]['name'],'credipass.aversa')
        self.assertNotIn('long',str(opts))
        with self.assertRaises(ValueError):oauth.select({**ADMIN,'uid':'other'},{'session':state})
        oauth.select(ADMIN,{'session':state})
        c=self.hub.connection('1','Instagram post')
        self.assertEqual(c['auth_method'],'instagram_login')
        self.assertEqual(c['external_id'],'987')
        self.assertEqual(self.hub.vault.read('connection-'+c['id']),'long')
        with self.assertRaises(ValueError):oauth.select(ADMIN,{'session':state})
        with self.assertRaises(ValueError):oauth.callback({'state':[state],'code':['code']})
    def test_state_provider_expiry_permissions(self):
        oauth,state,q=self.flow()
        with self.assertRaises(ValueError):DirectOAuth(self.hub,'linkedin').callback({'state':[state],'code':['x']})
        self.assertFalse(self.hub.get('operations',state)['used'])
        self.hub.store.mutate('operations',state,lambda d:{**d,'expires':0})
        with self.assertRaises(ValueError):oauth.callback({'state':[state],'code':['x']})
        with self.assertRaises(AccessDenied):oauth.start(EDITOR,{'office_id':'1'})
        self.http.request.assert_not_called()
    def test_linkedin_person(self):
        oauth,state,q=self.flow('linkedin')
        self.http.request.side_effect=[{'access_token':'linkedin-token','expires_in':5000},{'sub':'abc','name':'Pietro Lo Iacono'}]
        oauth.callback({'state':[state],'code':['code']});oauth.select(ADMIN,{'session':state})
        c=self.hub.connection('1','LinkedIn');self.assertEqual(c['external_id'],'urn:li:person:abc')
        self.assertEqual(c['platform'],'LinkedIn')
    def test_direct_publish_host_and_expired_token(self):
        c=self.connection('Instagram');c['auth_method']='instagram_login'
        j={'channel':'Instagram post','body':'Test','media':['asset:test.jpg']}
        self.http.request.side_effect=[{'id':'container'},{'status_code':'FINISHED'},{'id':'post'}]
        with patch.object(self.hub.assets,'url',return_value='https://example.com/test.jpg'),patch('publishers.public_url'):
            self.assertEqual(self.hub.publishers.publish(j,c,lambda data:None)['id'],'post')
        self.assertTrue(all(call.args[1].startswith('https://graph.instagram.com/') for call in self.http.request.call_args_list))
        c['expires_at']=time.time()-1
        with self.assertRaisesRegex(ValueError,'scaduta'):self.hub.publishers.validate(j,c)
    def test_assisted_never_publishes_and_manual_confirmation_is_distinct(self):
        pid=self.post(); jid=self.hub.create_job(ADMIN,{'post_id':pid,'office_id':'1','channel':'TikTok','scheduled':FUTURE})['id']
        self.hub.job_action(ADMIN,{'id':jid,'action':'assist'})
        self.hub.store.mutate('jobs',jid,lambda d:{**d,'scheduled_at':time.time()-100})
        self.hub.tick()
        self.assertEqual(self.hub.get('jobs',jid)['status'],'assisted')
        with self.assertRaises(ValueError):self.hub.job_action(ADMIN,{'id':jid,'action':'manual-published','url':'https://evil.example/x'})
        self.hub.job_action(ADMIN,{'id':jid,'action':'manual-published','url':'https://www.tiktok.com/@credipass.aversa/photo/123'})
        self.assertEqual(self.hub.get('jobs',jid)['status'],'manual_published')
        self.http.request.assert_not_called()
    def test_scheduled_cannot_switch_to_manual_without_cancelling(self):
        jid=self.due()
        with self.assertRaises(ValueError):self.hub.job_action(ADMIN,{'id':jid,'action':'assist'})
        self.hub.job_action(ADMIN,{'id':jid,'action':'cancel'});self.hub.job_action(ADMIN,{'id':jid,'action':'assist'})
