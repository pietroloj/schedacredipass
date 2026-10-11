"""Local/cloud HTTP entry point. Secrets are never served as static files."""
import html
import json
import mimetypes
import os
from pathlib import Path
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from socketserver import TCPServer
from auth import AccessDenied
from assets import valid_key
from network import RemoteError
from oauth import MetaOAuth
from direct_oauth import DirectOAuth
from service import Service
from settings import Settings

class Server(ThreadingHTTPServer):
    daemon_threads=True
    def server_bind(self):
        TCPServer.server_bind(self)
        self.server_name='localhost';self.server_port=self.server_address[1]

class Handler(BaseHTTPRequestHandler):
    def log_message(self,fmt,*args):
        # Callback URLs can contain OAuth authorization codes: don't log request URLs.
        pass
    def valid_host(self):
        host=urllib.parse.urlsplit('//'+self.headers.get('Host','')).hostname
        allowed={'127.0.0.1','localhost','::1'}
        if self.server.hub.settings.base_url:allowed.add(urllib.parse.urlsplit(self.server.hub.settings.base_url).hostname)
        if host not in allowed:raise AccessDenied('Host non autorizzato')
    def send(self,value,status=200,ctype='application/json'):
        body=json.dumps(value,ensure_ascii=False).encode() if ctype=='application/json' else value
        self.send_response(status);self.send_header('Content-Type',ctype+'; charset=utf-8')
        self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer')
        self.send_header('X-Frame-Options','DENY')
        self.end_headers()
        try:self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError):pass
    def route_path(self):
        path=urllib.parse.urlsplit(self.path).path
        prefix=getattr(self.server.hub.settings,'base_path','')
        if prefix:
            if path==prefix:return '/'
            if not path.startswith(prefix+'/'):return None
            path=path[len(prefix):]
        return path
    def do_GET(self):
        try:
            self.valid_host();hub=self.server.hub
            url=urllib.parse.urlsplit(self.path);path=self.route_path()
            static={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}
            if path in static:
                file=hub.settings.root/'web'/static[path]
                body=file.read_bytes()
                if file.name=='index.html':
                    prefix=getattr(hub.settings,'base_path','')
                    body=body.replace(b'__HUB_BASE__',prefix.encode())
                return self.send(body,ctype=mimetypes.guess_type(file.name)[0] or 'text/plain')
            if path=='/api/bootstrap':return self.send({'auth':hub.settings.auth,'firebase_api_key':hub.settings.firebase_key,'project':hub.settings.project,'server_ai':bool(os.getenv('OPENAI_API_KEY'))})
            if path=='/healthz':return self.send({'ok':True})
            if path in ('/oauth/meta/callback','/oauth/instagram/callback','/oauth/linkedin/callback'):
                try:
                    (self.server.oauth if path=='/oauth/meta/callback' else DirectOAuth(hub,path.split('/')[2])).callback(urllib.parse.parse_qs(url.query))
                    message='Account autorizzato. Torna a Collegamenti e scegli la pagina da associare alla sede.'
                except Exception as e:
                    message=str(e) if isinstance(e,(ValueError,RemoteError)) else 'Collegamento non riuscito. Verifica la configurazione Meta.'
                return self.send(('<!doctype html><meta charset="utf-8"><p>'+html.escape(message)+'</p><a href="'+html.escape(getattr(hub.settings,'base_path','')+'/')+'">Torna al Social Hub</a>').encode(),ctype='text/html')
            if path and path.startswith('/media/') and valid_key(path[7:]) and hub.settings.store=='sqlite':
                file=hub.assets.root/path[7:]
                if file.is_file():return self.send(file.read_bytes(),ctype='image/jpeg')
            if path=='/api/state':return self.send(hub.public_state(hub.auth.actor(self.headers)))
            if path in ('/api/oauth/instagram/options','/api/oauth/linkedin/options'):return self.send({'options':DirectOAuth(hub,path.split('/')[3]).options(hub.auth.actor(self.headers))})
            if path=='/api/oauth/options':return self.send({'options':self.server.oauth.options(hub.auth.actor(self.headers))})
            return self.send({'error':'Non trovato'},404)
        except AccessDenied as e:self.send({'error':str(e)},403)
        except Exception:self.send({'error':'Servizio non disponibile. Verifica configurazione Firebase e credenziali.'},503)
    def do_POST(self):
        try:
            self.valid_host()
            if self.headers.get('X-Hub-Request')!='1':raise AccessDenied('Richiesta non autorizzata')
            origin=self.headers.get('Origin')
            if origin and urllib.parse.urlsplit(origin).netloc!=self.headers.get('Host'):raise AccessDenied('Origine non autorizzata')
            if self.headers.get('Content-Type','').split(';')[0]!='application/json':raise ValueError('Richiesta JSON richiesta')
            length=int(self.headers.get('Content-Length','0'))
            if length<1 or length>22_000_000:raise ValueError('Dimensione richiesta non valida')
            self.connection.settimeout(300)
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict):raise ValueError('Richiesta non valida')
            actor=self.server.hub.auth.actor(self.headers)
            path=self.route_path()
            if path in ('/api/oauth/instagram/start','/api/oauth/linkedin/start'):result=DirectOAuth(self.server.hub,path.split('/')[3]).start(actor,data)
            elif path in ('/api/oauth/instagram/select','/api/oauth/linkedin/select'):result=DirectOAuth(self.server.hub,path.split('/')[3]).select(actor,data)
            elif path=='/api/oauth/start':result=self.server.oauth.start(actor,data)
            elif path=='/api/oauth/select':result=self.server.oauth.select(actor,data)
            elif path and path.startswith('/api/'):result=self.server.hub.route(actor,path[5:],data)
            else:raise ValueError('Percorso non trovato')
            self.send(result)
        except AccessDenied as e:self.send({'error':str(e)},403)
        except (ValueError,RemoteError) as e:self.send({'error':str(e)},400)
        except Exception:self.send({'error':'Operazione non riuscita. Controlla configurazione, permessi o formato del file.'},500)

def create_server(settings=None):
    settings=settings or Settings()
    hub=Service(settings)
    try:server=Server((settings.host,settings.port),Handler)
    except OSError as e:
        import errno
        if settings.auth!='local' or settings.base_url or e.errno!=errno.EADDRINUSE:raise
        server=Server((settings.host,0),Handler)
    server.hub=hub;server.oauth=MetaOAuth(hub)
    return server

def main():
    server=create_server();hub=server.hub
    url=hub.settings.base_url or f'http://127.0.0.1:{server.server_port}'
    print('Credipass Social Hub V5 — '+url,flush=True)
    print('Per arrestare: Ctrl+C. I dati restano nella cartella data.',flush=True)
    threading.Thread(target=hub.worker,daemon=True).start()
    if os.getenv('CREDIPASS_NO_BROWSER')!='1' and hub.settings.host=='127.0.0.1':
        import webbrowser
        threading.Timer(.5,lambda:webbrowser.open(url)).start()
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:hub.stop.set();server.server_close()

if __name__=='__main__':main()
