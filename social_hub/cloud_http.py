"""Firebase HTTP adapter; Firebase identity is verified by the shared domain service."""
from assets import media_type,media_range
import html
import json
import mimetypes
import os
from urllib.parse import urlsplit
from flask import Response
from auth import AccessDenied
from network import RemoteError
from oauth import MetaOAuth
from direct_oauth import DirectOAuth


def dispatch(req,hub):
    origin=req.headers.get("Origin")
    expected=urlsplit(hub.settings.base_url)
    allowed=expected.scheme+"://"+expected.netloc
    if origin and origin!=allowed:return response({"error":"Origine non autorizzata"},403)
    if req.method=="OPTIONS":
        if req.headers.get("Access-Control-Request-Method") not in ("GET","POST"):
            return response({"error":"Metodo non consentito"},405)
        result=response(b"",204,ctype="text/plain")
        result.headers["Access-Control-Allow-Methods"]="GET, POST"
        result.headers["Access-Control-Allow-Headers"]="Authorization, Content-Type, X-Hub-Request"
        result.headers["Access-Control-Allow-Origin"]=allowed
        result.headers["Vary"]="Origin"
        return result
    result=_dispatch(req,hub)
    if origin:
        result.headers["Access-Control-Allow-Origin"]=allowed
        result.headers["Vary"]="Origin"
    return result

def _dispatch(req,hub):
    prefix=hub.settings.base_path
    path=req.path
    if prefix and (path==prefix or path.startswith(prefix+'/')):
        path=path[len(prefix):] or '/'
    elif prefix:
        return response({'error':'Non trovato'},404)
    try:
        # Media probes from social providers use HEAD before fetching the image.
        # Both verbs validate a file-scoped signature; no account cookie is needed.
        if req.method in ('GET','HEAD') and (path.startswith('/media/') or path.startswith('/delivery/')):
            body=hub.assets.delivery_bytes(path[10:],req.args.get('signature')) if path.startswith('/delivery/') else hub.assets.signed_bytes(path[7:],req.args.get('expires'),req.args.get('signature'))
            part,status,headers=media_range(body,req.headers.get('Range') if req.method=='GET' else None)
            result=response(part if req.method=='GET' else b'',status,ctype=media_type(path.rsplit('/',1)[-1]))
            result.headers.update(headers)
            result.headers['X-Content-Type-Options']='nosniff'
            if path.split('?')[0].endswith('.pdf'):result.headers['Content-Disposition']='attachment; filename=contenuto.pdf'
            return result
        if req.method=='GET':
            static={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/logo.png':'logo.png'}
            if path in static:
                file=hub.settings.root/'web'/static[path]
                body=file.read_bytes().replace(b'__HUB_BASE__',prefix.encode()) if file.name=='index.html' else file.read_bytes()
                return response(body,ctype=mimetypes.guess_type(file.name)[0])
            if path=='/api/bootstrap':
                return response({'auth':'firebase','project':hub.settings.project,'firebase_api_key':hub.settings.firebase_key,'server_ai':bool(os.getenv('OPENAI_API_KEY')),'api_base':'https://us-central1-'+hub.settings.project+'.cloudfunctions.net/socialHub'+prefix+'/api/'})
            if path=='/healthz':return response({'ok':True})
            if path in ('/oauth/meta/callback','/oauth/instagram/callback','/oauth/linkedin/callback'):
                try:
                    (MetaOAuth(hub) if path=='/oauth/meta/callback' else DirectOAuth(hub,path.split('/')[2])).callback(req.args.to_dict(flat=False))
                    msg='Account autorizzato. Torna a Collegamenti e conferma l’account da associare.'
                except (ValueError,RemoteError):msg='Collegamento non riuscito o scaduto. Ricomincia dal Social Hub.'
                return response(('<!doctype html><meta charset="utf-8"><p>'+msg+'</p><a href="'+html.escape(hub.settings.base_url)+'/">Torna al Social Hub</a>').encode(),ctype='text/html')
            actor=hub.auth.actor(req.headers)
            if path=='/api/state':return response(hub.public_state(actor))
            if path in ('/api/oauth/instagram/options','/api/oauth/linkedin/options'):return response({'options':DirectOAuth(hub,path.split('/')[3]).options(actor)})
            if path=='/api/oauth/options':return response({'options':MetaOAuth(hub).options(actor)})
            return response({'error':'Non trovato'},404)
        if req.method!='POST':return response({'error':'Metodo non consentito'},405)
        expected=urlsplit(hub.settings.base_url)
        origin=req.headers.get('Origin')
        if origin and origin!=expected.scheme+'://'+expected.netloc:
            raise AccessDenied('Origine non autorizzata')
        if req.headers.get('X-Hub-Request')!='1':raise AccessDenied('Richiesta non autorizzata')
        if req.mimetype!='application/json':raise ValueError('Richiesta JSON richiesta')
        if not req.content_length or req.content_length>28_000_000:raise ValueError('Dimensione richiesta non valida')
        actor=hub.auth.actor(req.headers)
        data=req.get_json(silent=True)
        if not isinstance(data,dict):raise ValueError('Richiesta non valida')
        if path in ('/api/oauth/instagram/start','/api/oauth/linkedin/start'):result=DirectOAuth(hub,path.split('/')[3]).start(actor,data)
        elif path in ('/api/oauth/instagram/select','/api/oauth/linkedin/select'):result=DirectOAuth(hub,path.split('/')[3]).select(actor,data)
        elif path=='/api/oauth/start':result=MetaOAuth(hub).start(actor,data)
        elif path=='/api/oauth/select':result=MetaOAuth(hub).select(actor,data)
        elif path.startswith('/api/'):result=hub.route(actor,path[5:],data)
        else:return response({'error':'Non trovato'},404)
        return response(result)
    except AccessDenied as e:return response({'error':str(e)},403)
    except (ValueError,RemoteError) as e:return response({'error':str(e)},400)
    except Exception:return response({'error':'Servizio temporaneamente non disponibile. Riprova.'},503)


def response(value,status=200,ctype='application/json'):
    body=json.dumps(value,ensure_ascii=False) if ctype=='application/json' else value
    return Response(body,status=status,content_type=ctype+'; charset=utf-8',headers={
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'})
