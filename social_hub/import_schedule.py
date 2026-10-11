"""Conservative schedule extraction: text is data, never executable instructions."""
import re,unicodedata,datetime as dt,json
from zoneinfo import ZoneInfo
ROME=ZoneInfo('Europe/Rome')
DAYS=['lunedi','martedi','mercoledi','giovedi','venerdi','sabato','domenica']
CHANNEL_NAMES={'facebook':'Facebook post','instagram':'Instagram post','linkedin':'LinkedIn','tiktok':'TikTok','story':'Instagram Story','reel':'Instagram Reel'}
def norm(s):
    s=unicodedata.normalize('NFKD',s.lower().replace('%',' percento '))
    return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in s if not unicodedata.combining(c))).strip()
def local_time(date,time):
    naive=dt.datetime.fromisoformat(date+'T'+time)
    valid=[]
    for fold in (0,1):
        x=naive.replace(tzinfo=ROME,fold=fold)
        if x.astimezone(dt.timezone.utc).astimezone(ROME).replace(tzinfo=None)==naive and x.utcoffset() not in [v.utcoffset() for v in valid]:valid.append(x)
    if len(valid)!=1:raise ValueError('Orario ambiguo o inesistente per il cambio ora in Italia')
    return valid[0].isoformat()
def extract(title,day,documents,week=''):
    if len(documents)>100:raise ValueError('Troppi file di calendario')
    matches=[];matched_lines=[];warnings=[];name=norm(title)
    # A dated editorial-plan row must refer to this exact normalized title.
    for doc in documents:
        content=doc.get('text','');path=doc.get('name','')
        if not isinstance(content,str) or len(content)>200000:raise ValueError('File calendario troppo grande')
        for line in content.splitlines():
            if name and name in norm(line):
                date=re.search(r'\b(\d{2})/(\d{2})/(\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b',line)
                time=re.search(r'\b([01]\d|2[0-3]):([0-5]\d)\b',line)
                if date and time:
                    a=date.groups();date=f'{a[2]}-{a[1]}-{a[0]}' if a[0] else '-'.join(a[3:])
                    matches.append((date,time.group()));matched_lines.append(line)
    matches=list(dict.fromkeys(matches))
    instructions='\n'.join(d['text'] for d in documents if d.get('local'))
    if len(matches)>1:return [],['Più date trovate per questo contenuto: specificare un calendario univoco']
    if not matches:
        times=set(re.findall(r'\b(?:[01]\d|2[0-3]):[0-5]\d\b',instructions))
        weekdays=[i for i,d in enumerate(DAYS) if d in norm(day+' '+instructions).split()]
        if len(times)==1 and len(weekdays)==1:
            if not week:return [],['Scegli la settimana per usare giorno e orario dello ZIP']
            start=dt.date.fromisoformat(week);start-=dt.timedelta(days=start.weekday())
            matches=[((start+dt.timedelta(days=weekdays[0])).isoformat(),next(iter(times)))]
        elif times:return [],['Giorno o orario non univoco: nessun invio programmato']
        else:return [],['Nessuna data e ora: contenuto approvato in libreria, da programmare']
    # Only explicit platform mentions on time-bearing local instruction lines.
    lines=[line for line in instructions.splitlines() if re.search(r'\b\d{2}:\d{2}\b',line)]
    channels=[]
    for line in lines:
        for key,value in CHANNEL_NAMES.items():
            if key in norm(line).split() and value not in channels:channels.append(value)
    if not channels:
        for line in matched_lines:
            for key,value in CHANNEL_NAMES.items():
                if key in norm(line).split() and value not in channels:channels.append(value)
    if 'Instagram Story' in channels or 'Instagram Reel' in channels:
        channels=[c for c in channels if c not in ('Instagram post','Facebook post')]
    if not channels:return [],['Data e ora trovate, ma social di destinazione non specificati nel file del contenuto']
    try:when=local_time(*matches[0])
    except ValueError as e:return [],[str(e)]
    return [{'channel':c,'scheduled':when} for c in channels],warnings
