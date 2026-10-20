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
    def test_one_content_reaches_other_groups_and_retry_does_not_duplicate(self):
        d=self.rows();other=self.connection(office='2');self.enable('2')
        other['external_id']='456';self.hub.store.put('connections',other,other['id'])
        d['items'].append({**d['items'][0],'connection_id':other['id']})
        self.hub.batch_jobs(ADMIN,d);self.hub.batch_jobs(ADMIN,d)
        jobs=self.hub.store.list('jobs')
        self.assertEqual(len(jobs),2)
        self.assertEqual({j['office_id'] for j in jobs},{'1','2'})
        self.assertEqual(len({j['post_id'] for j in jobs}),1)
        self.assertTrue(all(j['status']=='scheduled' for j in jobs))
    def test_cross_group_targets_require_destination_access(self):
        d=self.rows();other=self.connection(office='2');self.enable('2')
        d['items'][0]['connection_id']=other['id']
        with self.assertRaises(AccessDenied):self.hub.batch_jobs(EDITOR,d)
        self.assertFalse(self.hub.store.list('jobs'))
    def test_duplicate_external_account_across_groups_is_rejected(self):
        d=self.rows();other=self.connection(office='2');self.enable('2')
        d['items'].append({**d['items'][0],'connection_id':other['id']})
        # These test connections intentionally use the same remote ID.
        with self.assertRaisesRegex(ValueError,'duplicata'):self.hub.batch_jobs(ADMIN,d)
    def test_move_keeps_authorization_and_pauses_pending_delivery(self):
        d=self.rows();self.hub.batch_jobs(ADMIN,d);cid=d['items'][0]['connection_id']
        self.hub.move_connection(ADMIN,{'id':cid,'office_id':'2'})
        self.assertEqual(self.hub.get('connections',cid)['office_id'],'2')
        self.assertEqual(self.hub.vault.read('connection-'+cid),'test-token')
        job=self.hub.store.list('jobs')[0]
        self.assertEqual((job['office_id'],job['status'],job['approved_by']),('2','draft',''))
    def test_move_is_admin_only_and_protects_inflight_delivery(self):
        d=self.rows();self.hub.batch_jobs(ADMIN,d);cid=d['items'][0]['connection_id']
        with self.assertRaises(AccessDenied):self.hub.move_connection(EDITOR,{'id':cid,'office_id':'2'})
        job=self.hub.store.list('jobs')[0];job['status']='processing';self.hub.store.put('jobs',job,job['id'])
        with self.assertRaises(ValueError):self.hub.move_connection(ADMIN,{'id':cid,'office_id':'2'})
        self.assertEqual(self.hub.get('connections',cid)['office_id'],'1')
