from test_hub import HubCase,ADMIN,EDITOR,FUTURE
from auth import AccessDenied

class WorkspaceTests(HubCase):
    def rows(self):
        pid=self.post();c=self.connection();self.enable()
        return {'request_id':'test-batch','approve':True,'items':[{'post_id':pid,'channel':'Facebook post','connection_id':c['id'],'scheduled':FUTURE}]}
    def test_batch_approved_and_idempotent(self):
        d=self.rows();self.hub.batch_jobs(ADMIN,d);self.hub.batch_jobs(ADMIN,d)
        jobs=self.hub.store.list('jobs');self.assertEqual(len(jobs),1);self.assertEqual(jobs[0]['status'],'scheduled')
    def test_invalid_destination_rolls_back_all(self):
        d=self.rows();d['items'].append({**d['items'][0],'channel':'Instagram post','connection_id':'missing'})
        with self.assertRaises(ValueError):self.hub.batch_jobs(ADMIN,d)
        self.assertEqual(self.hub.store.list('jobs'),[])
    def test_trash_restore_and_office_acl(self):
        pid=self.post();self.hub.post_action(ADMIN,{'id':pid,'action':'trash'})
        state=self.hub.public_state(ADMIN);self.assertFalse(state['posts']);self.assertEqual(len(state['trash']),1)
        self.hub.post_action(ADMIN,{'id':pid,'action':'restore'});self.assertEqual(len(self.hub.public_state(ADMIN)['posts']),1)
        pid2=self.post('2')
        with self.assertRaises(AccessDenied):self.hub.post_action(EDITOR,{'id':pid2,'action':'trash'})
    def test_trashed_cannot_batch_schedule(self):
        d=self.rows();self.hub.post_action(ADMIN,{'id':d['items'][0]['post_id'],'action':'trash'})
        with self.assertRaises(ValueError):self.hub.batch_jobs(ADMIN,d)
    def test_draft_without_approval(self):
        d=self.rows();d['approve']=False;self.hub.batch_jobs(ADMIN,d)
        self.assertEqual(self.hub.store.list('jobs')[0]['status'],'draft')
    def test_duplicate_rejected(self):
        d=self.rows();d['items']*=2
        with self.assertRaises(ValueError):self.hub.batch_jobs(ADMIN,d)
    def test_batch_request_cannot_change_targets(self):
        d=self.rows();self.hub.batch_jobs(ADMIN,d)
        d['items'][0]['scheduled']='2099-01-01T12:00:00Z'
        with self.assertRaises(ValueError):self.hub.batch_jobs(ADMIN,d)
        self.assertEqual(len(self.hub.store.list('jobs')),1)
    def test_batch_office_acl(self):
        d=self.rows();d['items'][0]['post_id']=self.post('2')
        with self.assertRaises(AccessDenied):self.hub.batch_jobs(EDITOR,d)
