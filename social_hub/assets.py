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
    def save_upload(self,data,filename=''):
        import re
        extension=Path(filename).suffix.lower().lstrip('.')
        if extension not in ('mp4','mov','pdf'):return self.save_image(data)
        if not data or len(data)>20_000_000:raise ValueError('Video e PDF: massimo 20 MB per file')
        if extension=='pdf':
            if not data.startswith(b'%PDF-'):raise ValueError('PDF non valido')
        elif len(data)<16 or data[4:8]!=b'ftyp':raise ValueError('Video MP4/MOV non valido: esportalo in formato MP4 H.264')
        return self.save_bytes(data,extension)
    def save_bytes(self,data,extension):
        key=uuid.uuid4().hex+'.'+extension
        if self.settings.store=='firestore':
            if not self.settings.bucket:raise ValueError('Configurare Firebase Storage per i media')
            from firebase_admin import storage
            blob=storage.bucket(app=firebase_app(self.settings)).blob('social-hub/media/'+key)
            blob.upload_from_string(data,content_type=media_type(key))
        else:(self.root/key).write_bytes(data)
        return 'asset:'+key
    def save_image(self,data):
        if len(data)>15_000_000:raise ValueError('Immagine troppo grande: massimo 15 MB')
        with Image.open(io.BytesIO(data)) as im:
            if im.width*im.height>30_000_000:raise ValueError('Immagine oltre il limite di risoluzione')
            im.convert('RGB').save(buffer:=io.BytesIO(),format='JPEG',quality=93)
        return self.save_bytes(buffer.getvalue(),'jpg')
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
    def delivery_url(self,ref):
        """Stable, file-scoped delivery capability for delayed Buffer fetches.

        Preview links remain short-lived. This URL reveals only the selected file,
        never the bucket or account; deleting the image revokes its delivery URL.
        """
        if not ref.startswith('asset:'):return ref
        key=ref[6:]
        if not valid_key(key):raise ValueError('Immagine non valida')
        base=getattr(self.settings,'signed_media_url','')
        if self.settings.store!='firestore' or not base:return self.url(ref,public=True)
        signature=hmac.new(self.settings.encryption_key(),('social-hub-delivery-v1:'+key).encode(),hashlib.sha256).hexdigest()
        return base.rsplit('/',1)[0]+'/delivery/'+key+'?signature='+signature
    def delivery_bytes(self,key,signature):
        if not valid_key(key):raise ValueError('Immagine non valida')
        expected=hmac.new(self.settings.encryption_key(),('social-hub-delivery-v1:'+key).encode(),hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected,str(signature)):raise ValueError('Indirizzo immagine non valido')
        from firebase_admin import storage
        return storage.bucket(app=firebase_app(self.settings)).blob('social-hub/media/'+key).download_as_bytes()
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
    return bool(re.fullmatch(r'[a-f0-9]{32}\.(jpg|mp4|mov|pdf)',key))


def media_type(key):
    return {'jpg':'image/jpeg','mp4':'video/mp4','mov':'video/quicktime','pdf':'application/pdf'}.get(key.rsplit('.',1)[-1],'application/octet-stream')


def media_range(body,header=None):
    import re
    size=len(body);headers={'Accept-Ranges':'bytes','Content-Length':str(size)}
    if not header:return body,200,headers
    match=re.fullmatch(r'bytes=(\d*)-(\d*)',header)
    if not match or not any(match.groups()):return b'',416,{**headers,'Content-Length':'0','Content-Range':f'bytes */{size}'}
    first,last=match.groups()
    start=int(first) if first else max(0,size-int(last));end=min(int(last),size-1) if first and last else size-1
    if start>end or start>=size:return b'',416,{**headers,'Content-Length':'0','Content-Range':f'bytes */{size}'}
    part=body[start:end+1]
    return part,206,{**headers,'Content-Length':str(len(part)),'Content-Range':f'bytes {start}-{end}/{size}'}
