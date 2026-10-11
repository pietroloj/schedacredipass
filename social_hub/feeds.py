import hashlib
import html
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit
from network import public_url

def parse(data):
    root=ET.fromstring(data)
    if root.tag not in ('rss','{http://www.w3.org/2005/Atom}feed'):raise ValueError('Feed RSS/Atom non riconosciuto')
    atom='{http://www.w3.org/2005/Atom}'
    items=root.findall('.//item') if root.tag=='rss' else root.findall(atom+'entry')
    results=[]
    for item in items[:300]:
        def get(*tags):
            for tag in tags:
                el=item.find(tag)
                if el is not None:
                    text=''.join(el.itertext()).strip()
                    if text:return text
            return ''
        def safe(url):return url if urlsplit(url).scheme=='https' and urlsplit(url).hostname else ''
        title=get('title',atom+'title')
        body=get('{http://purl.org/rss/1.0/modules/content/}encoded','description',atom+'content',atom+'summary')
        body=html.unescape(re.sub('<[^>]*>',' ',body))
        body=re.sub(r'\s+',' ',body).strip()
        url=get('link') or next((x.get('href','') for x in item.findall(atom+'link') if x.get('rel','alternate')=='alternate'),'')
        media=[]
        for el in item.iter():
            if el.tag.endswith(('content','thumbnail','enclosure')) and el.get('url'):media.append(safe(el.get('url')))
            if el.tag==atom+'link' and el.get('rel')=='enclosure':media.append(safe(el.get('href','')))
        identity=get('guid',atom+'id') or url or title+body
        results.append({'source_key':hashlib.sha256(identity.encode()).hexdigest(),'title':title or 'Senza titolo',
            'body':body,'url':safe(url),'media':list(dict.fromkeys(x for x in media if x)),
            'sources':[{'title':title,'url':safe(url)}] if safe(url) else []})
    return results

def fetch(http,url):
    return parse(http.download(url,limit=3_000_000))
