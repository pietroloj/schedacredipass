from test_hub import HubCase,ADMIN,EDITOR
from auth import AccessDenied
from community import Community
from network import RemoteError
from unittest.mock import patch
import datetime as dt
import time

class CommunityTests(HubCase):
    def setUp(self):
        super().setUp();self.c=self.connection();self.api=Community(self.hub);self.d={'connection_id':self.c['id']}
    def ticket(self):
        self.http.request.return_value={'data':[{'id':'conv1','participants':{'data':[{'id':'visitor','name':'Cliente'}]}}]}
        return self.api.inbox(ADMIN,self.d)['items'][0]['ticket']
    def incoming(self,age=1):
        return {'data':[{'id':'msg1','from':{'id':'visitor','name':'Cliente'},'to':{'data':[{'id':'123'}]},'message':'Ciao','created_time':dt.datetime.fromtimestamp(time.time()-age,dt.timezone.utc).isoformat()}]}
    def test_stats_missing_not_zero(self):
        self.http.request.side_effect=RemoteError('denied',403)
        r=self.api.stats(ADMIN,self.d);self.assertEqual(r['cards'],[]);self.assertTrue(r['warnings'])
    def test_stats_totals(self):
        self.http.request.side_effect=[{'followers_count':12},{'fan_count':0}]
        self.assertEqual([x['value'] for x in self.api.stats(ADMIN,self.d)['cards']],[12,0])
    def test_acl_and_unsupported(self):
        with self.assertRaises(AccessDenied):self.api.inbox(EDITOR,self.d)
        c=self.connection(office='2')
        with self.assertRaises(AccessDenied):self.api.stats(EDITOR,{'connection_id':c['id']})
        c=self.connection('TikTok')
        with self.assertRaises(ValueError):self.api.stats(ADMIN,{'connection_id':c['id']})
    def test_pagination_never_follows_remote_url(self):
        self.http.request.return_value={'data':[],'paging':{'next':'https://evil.test/token','cursors':{'after':'abc'}}}
        r=self.api.inbox(ADMIN,self.d);self.assertEqual(r['after'],'abc');self.assertEqual(self.http.request.call_count,1)
    def test_ticket_bound_to_actor(self):
        ticket=self.ticket()
        with self.assertRaises(ValueError):self.api.messages({**ADMIN,'uid':'other'},{'ticket':ticket})
    def test_ticket_expiry(self):
        ticket=self.ticket();self.hub.store.mutate('operations',ticket,lambda old:{**old,'expires':0})
        with self.assertRaises(ValueError):self.api.messages(ADMIN,{'ticket':ticket})
    def test_no_bodies_persisted(self):
        ticket=self.ticket();self.http.request.return_value=self.incoming()
        self.assertEqual(self.api.messages(ADMIN,{'ticket':ticket})['messages'][0]['text'],'Ciao')
        self.assertNotIn('Ciao',str(self.hub.store.list('operations')))
    def test_reply_deduplication_and_recipient(self):
        ticket=self.ticket();self.http.request.side_effect=[self.incoming(),{'message_id':'sent'},self.incoming()]
        d={'ticket':ticket,'body':'Risposta','request_id':'one'}
        self.assertTrue(self.api.reply(ADMIN,d)['ok'])
        payload=self.http.request.call_args_list[-1].args[2]
        self.assertEqual(payload['recipient'],{'id':'visitor'})
        with self.assertRaises(ValueError):self.api.reply(ADMIN,d)
    def test_old_message_blocks_send(self):
        ticket=self.ticket();self.http.request.return_value=self.incoming(90000)
        with self.assertRaises(ValueError):self.api.reply(ADMIN,{'ticket':ticket,'body':'Hi','request_id':'one'})
        self.assertEqual(self.http.request.call_args.args[0],'GET')
    def test_wrong_recipient_blocks_send(self):
        ticket=self.ticket();r=self.incoming();r['data'][0]['to']['data'][0]['id']='other';self.http.request.return_value=r
        with self.assertRaises(ValueError):self.api.reply(ADMIN,{'ticket':ticket,'body':'Hi','request_id':'one'})
    def test_ambiguous_send_not_retried(self):
        ticket=self.ticket();self.http.request.side_effect=[self.incoming(),RemoteError('timeout',uncertain=True),self.incoming()]
        d={'ticket':ticket,'body':'Hi','request_id':'one'}
        with self.assertRaises(RemoteError):self.api.reply(ADMIN,d)
        with self.assertRaises(ValueError):self.api.reply(ADMIN,d)
    def test_malicious_id(self):
        self.http.request.return_value={'data':[{'id':'../me?fields=access_token'}]}
        with self.assertRaises(ValueError):self.api.inbox(ADMIN,self.d)

    def test_optional_permissions_only_when_requested(self):
        from direct_oauth import DirectOAuth
        from oauth import MetaOAuth
        from urllib.parse import parse_qs,urlsplit
        self.settings.base_url='https://example.com/social-hub'
        for provider in ('instagram','meta'):
            self.hub.vault.save(provider+'_app_id','123');self.hub.vault.save(provider+'_app_secret','secret')
        for oauth,scope in [(DirectOAuth(self.hub,'instagram'),'instagram_business_manage_messages'),(MetaOAuth(self.hub),'pages_messaging')]:
            base=parse_qs(urlsplit(oauth.start(ADMIN,{'office_id':'1'})['url']).query)['scope'][0]
            extended=parse_qs(urlsplit(oauth.start(ADMIN,{'office_id':'1','community':True})['url']).query)['scope'][0]
            self.assertNotIn(scope,base);self.assertIn(scope,extended)

    def test_facebook_community_does_not_request_instagram(self):
        from oauth import MetaOAuth
        from urllib.parse import parse_qs,urlsplit
        self.settings.base_url='https://example.com/social-hub'
        self.hub.vault.save('meta_app_id','123');self.hub.vault.save('meta_app_secret','secret')
        oauth=MetaOAuth(self.hub)
        scope=parse_qs(urlsplit(oauth.start(ADMIN,{'office_id':'1','community':True,'platform':'Facebook'})['url']).query)['scope'][0]
        self.assertNotIn('instagram',scope);self.assertIn('pages_messaging',scope)
        scope=parse_qs(urlsplit(oauth.start(ADMIN,{'office_id':'1','community':True,'platform':'Instagram'})['url']).query)['scope'][0]
        self.assertIn('instagram_manage_messages',scope)

    def test_daily_reach_period_and_missing_days(self):
        c=self.connection('Instagram')
        self.http.request.side_effect=[{'followers_count':10},{'media_count':3},{'data':[{'total_value':{'value':20}}]},{'data':[{'total_value':{'value':30}}]},{'data':[{'values':[{'end_time':'2026-10-10T00:00:00Z','value':0},{'end_time':'2026-10-11T00:00:00Z','value':8}]}]}]
        r=self.api.stats(ADMIN,{'connection_id':c['id'],'days':14})
        self.assertEqual(r['days'],14);self.assertEqual([x['value'] for x in r['series']],[0,8])
        self.assertIn('metric_type=time_series',self.http.request.call_args.args[1])
    def test_invalid_period(self):
        with self.assertRaises(ValueError):self.api.stats(ADMIN,{**self.d,'days':90})
    def test_inbox_refresh_reuses_ticket_without_growth(self):
        first=self.ticket();second=self.ticket();self.assertEqual(first,second)
        self.assertEqual(len(self.hub.store.list('operations')),1)
