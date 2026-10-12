import datetime as dt,json
from unittest.mock import patch
from test_hub import HubCase,ADMIN,EDITOR,FUTURE
from import_schedule import extract,local_time
from auth import AccessDenied

class ImportTests(HubCase):
    def setUp(self):
        super().setUp();dns=patch('network.socket.getaddrinfo',return_value=[(2,1,6,'',('93.184.216.34',443))]);dns.start();self.addCleanup(dns.stop)
    def data(self):
        return {'id':'zip-post-1','office_id':'1','title':'Prossima apertura','body':'Testo','slots':{'facebook':{'media':'https://example.com/a.jpg'}},'auto_approve':True,'schedule':[{'channel':'Facebook post','scheduled':FUTURE}]}
    def test_automatic_and_idempotent(self):
        self.enable();self.connection();d=self.data()
        self.assertEqual(self.hub.import_post(ADMIN,d)['scheduled'],1)
        self.assertEqual(self.hub.import_post(ADMIN,d)['scheduled'],1)
        self.assertEqual(len(self.hub.store.list('jobs')),1)
        j=self.hub.store.list('jobs')[0];self.assertEqual(j['status'],'scheduled');self.assertEqual(j['approval_source'],'zip')
        self.assertEqual(self.hub.get('posts',d['id'])['editorial_status'],'approved')
    def test_without_dates_approved_not_sent(self):
        d=self.data();d['schedule']=[];self.hub.import_post(ADMIN,d)
        self.assertEqual(self.hub.get('posts',d['id'])['editorial_status'],'approved');self.assertEqual(self.hub.store.list('jobs'),[])
    def test_missing_account_disabled_past_and_cover_reported(self):
        d=self.data();self.assertIn('Account',self.hub.import_post(ADMIN,d)['warnings'][0])
        self.connection();self.assertIn('disabilitati',self.hub.import_post(ADMIN,d)['warnings'][0])
        self.enable();d['schedule'][0]['scheduled']='2000-01-01T10:00:00+01:00';self.assertIn('future',self.hub.import_post(ADMIN,d)['warnings'][0])
        self.assertEqual(self.hub.store.list('jobs'),[])
    def test_preapproved_post_schedules_later_without_approval(self):
        self.enable();self.connection();d=self.data();d['schedule']=[];self.hub.import_post(ADMIN,d)
        r=self.hub.create_job(ADMIN,{'post_id':d['id'],'office_id':'1','channel':'Facebook post','scheduled':FUTURE})
        self.assertEqual(self.hub.get('jobs',r['id'])['status'],'scheduled')
    def test_optout_and_acl(self):
        self.enable();self.connection();d=self.data();d['auto_approve']=False;self.hub.import_post(ADMIN,d)
        self.assertEqual(self.hub.store.list('jobs')[0]['status'],'draft')
        d['office_id']='2'
        with self.assertRaises(AccessDenied):self.hub.import_post(EDITOR,d)
    def test_edit_revokes_preapproval(self):
        d=self.data();d['schedule']=[];self.hub.import_post(ADMIN,d);d['body']='Nuovo testo';self.hub.save_post(ADMIN,d)
        self.assertEqual(self.hub.get('posts',d['id'])['editorial_status'],'draft')
    def test_multiple_accounts_no_overwrite_or_silent_routing(self):
        self.http.request.side_effect=lambda method,url,data=None,headers=None,**kw:{'id':'123' if '/123?' in url else '456'}
        for external in ('123','456','123'):self.hub.save_connection(ADMIN,{'office_id':'1','platform':'Facebook','external_id':external,'token':'test'})
        cs=self.hub.store.list('connections');self.assertEqual(len(cs),2);self.assertIsNone(self.hub.connection('1','Facebook post'))
        self.enable();d=self.data();d['schedule'][0]['connection_id']=cs[1]['id'];self.hub.import_post(ADMIN,d)
        self.assertEqual(self.hub.store.list('jobs')[0]['account_target'],cs[1]['external_id'])
    def test_buffer_saved_key_reuse(self):
        c=self.connection('TikTok');c.update(auth_method='buffer',expires_at=9999999999);self.hub.store.put('connections',c,c['id'])
        token,expiry=self.hub.buffer_token(ADMIN,{'source_connection':c['id']});self.assertEqual(token,'test-token')
        with self.assertRaises(AccessDenied):self.hub.buffer_token(EDITOR,{'source_connection':c['id']})
    def test_week_selection_and_dated_override(self):
        docs=[{'name':'ISTRUZIONI_CONTENUTO.txt','local':True,'text':'Lunedì\nFacebook e Instagram: orario di prova 13:00 (Italia).'}]
        rows,w=extract('Mutuo 100 percento','LUNEDI',docs,'2027-01-06');self.assertEqual(len(rows),2);self.assertTrue(rows[0]['scheduled'].startswith('2027-01-04T13:00'))
        docs.append({'name':'PIANO.txt','text':'Lunedì 12/10/2026 - 13:00 - Mutuo 100%'})
        rows,w=extract('Mutuo 100 percento','LUNEDI',docs,'2027-01-06');self.assertTrue(rows[0]['scheduled'].startswith('2026-10-12T13:00'))
    def test_missing_time_and_ambiguous_dates(self):
        self.assertFalse(extract('Titolo','LUNEDI',[],'2027-01-01')[0])
        docs=[{'name':'PIANO.txt','text':'01/01/2027 13:00 Facebook Titolo\n02/01/2027 13:00 Facebook Titolo'}]
        self.assertEqual(len(extract('Titolo','',docs)[0]),2)
    def test_italy_dst(self):
        self.assertTrue(local_time('2027-06-01','13:00').endswith('+02:00'))
        self.assertTrue(local_time('2027-01-01','13:00').endswith('+01:00'))
        for date in ('2027-03-28','2027-10-31'):
            with self.assertRaises(ValueError):local_time(date,'02:30')

    def test_plan_multiple_daily_slots_and_week_override(self):
        docs=[{'name':'PIANO_EDITORIALE.txt','text':'Lunedì 12/10/2026 - 13:00 e 19:00 - Facebook Instagram - Titolo'}]
        rows,w=extract('Titolo','LUNEDI',docs,'2027-01-06',True)
        self.assertEqual(len(rows),4);self.assertEqual(w,[])
        self.assertEqual({r['scheduled'] for r in rows},{'2027-01-04T13:00:00+01:00','2027-01-04T19:00:00+01:00'})
    def test_relative_plan_without_local_instructions(self):
        rows,w=extract('Titolo','LUNEDI',[{'name':'PIANO_EDITORIALE.txt','text':'Lunedì - 13:00 - Facebook - Titolo\nLunedì - 19:00 - Instagram Story - Titolo'}],'2027-01-04')
        self.assertEqual([r['channel'] for r in rows],['Facebook post','Instagram Story'])
        self.assertEqual(len(rows),2)
    def test_channel_times_are_not_cross_combined(self):
        docs=[{'local':True,'text':'Lunedì\nFacebook 13:00\nInstagram 19:00'}]
        rows,w=extract('Titolo','LUNEDI',docs,'2027-01-04')
        self.assertEqual(len(rows),2);self.assertEqual(rows[0]['channel'],'Facebook post');self.assertIn('13:00',rows[0]['scheduled'])
        self.assertEqual(rows[1]['channel'],'Instagram post');self.assertIn('19:00',rows[1]['scheduled'])

    def test_readme_recommendation_is_not_a_schedule(self):
        docs=[{'name':'LEGGIMI_PRIMA.txt','text':'TikTok: scegli Mutuo rifiutato fra le alternative. Prova le 20:30.'},{'name':'PIANO_EDITORIALE.txt','text':'Lunedì 12/10/2026 - 13:00 - Mutuo rifiutato?'},{'local':True,'text':'Lunedì\nFacebook Instagram: 13:00'}]
        rows,w=extract('Mutuo rifiutato','LUNEDI',docs)
        self.assertEqual(len(rows),2);self.assertNotIn('TikTok',[r['channel'] for r in rows])
