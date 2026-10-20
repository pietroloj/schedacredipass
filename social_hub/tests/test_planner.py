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
        jid=self.hub.create_job(ADMIN,{'post_id':pid,'office_id':'1','channel':'Facebook post','scheduled':FUTURE})['id']
        self.assertEqual(self.hub.get('jobs',jid)['media'],[])
        self.assertTrue(self.hub.get('jobs',jid)['body'].startswith('Testo Facebook'))
        p=self.hub.get('posts',pid);p['slots']['instagram']['media']='';self.hub.save_post(ADMIN,p)
        with self.assertRaisesRegex(ValueError,'slot'):
            self.hub.create_job(ADMIN,{'post_id':pid,'office_id':'1','channel':'Instagram post','scheduled':FUTURE})

class CarouselTests(HubCase):
    def carousel(self):
        refs=['https://example.com/slide_'+str(i)+'.jpg' for i in (1,2,10)]
        pid=self.hub.save_post(ADMIN,{'office_id':'1','title':'Carosello','body':'Comune','slots':{k:{'media':refs[0],'media_items':refs,'body':'Testo '+k} for k in ('instagram','facebook','linkedin','tiktok')}})['id']
        return pid,refs
    def test_snapshots_include_every_slide_and_correct_caption(self):
        pid,refs=self.carousel()
        for requested,actual,key in [('Instagram post','Instagram carosello','instagram'),('Instagram carosello','Instagram carosello','instagram'),('Facebook post','Facebook post','facebook'),('LinkedIn','LinkedIn','linkedin'),('TikTok','TikTok','tiktok')]:
            jid=self.hub.create_job(ADMIN,{'post_id':pid,'office_id':'1','channel':requested,'scheduled':FUTURE})['id']
            job=self.hub.get('jobs',jid)
            self.assertEqual(job['channel'],actual)
            self.assertEqual(job['media'],refs)
            self.assertTrue(job['body'].startswith('Testo '+key))
        post=self.hub.get('posts',pid);post['slots']['instagram']['media_items'].reverse();self.hub.save_post(ADMIN,post)
        self.assertEqual(self.hub.get('jobs',jid)['media'],refs)
        self.assertEqual(self.hub.public_state(ADMIN)['posts'][0]['slots']['instagram']['previews'],list(reversed(refs)))
    def test_post_and_carousel_alias_cannot_create_duplicate_batch_jobs(self):
        pid,refs=self.carousel();connection=self.connection('Instagram')
        rows=[{'post_id':pid,'channel':ch,'connection_id':connection['id'],'scheduled':FUTURE} for ch in ('Instagram post','Instagram carosello')]
        with self.assertRaisesRegex(ValueError,'duplicata'):self.hub.batch_jobs(ADMIN,{'request_id':'aliases','items':rows,'approve':False})
        self.assertEqual(self.hub.store.list('jobs'),[])
    def test_invalid_or_excess_slides_rejected(self):
        pid,refs=self.carousel();post=self.hub.get('posts',pid)
        for media in [refs*4,['javascript:alert(1)']]:
            post['slots']['instagram']['media_items']=media
            with self.assertRaises(ValueError):self.hub.save_post(ADMIN,post)
    def test_cleared_slot_does_not_reuse_legacy_first_slide(self):
        pid,refs=self.carousel();post=self.hub.get('posts',pid)
        post['slots']['instagram']['media_items']=[];self.hub.save_post(ADMIN,post)
        with self.assertRaisesRegex(ValueError,'slot'):self.hub.create_job(ADMIN,{'post_id':pid,'office_id':'1','channel':'Instagram carosello','scheduled':FUTURE})
    def test_zip_import_schedules_whole_carousel_once(self):
        from unittest.mock import patch
        self.enable();connection=self.connection('Instagram')
        refs=['https://example.com/1.jpg','https://example.com/2.jpg']
        data={'id':'zip-carousel','office_id':'1','title':'Casa','body':'Testo','slots':{'instagram':{'media_items':refs}},'auto_approve':True,'schedule':[{'channel':'Instagram post','connection_id':connection['id'],'scheduled':FUTURE}]}
        with patch('publishers.public_url',side_effect=lambda u:u):
            self.assertEqual(self.hub.import_post(ADMIN,data)['scheduled'],1)
            self.assertEqual(self.hub.import_post(ADMIN,data)['scheduled'],1)
        jobs=self.hub.store.list('jobs');self.assertEqual(len(jobs),1)
        self.assertEqual(jobs[0]['media'],refs);self.assertEqual(jobs[0]['channel'],'Instagram carosello')

if __name__=='__main__':unittest.main()
