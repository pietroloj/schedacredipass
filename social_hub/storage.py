"""Equivalent local/Firestore document operations with atomic publication claims."""
import copy
import json
import sqlite3
import uuid
import threading
import time
import random
from contextlib import contextmanager

COLLECTIONS = {'offices', 'posts', 'jobs', 'plans', 'members', 'connections', 'settings', 'secrets', 'operations'}

def identity(collection, key):
    if collection not in COLLECTIONS or not isinstance(key, str) or not key or '/' in key or len(key)>200:
        raise ValueError('Riferimento non valido')

def revision(old, value, key):
    value = copy.deepcopy(value)
    value['id'] = key
    value['_rev'] = (old or {}).get('_rev', 0) + 1
    return value

class SQLiteStore:
    def __init__(self, path):
        self.path = str(path)
        with self.connect() as c:
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('CREATE TABLE IF NOT EXISTS documents(collection TEXT,id TEXT,payload TEXT,PRIMARY KEY(collection,id))')
    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.path, timeout=20)
        try:
            with c: yield c
        finally:
            c.close()
    def get(self, collection, key):
        identity(collection, key)
        with self.connect() as c:
            row = c.execute('SELECT payload FROM documents WHERE collection=? AND id=?', (collection, key)).fetchone()
        return json.loads(row[0]) if row else None
    def list(self, collection):
        identity(collection, 'list')
        with self.connect() as c:
            return [json.loads(r[0]) for r in c.execute('SELECT payload FROM documents WHERE collection=? ORDER BY id', (collection,))]
    def mutate(self, collection, key, fn):
        identity(collection, key)
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute('SELECT payload FROM documents WHERE collection=? AND id=?',(collection,key)).fetchone()
            old=json.loads(row[0]) if row else None
            value=fn(copy.deepcopy(old))
            if value is None: return old
            value=revision(old,value,key)
            c.execute('INSERT OR REPLACE INTO documents VALUES(?,?,?)',(collection,key,json.dumps(value,ensure_ascii=False)))
            return value
    def put(self, collection, value, key=None):
        key=key or uuid.uuid4().hex
        return self.mutate(collection,key,lambda old:value)
    def batch_create(self, items):
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            for collection,key,value in items:
                identity(collection,key)
                c.execute('INSERT INTO documents VALUES(?,?,?)',(collection,key,json.dumps(revision(None,value,key),ensure_ascii=False)))

class FirestoreStore:
    _locks=tuple(threading.RLock() for _ in range(64))
    def __init__(self, db):
        self.db=db
        self.root=db.collection('social_hub').document('main')
    def ref(self, collection, key):
        identity(collection,key)
        return self.root.collection(collection).document(key)
    def get(self, collection, key):
        snap=self.ref(collection,key).get()
        return snap.to_dict() if snap.exists else None
    def list(self, collection):
        identity(collection,'list')
        return [s.to_dict() for s in self.root.collection(collection).stream()]
    def mutate(self, collection, key, fn):
        from google.cloud import firestore
        ref=self.ref(collection,key)
        @firestore.transactional
        def run(tx):
            snap=ref.get(transaction=tx)
            old=snap.to_dict() if snap.exists else None
            value=fn(copy.deepcopy(old))
            if value is None:return old
            value=revision(old,value,key)
            tx.set(ref,value)
            return value
        # Reduce intra-process contention; Firestore still provides cross-instance
        # correctness. Back off if the SDK exhausts its conflict retries.
        from google.api_core.exceptions import Aborted
        with self._locks[hash(ref.path)%len(self._locks)]:
            for attempt in range(3):
                try:return run(self.db.transaction(max_attempts=8))
                except ValueError as exc:
                    if not isinstance(exc.__cause__,Aborted) or attempt==2:raise
                    time.sleep(0.25*(2**attempt)+random.random()*0.2)
    def put(self, collection, value, key=None):
        return self.mutate(collection,key or uuid.uuid4().hex,lambda old:value)
    def batch_create(self, items):
        batch=self.db.batch()
        for collection,key,value in items:batch.create(self.ref(collection,key),revision(None,value,key))
        batch.commit()

def firebase_app(settings):
    import firebase_admin
    try:return firebase_admin.get_app('social-hub')
    except ValueError:
        return firebase_admin.initialize_app(options={'projectId':settings.project,'storageBucket':settings.bucket},name='social-hub')

def make_store(settings):
    if settings.store == 'firestore':
        from firebase_admin import firestore
        return FirestoreStore(firestore.client(app=firebase_app(settings)))
    return SQLiteStore(settings.data/'hub-v5.sqlite3')
