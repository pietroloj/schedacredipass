import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from test_hub import HubCase,ADMIN,EDITOR,FUTURE
from buffer_api import BufferAPI
from network import RemoteError
from publishers import Pending
from unittest.mock import patch
from auth import AccessDenied

CHANNEL={'id':'channel1','name':'credipass.aversa','service':'tiktok','isDisconnected':False,'isLocked':False,'isQueuePaused':False}
class BufferTests(HubCase):
    def setUp(self):
        super().setUp()
        dns=patch('network.socket.getaddrinfo',return_value=[(2,1,6,'',('93.184.216.34',443))]);dns.start();self.addCleanup(dns.stop)
    def test_draft_test_cannot_publish_or_repeat(self):
        j,c=self.setup_job()
        self.http.request.return_value={'data':{'createPost':{'post':{'id':'draft1','status':'draft','schedulingType':'automatic'}}}}
        result=self.hub.route(ADMIN,'buffer/test',{'post_id':j['post_id']})
        self.assertEqual(result['status'],'draft')
        payload=self.http.request.call_args.args[2]['variables']['input']
        self.assertIs(payload['saveToDraft'],True)
        self.assertIn('BOZZA NON DA PUBBLICARE',payload['text'])
        with self.assertRaises(ValueError):self.hub.route(ADMIN,'buffer/test',{'post_id':j['post_id']})
        with self.assertRaises(AccessDenied):self.hub.route(EDITOR,'buffer/test',{'post_id':j['post_id']})
        self.assertEqual(self.http.request.call_count,1)

    def setup_job(self):
        self.enable();c=self.connection('TikTok');c.update(auth_method='buffer',external_id='channel1');self.hub.store.put('connections',c,c['id'])
        p=self.post(media=['https://example.com/photo.jpg'])
        j=self.hub.make_job(self.hub.get('posts',p),self.hub.get('offices','1'),'TikTok',9999999999,'automatica')
        return self.hub.store.put('jobs',j),c
    def test_channels_readonly_and_tiktok_filter(self):
        self.http.request.side_effect=[{'data':{'account':{'organizations':[{'id':'o'}]}}},{'data':{'channels':[CHANNEL,{**CHANNEL,'service':'instagram'}]}}]
        self.assertEqual(BufferAPI(self.http).channels('secret'),[CHANNEL])
    def test_wrong_or_inactive_channel(self):
        for changes in ({'service':'instagram'},{'isDisconnected':True},{'isLocked':True},{'isQueuePaused':True}):
            self.http.request.return_value={'data':{'channel':{**CHANNEL,**changes}}}
            with self.assertRaises(ValueError):BufferAPI(self.http).channel('secret','channel1')
    def test_save_verifies_identity_and_hides_secret(self):
        self.http.request.return_value={'data':{'channel':CHANNEL}}
        self.hub.save_connection(ADMIN,{'office_id':'1','platform':'TikTok','external_id':'channel1','auth_method':'buffer','token':'buffer-secret','name':'fake','expires_at':9999999999})
        state=self.hub.public_state(ADMIN)
        self.assertEqual(state['connections'][0]['name'],'credipass.aversa');self.assertNotIn('buffer-secret',str(state))
        with self.assertRaises(AccessDenied):self.hub.route(EDITOR,'buffer/channels',{'office_id':'1','token':'secret'})
    def test_accepted_is_pending_then_sent_without_duplicate(self):
        j,c=self.setup_job();checkpoints=[]
        self.http.request.side_effect=[{'data':{'channel':CHANNEL}},{'data':{'createPost':{'post':{'id':'p','status':'sending','schedulingType':'automatic'}}}}]
        with self.assertRaises(Pending):self.hub.publishers.publish(j,c,checkpoints.append)
        self.assertEqual(checkpoints,[{'buffer_attempted':True},{'buffer_id':'p'}])
        payload=self.http.request.call_args_list[1].args[2]['variables']['input']
        self.assertEqual(payload['mode'],'shareNow');self.assertEqual(payload['schedulingType'],'automatic')
        j['remote']={'buffer_attempted':True,'buffer_id':'p'}
        self.http.request.side_effect=None;self.http.request.return_value={'data':{'post':{'id':'p','status':'sent','schedulingType':'automatic','externalLink':'https://www.tiktok.com/@credipass.aversa/video/1'}}}
        result=self.hub.publishers.publish(j,c,checkpoints.append)
        self.assertEqual(result['id'],'p');self.assertIn('post(input:',self.http.request.call_args.args[2]['query'])
    def test_ambiguous_create_is_never_retried(self):
        j,c=self.setup_job();j['remote']={'buffer_attempted':True}
        with self.assertRaises(RemoteError) as e:self.hub.publishers.publish(j,c,lambda c:None)
        self.assertTrue(e.exception.uncertain);self.http.request.assert_not_called()
    def test_handed_off_job_cannot_be_edited_cancelled_or_reapproved(self):
        j,c=self.setup_job();j['remote']={'buffer_attempted':True,'buffer_id':'p'};self.hub.store.put('jobs',j,j['id'])
        for action in ('edit','cancel','approve','assist'):
            with self.assertRaises(ValueError):self.hub.job_action(ADMIN,{'id':j['id'],'action':action,'body':'changed','scheduled':FUTURE})
    def test_notification_and_error_never_mark_published(self):
        j,c=self.setup_job();j['remote']={'buffer_attempted':True,'buffer_id':'p'}
        for status,kind in [('sent','notification'),('error','automatic'),('draft','automatic')]:
            self.http.request.return_value={'data':{'post':{'id':'p','status':status,'schedulingType':kind}}}
            with self.assertRaises(RemoteError):self.hub.publishers.publish(j,c,lambda c:None)
    def test_graphql_errors_do_not_leak_details(self):
        self.http.request.return_value={'errors':[{'message':'secret token'}]}
        with self.assertRaises(RemoteError) as e:BufferAPI(self.http).query('secret','query{}',final=True)
        self.assertNotIn('secret',str(e.exception));self.assertTrue(e.exception.uncertain)
    def test_media_validation(self):
        j,c=self.setup_job();self.hub.publishers.validate(j,c)
        j['media']=['https://example.com/video.mp4','https://example.com/image.jpg']
        with self.assertRaises(ValueError):self.hub.publishers.validate(j,c)
        j['media']=[]
        with self.assertRaises(ValueError):self.hub.publishers.validate(j,c)
