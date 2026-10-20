"""Read editorial dates as data, never execute instructions from an archive."""
import re,unicodedata,datetime as dt
from zoneinfo import ZoneInfo
ROME=ZoneInfo('Europe/Rome')
DAYS=['lunedi','martedi','mercoledi','giovedi','venerdi','sabato','domenica']
TIME=r'\b(?:[01]\d|2[0-3]):[0-5]\d\b'
CHANNEL_NAMES={'facebook':'Facebook post','instagram':'Instagram post','linkedin':'LinkedIn','tiktok':'TikTok','story':'Instagram Story','stories':'Instagram Story','storie':'Instagram Story','reel':'Instagram Reel','reels':'Instagram Reel'}
def norm(s):
    s=unicodedata.normalize('NFKD',s.lower().replace('%',' percento '))
    return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in s if not unicodedata.combining(c))).strip()
def local_time(date,time):
    naive=dt.datetime.fromisoformat(date+'T'+time);valid=[]
    for fold in (0,1):
        x=naive.replace(tzinfo=ROME,fold=fold)
        if x.astimezone(dt.timezone.utc).astimezone(ROME).replace(tzinfo=None)==naive and x.utcoffset() not in [v.utcoffset() for v in valid]:valid.append(x)
    if len(valid)!=1:raise ValueError('Orario ambiguo o inesistente per il cambio ora in Italia')
    return valid[0].isoformat()
def channels(line):
    words=norm(line).split();result=list(dict.fromkeys(v for k,v in CHANNEL_NAMES.items() if k in words))
    story=any(w in words for w in ('story','stories','storie'));reel=any(w in words for w in ('reel','reels'))
    if story or reel:
        result=[c for c in result if c not in ('Instagram post','Facebook post')]
        if 'facebook' in words or 'fb' in words:result.append('Facebook Story' if story else 'Facebook Reel')
        if ('facebook' in words or 'fb' in words) and 'instagram' not in words and 'ig' not in words:result=[c for c in result if c not in ('Instagram Story','Instagram Reel')]
    if not story and not reel and 'video' in words:
        if 'Facebook post' in result:result.remove('Facebook post');result.append('Facebook video')
        if 'LinkedIn' in result:result.remove('LinkedIn');result.append('LinkedIn video')
    if any(w in words for w in ('pdf','documento','documenti')) and 'LinkedIn' in result:result.remove('LinkedIn');result.append('LinkedIn documento')
    return list(dict.fromkeys(result))

def extract(title,day,documents,week='',shift_week=False):
    if not isinstance(documents,list) or len(documents)>100:raise ValueError('Troppi file di calendario')
    if shift_week and not week:raise ValueError('Scegli la settimana di pubblicazione')
    start=dt.date.fromisoformat(week) if week else None
    if start:start-=dt.timedelta(days=start.weekday())
    name=norm(title);local=[];matched=[];warnings=[]
    for doc in documents:
        content=doc.get('text','')
        if not isinstance(content,str) or len(content)>200000:raise ValueError('File calendario troppo grande')
        for line in content.splitlines():
            if doc.get('local'):local.append(line)
            plan=bool(re.search(r'(piano|calendario|schedule)|\.csv$',doc.get('name','').lower()))
            if (plan or doc.get('local')) and name and (' '+name+' ') in (' '+norm(line)+' ') and re.search(TIME,line):matched.append(line)
    local_channels=list(dict.fromkeys(c for l in local if re.search(TIME,l) for c in channels(l)))
    candidates=matched or [l for l in local if re.search(TIME,l)]
    rows=[]
    for line in candidates:
        date_match=re.search(r'\b(\d{2})/(\d{2})/(\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b',line)
        weekdays=[i for i,d in enumerate(DAYS) if d in norm(line).split()]
        date=None
        if date_match:
            a=date_match.groups();date=f'{a[2]}-{a[1]}-{a[0]}' if a[0] else '-'.join(a[3:])
            if shift_week:date=(start+dt.timedelta(days=dt.date.fromisoformat(date).weekday())).isoformat()
        else:
            if not weekdays:weekdays=[i for i,d in enumerate(DAYS) if d in norm(day+' '+' '.join(local)).split()]
            if len(weekdays)!=1:
                warnings.append('Giorno non univoco: specificarlo nella riga del piano');continue
            if not start:
                warnings.append('Scegli la settimana per usare giorno e orario dello ZIP');continue
            date=(start+dt.timedelta(days=weekdays[0])).isoformat()
        targets=channels(line) or local_channels
        if not targets:
            warnings.append('Data e ora trovate, ma social di destinazione non specificati: aggiungi Facebook, Instagram, LinkedIn, TikTok o Instagram Story alla riga');continue
        for hour in re.findall(TIME,line):
            try:when=local_time(date,hour)
            except ValueError as e:warnings.append(str(e));continue
            for c in targets:
                row={'channel':c,'scheduled':when}
                if row not in rows:rows.append(row)
    if not candidates:warnings.append('Nessuna data e ora: contenuto preapprovato in libreria, da programmare')
    if len(rows)>30:raise ValueError('Massimo 30 destinazioni/orari per contenuto')
    return rows,list(dict.fromkeys(warnings))
