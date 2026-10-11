"""Bounded HTTP transport; no token/body logging and no credential redirects."""
import ipaddress
import json
import socket
import urllib.error
import urllib.parse
import urllib.request

class RemoteError(Exception):
    def __init__(self, message, status=0, uncertain=False):
        super().__init__(message)
        self.status=status
        self.uncertain=uncertain

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def public_url(url):
    if not isinstance(url,str) or len(url)>4000:raise ValueError('URL non valido')
    p=urllib.parse.urlsplit(url)
    if p.scheme!='https' or not p.hostname or p.username or p.password or any(c.isspace() for c in url):
        raise ValueError('Usare un URL HTTPS pubblico senza credenziali')
    if p.port not in (None,443):raise ValueError('Porta HTTPS non supportata')
    for addr in socket.getaddrinfo(p.hostname,443,type=socket.SOCK_STREAM):
        if not ipaddress.ip_address(addr[4][0]).is_global:raise ValueError('Indirizzo privato non consentito')
    return url

class HTTP:
    def __init__(self):self.opener=urllib.request.build_opener(NoRedirect())
    def request(self,method,url,body=None,headers=None,final=False,raw=False,limit=20_000_000):
        headers=dict(headers or {})
        data=body
        if isinstance(body,(dict,list)):
            data=json.dumps(body).encode();headers.setdefault('Content-Type','application/json')
        req=urllib.request.Request(url,data=data,headers=headers,method=method)
        try:
            with self.opener.open(req,timeout=120) as response:
                content=response.read(limit+1)
                if len(content)>limit:raise RemoteError('Risposta troppo grande',uncertain=final)
                meta=dict(response.headers)
                if raw:return content,meta
                result=json.loads(content) if content else {}
                result['_headers']={k.lower():v for k,v in meta.items()}
                return result
        except urllib.error.HTTPError as e:
            code=e.code;e.close()
            raise RemoteError(f'Il servizio ha risposto con errore HTTP {code}. Verificare credenziali, permessi e formato.',code,final and code>=500) from None
        except (urllib.error.URLError,TimeoutError,ConnectionError,OSError) as e:
            raise RemoteError('Servizio non raggiungibile o tempo scaduto.',uncertain=final) from None
        except (ValueError,UnicodeError):
            raise RemoteError('Risposta del servizio non valida.',uncertain=final) from None
    def download(self,url,limit=8_000_000):
        # Pin a checked public address to prevent DNS rebinding during downloads.
        import http.client
        import ssl
        public_url(url)
        parsed=urllib.parse.urlsplit(url)
        addresses=socket.getaddrinfo(parsed.hostname,443,type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):raise ValueError('Host non pubblico')
        conn=http.client.HTTPSConnection(parsed.hostname,443,timeout=30)
        try:
            sock=socket.create_connection((addresses[0][4][0],443),timeout=30)
            try:conn.sock=ssl.create_default_context().wrap_socket(sock,server_hostname=parsed.hostname)
            except Exception:sock.close();raise
            conn.request('GET',urllib.parse.urlunsplit(('', '',parsed.path or '/',parsed.query,'')),headers={'User-Agent':'CredipassSocialHub/5'})
            response=conn.getresponse()
            if response.status!=200:raise RemoteError('Download non riuscito; usare un URL diretto senza redirect',response.status)
            data=response.read(limit+1)
            if len(data)>limit:raise ValueError('File oltre il limite di dimensione')
            return data
        except (OSError,TimeoutError,http.client.HTTPException):raise RemoteError('Download non riuscito') from None
        finally:conn.close()
