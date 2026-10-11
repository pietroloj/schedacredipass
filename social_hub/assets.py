import datetime
import time
import hashlib
import hmac
import io
import uuid
from pathlib import Path
from PIL import Image
from storage import firebase_app

class Assets:
    def __init__(self,settings):
        self.settings=settings
        self.root=settings.data/'media';self.root.mkdir(exist_ok=True)
    def save_image(self,data):
        if len(data)>15_000_000:raise ValueError('Immagine troppo grande: massimo 15 MB')
        with Image.open(io.BytesIO(data)) as im:
            if im.width*im.height>30_000_000:raise ValueError('Immagine oltre il limite di risoluzione')
            im.convert('RGB').save(buffer:=io.BytesIO(),format='JPEG',quality=93)
        key=uuid.uuid4().hex+'.jpg';data=buffer.getvalue()
        if self.settings.store=='firestore':
            if not self.settings.bucket:raise ValueError('Configurare Firebase Storage per le immagini')
            from firebase_admin import storage
            blob=storage.bucket(app=firebase_app(self.settings)).blob('social-hub/media/'+key)
            blob.upload_from_string(data,content_type='image/jpeg')
        else:(self.root/key).write_bytes(data)
        return 'asset:'+key
    def url(self,ref,public=False):
        if not ref.startswith('asset:'):return ref
        key=ref[6:]
        if not valid_key(key):raise ValueError('Immagine non valida')
        if self.settings.store=='firestore' and getattr(self.settings,'signed_media_url',''):
            expires=int(time.time())+3600
            signature=self.signature(key,expires)
            return f'{self.settings.signed_media_url}/{key}?expires={expires}&signature={signature}'
        if self.settings.store=='firestore':
            from firebase_admin import storage
            blob=storage.bucket(app=firebase_app(self.settings)).blob('social-hub/media/'+key)
            try:return blob.generate_signed_url(version='v4',expiration=datetime.timedelta(hours=1),method='GET')
            except AttributeError:
                # Workload identity has no local private key; use IAM signBlob.
                from google.auth.transport.requests import Request
                credential=firebase_app(self.settings).credential.get_credential()
                credential.refresh(Request())
                email=getattr(credential,'service_account_email',None)
                if not email:raise ValueError('Configurare un service account capace di firmare gli URL Storage')
                return blob.generate_signed_url(version='v4',expiration=datetime.timedelta(hours=1),method='GET',service_account_email=email,access_token=credential.token)
        if public and not self.settings.base_url.startswith('https://'):
            raise ValueError('Per pubblicare immagini locali serve un indirizzo HTTPS pubblico o Firebase Storage')
        return (self.settings.base_url if public else getattr(self.settings,'base_path',''))+'/media/'+key
    def signature(self,key,expires):
        message=f'social-hub-media-v1:{key}:{expires}'.encode()
        return hmac.new(self.settings.encryption_key(),message,hashlib.sha256).hexdigest()
    def signed_bytes(self,key,expires,signature):
        if not valid_key(key):raise ValueError('Immagine non valida')
        try:expires=int(expires)
        except (ValueError,TypeError):raise ValueError('Indirizzo immagine non valido') from None
        if not 0<expires-time.time()<=3600 or not hmac.compare_digest(self.signature(key,expires),str(signature)):
            raise ValueError('Indirizzo immagine scaduto o non valido')
        from firebase_admin import storage
        blob=storage.bucket(app=firebase_app(self.settings)).blob('social-hub/media/'+key)
        return blob.download_as_bytes()
    def bytes(self,ref,http):
        if ref.startswith('asset:') and self.settings.store=='sqlite':
            key=ref[6:]
            if not valid_key(key):raise ValueError('Immagine non valida')
            return (self.root/key).read_bytes()
        return http.download(self.url(ref,public=True))

def valid_key(key):
    import re
    return bool(re.fullmatch(r'[a-f0-9]{32}\.jpg',key))
