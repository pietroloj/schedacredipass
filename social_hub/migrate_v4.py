"""Explicit, repeatable migration. The original SQLite file is opened read-only."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import sqlite3
from settings import Settings
from service import Service,category

def migrate(hub,source):
    source=Path(source).resolve()
    if not source.is_file():raise ValueError('Database V4 non trovato')
    c=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
    try:
        offices=[dict(r) for r in c.execute('SELECT * FROM offices')]
        posts=[dict(r) for r in c.execute('SELECT * FROM posts')]
        jobs=[dict(r) for r in c.execute('SELECT * FROM jobs')]
    finally:c.close()
    items=[]
    for o in offices:
        key=str(o['id'])
        value={k:o.get(k) or '' for k in ['name','hashtag','phone','whatsapp','signature']}
        value.update(publishing_enabled=False,editorial_mode='approvazione',auto_import=False,feed='')
        # Do not overwrite an office already configured in V5.
        old=hub.store.get('offices',key)
        if not old or old.get('_rev')==1:hub.store.put('offices',value,key)
    office_ids={str(o['id']) for o in offices}
    if not office_ids:raise ValueError('Nessuna sede nel database V4')
    fallback=sorted(office_ids)[0]
    for p in posts:
        targets={str(j['office_id']) for j in jobs if j['post_id']==p['id']} or {fallback}
        for oid in targets:
            if oid not in office_ids:continue
            key='v4-post-'+str(p['id'])+'-'+oid
            if hub.store.get('posts',key):continue
            try:media=json.loads(p.get('media') or '[]')
            except ValueError:media=[]
            media=[m for m in media if isinstance(m,str) and m.startswith('https://')]
            hub.store.put('posts',{'title':p.get('title') or 'Senza titolo','body':p.get('body') or '',
               'office_id':oid,'category':category((p.get('title') or '')+' '+(p.get('body') or '')),'media':media,'sources':[],'engine':'v4','created_at':0},key)
    imported=0
    for j in jobs:
        key='v4-job-'+str(j['id']);oid=str(j['office_id']);postkey='v4-post-'+str(j['post_id'])+'-'+oid
        if hub.store.get('jobs',key) or not hub.store.get('posts',postkey):continue
        try:scheduled=datetime.datetime.fromisoformat(j['scheduled']).timestamp()
        except (ValueError,TypeError):scheduled=0
        hub.store.put('jobs',{'office_id':oid,'post_id':postkey,'title':hub.get('posts',postkey)['title'],
            'body':j.get('body') or '', 'media':hub.get('posts',postkey)['media'],'channel':j.get('channel') or 'Facebook post',
            'scheduled_at':scheduled,'created_at':0,'status':'draft','attempts':0,'last_error':'Importato dalla V4: controllare data, account e contenuto prima di approvare.',
            'remote':{},'connection_id':'','account_target':''},key);imported+=1
    return {'posts':len([p for p in hub.store.list('posts') if p['id'].startswith('v4-post-')]),'new_jobs':imported}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Importa un social.db V4 nel database configurato della V5, senza modificare l’originale.')
    parser.add_argument('source_db');args=parser.parse_args()
    print(migrate(Service(Settings()),args.source_db))
