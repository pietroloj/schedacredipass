"""Bounded HTTP transport; no token/body logging and no credential redirects."""
import ipaddress
import json
import socket
import urllib.error
import urllib.parse
import urllib.request

class RemoteError(Exception):
    def __init__(self, message, status=0, uncertain=False, provider_code=None, provider_subcode=None):
        super().__init__(message)
        self.status=status
        self.uncertain=uncertain
        self.provider_code=provider_code
        self.provider_subcode=provider_subcode

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
            code=e.code;provider_code=None;provider_subcode=None
            message=f'Il servizio ha risposto con errore HTTP {code}. Verificare credenziali, permessi e formato.'
            # Never expose provider messages: they can echo tokens or user data.
            try:
                if urllib.parse.urlsplit(url).hostname in ('graph.instagram.com','graph.facebook.com'):
                    error=json.loads(e.read(8192)).get('error',{})
                    provider_code=error.get('code') if type(error.get('code')) is int else None
                    provider_subcode=error.get('error_subcode') if type(error.get('error_subcode')) is int else None
                    numeric=[str(error[k]) for k in ('code','error_subcode') if type(error.get(k)) is int]
                    message='Meta: richiesta rifiutata (HTTP '+str(code)+('; codice '+ '/'.join(numeric) if numeric else '')+'). '
                    message+={190:'Autorizzazione scaduta o non valida: ricollega l’account.',10:'Permesso richiesto non disponibile per questo account.',200:'Permesso di pubblicazione non disponibile.',100:'Controllare formato, contenitore e disponibilità del media.'}.get(error.get('code'),'Controllare il media e i permessi dell’account.')
                if code==429 and urllib.parse.urlsplit(url).hostname=='api.openai.com':
                    message='OpenAI ha raggiunto un limite di utilizzo. Verifica credito e limiti del progetto API.'
                    error=json.loads(e.read(8192)).get('error',{})
                    reason=error.get('code') or error.get('type')
                    if reason in ('insufficient_quota','credit_balance_exhausted','usage_limit_exceeded'):
                        message='OpenAI: credito o quota API esauriti. Verifica fatturazione e limiti del progetto OpenAI prima di riprovare.'
                    elif reason in ('organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded'):
                        message='OpenAI: limite di spesa o utilizzo del progetto raggiunto. Verifica i limiti nella piattaforma OpenAI.'
                    elif reason in ('rate_limit_exceeded','rate_limit_error','slow_down'):
                        message='OpenAI: troppe richieste in questo momento. Attendi qualche minuto e riprova.'
            except (ValueError,AttributeError,TypeError,OSError):
                pass
            finally:e.close()
            raise RemoteError(message,code,final and code>=500,provider_code,provider_subcode) from None
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
