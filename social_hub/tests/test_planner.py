import unittest
from test_hub import HubCase, ADMIN, EDITOR, FUTURE
from auth import AccessDenied

class PlannerTests(HubCase):
    def variant_post(self):
        return self.hub.save_post(ADMIN,{'office_id':'1','title':'Casa','body':'Testo comune','day_label':'LUNEDI','media':[], 'slots':{'facebook':{'media':'https://example.com/fb.jpg','body':'Testo Facebook','width':1200,'height':628},'instagram':{'media':'https://example.com/ig.jpg','body':'Testo Instagram','width':1080,'height':1350},'reel':{'media':'https://example.com/cover.jpg'}}})['id']
    def test_channel_uses_correct_asset_caption_and_snapshot(self):
        pid=self.variant_post()
        for channel,url,body in [('Facebook post','fb','Facebook'),('Instagram post','ig','Instagram')]:
            jid=self.hub.create_job(ADMIN,{'post_id':pid,'office_id':'1','channel':channel,'scheduled':FUTURE})['id']
            j=self.hub.get('jobs',jid)
            self.assertEqual(j['media'],['https://example.com/'+url+'.jpg'])
            self.assertTrue(j['body'].startswith('Testo '+body))
            self.assertEqual(j['status'],'draft')
        p=self.hub.get('posts',pid);p['slots']['facebook']['body']='Modificato';self.hub.save_post(ADMIN,p)
        self.assertTrue(self.hub.get('jobs',jid)['body'].startswith('Testo Instagram'))
    def test_reel_cover_is_not_a_video(self):
        with self.assertRaisesRegex(ValueError,'copertina'):
            self.hub.create_job(ADMIN,{'post_id':self.variant_post(),'office_id':'1','channel':'Instagram Reel','scheduled':FUTURE})
    def test_slot_previews_and_calendar_previews(self):
        pid=self.variant_post();self.hub.create_job(ADMIN,{'post_id':pid,'office_id':'1','channel':'Facebook post','scheduled':FUTURE})
        s=self.hub.public_state(ADMIN)
        self.assertEqual(s['posts'][0]['slots']['instagram']['preview'],'https://example.com/ig.jpg')
        self.assertEqual(s['jobs'][0]['previews'],['https://example.com/fb.jpg'])
        self.assertEqual(s['posts'][0]['day_label'],'LUNEDI')
    def test_invalid_slot_and_media_rejected(self):
        pid=self.variant_post();p=self.hub.get('posts',pid)
        p['slots']['facebook']['media']='javascript:alert(1)'
        with self.assertRaises(ValueError):self.hub.save_post(ADMIN,p)
        p['slots']={'unknown':{}}
        with self.assertRaises(ValueError):self.hub.save_post(ADMIN,p)
    def test_slot_update_respects_office_access(self):
        pid=self.variant_post();p=self.hub.get('posts',pid);p['office_id']='2'
        with self.assertRaises(AccessDenied):self.hub.save_post(EDITOR,p)
    def test_empty_slot_does_not_reuse_wrong_image(self):
        pid=self.variant_post();p=self.hub.get('posts',pid);p['slots']['facebook']['media']='';self.hub.save_post(ADMIN,p)
        with self.assertRaisesRegex(ValueError,'slot'):
            self.hub.create_job(ADMIN,{'post_id':pid,'office_id':'1','channel':'Facebook post','scheduled':FUTURE})

if __name__=='__main__':unittest.main()
