# Social Hub integrato nella Scheda Consulenza

Modulo editoriale per Aversa, Santa Maria Capua Vetere e Caserta. Il menu comune
rimanda a `https://consulenza-credipass.it/social-hub/`.

## Architettura

- Netlify inoltra `/social-hub/*` alla funzione `socialHub`.
- La sessione Firebase sul medesimo dominio viene ripristinata dal modulo.
- Le API verificano il token e i permessi delle sedi sul server.
- I consulenti si selezionano dall'elenco già presente nel gestionale.
- I documenti editoriali usano `social_hub/main`, separati dalle pratiche.
- OpenAI riutilizza il segreto esistente `OPENAI_API_KEY` di Firebase.
- `SOCIAL_HUB_MASTER_KEY` protegge i token social e firma gli URL temporanei immagini.
- `socialHubSchedule` controlla la coda ogni minuto senza computer locale acceso.
- Le chiamate API vanno direttamente alla funzione con CORS ristretto al dominio
  del gestionale, evitando i limiti temporali del proxy per le generazioni AI.

Le funzioni hanno il codebase `social-hub` e una configurazione dedicata:
`firebase deploy --config firebase.social-hub.json --only functions:social-hub --project consulenza-credipass`.
La configurazione delle funzioni preesistenti non viene sostituita.

## Collegamenti social

Per Aversa sono stati indicati Instagram `credipass.aversa` e Facebook
`61595395165258`. I link visibili nell'interfaccia sono riferimenti, non token
né autorizzazioni. Serve completare la configurazione dell'app Meta e il consenso
sulla pagina ufficiale, quindi selezionare la pagina in Collegamenti.
Le sedi partono con pubblicazione disabilitata. Nessun test pubblica post reali.
Ogni piattaforma richiede il proprio collegamento autorizzato prima degli invii.

## Verifica

`python -m unittest discover -s social_hub/tests -p test_hub.py`

`python -m unittest discover -s social_hub/tests -p test_cloud_http.py`

`node social_hub/tests/test_shared_auth.cjs`

Il workflow GitHub `Social Hub tests` esegue questi controlli con Python 3.13.
I test provider usano risposte simulate; non sostituiscono il collaudo dell'account
Meta reale. I test Firestore/Auth aggiuntivi richiedono gli emulatori del progetto
fittizio `demo-credipass-social` e rifiutano gli endpoint di produzione.

Gli esiti incerti di pubblicazione vengono fermati per evitare duplicazioni:
si controlla il social prima di programmare un nuovo invio.


## Libreria visiva e calendario

La navigazione distingue Panoramica, Libreria, Crea contenuto, Assistente AI e Calendario.
Ogni contenuto può conservare sei slot: Facebook 1200×628, Instagram 1080×1350,
LinkedIn 1200×1200, Storie, copertina Reel e copertina TikTok 1080×1920. Sono
formati suggeriti per il pacchetto editoriale, non tutti i formati accettati dai social.
Ogni slot ha immagine e testo propri. Le dimensioni diverse sono segnalate senza ritaglio.

L’importazione ZIP riconosce `giorno/contenuto/social/immagine` e i file
`TESTO_DA_COPIARE.txt`. L’opzione di approvazione automatica è attiva all’apertura
ed è visibile prima del pulsante finale di importazione. I post diventano preapprovati;
le righe riconosciute con data, ora, account valido e sede abilitata entrano in programma.
Senza orari il contenuto resta preapprovato in libreria. Modificare testo o media revoca
la preapprovazione. I problemi sono mostrati nell’esito; nessun invio reale viene
eseguito dai test.

Legge piani TXT/CSV e istruzioni locali, per esempio:
`Lunedì 12/10/2026 - 13:00 - La casa dei tuoi sogni` nel PIANO_EDITORIALE.txt,
e `Facebook e Instagram: orario di prova 13:00 (Italia).` nel file
ISTRUZIONI_CONTENUTO.txt della relativa cartella. Sono supportate date GG/MM/AAAA
o AAAA-MM-GG e orari HH:MM. Senza data viene usata la settimana scelta all’importazione
(il lunedì della settimana che contiene il giorno selezionato). Fuso Europe/Rome;
orari ambigui o inesistenti al cambio ora vengono bloccati. Testi non riconosciuti,
scelte alternative e conflitti vengono segnalati senza inventare date o destinazioni.

Limiti: 150 MB compressi, 250 MB estratti, 600 file, 15 MB per file; nessuna
estrazione nel filesystem. Cartelle: Facebook, Instagram, LinkedIn, Stories_FB_IG,
Reel_FB_IG e TikTok. Una copertina non viene inviata come Reel.
Il digest dello ZIP, la sede e la cartella identificano stabilmente il contenuto;
post/account/canale/data identificano l’invio. Ripetere lo stesso import non duplica
né riattiva invii già annullati. Se il contenuto è stato modificato in libreria,
l’importazione viene fermata per non approvare accidentalmente una versione diversa.

Il calendario mensile/settimanale filtra per social e stato. Un clic sul giorno
apre la programmazione; un clic sul post apre modifica e approvazione. Le immagini
e i testi vengono copiati dallo slot del social nel job, conservando lo snapshot.
I contenuti da approvare non sono invii attivi. Le copertine Reel non sono video:
il server impedisce di inviarle come Reel. Lo slot Storie programma Instagram Story;
la grafica è riutilizzabile manualmente su Facebook. TikTok supporta post fotografici tramite Buffer.

Test aggiuntivi: `python -m unittest discover -s social_hub/tests -p test_planner.py`
e `node social_hub/tests/test_planner_import.cjs`. Quest’ultimo accetta opzionalmente
il percorso al pacchetto Aversa per verificarne 10 contenuti e 60 grafiche.


## Accessi diretti e pubblicazione assistita

Instagram Login è separato dal percorso Facebook Login, che rimane disponibile.
Configurare nell’app Instagram il callback pubblico `/social-hub/oauth/instagram/callback`,
poi salvare **Instagram App ID e Instagram App Secret** (distinti dalle credenziali Meta generali)
da Collegamenti. L’accesso richiede un account professionale e i permessi
`instagram_business_basic,instagram_business_content_publish`; per uso in sviluppo
occorre aggiungere l’account ai ruoli di test secondo la procedura Meta.
Non abilita né aggira account soggetti a restrizioni di sicurezza.

LinkedIn personale richiede un’app con Share on LinkedIn e Sign In with LinkedIn using OpenID Connect,
callback `/social-hub/oauth/linkedin/callback`, scope `openid profile w_member_social`.
L’app va associata a una Pagina secondo i requisiti LinkedIn; il destinatario dei post
può essere il profilo personale. Entrambi i flussi mostrano l’identità autorizzata e richiedono
una conferma esplicita prima di associarla alla sede. I token sono cifrati; la scadenza è visibile
in Collegamenti. Al momento il rinnovo avviene riautorizzando l’account, non in background.

Dal dettaglio del calendario, «Prepara pubblicazione assistita» rende un contenuto un
promemoria escluso dal worker: copia testo, apri/salva media, apri il social, pubblica lì.
Dopo l’invio l’operatore può inserire il permalink: lo stato «Pubblicato manualmente (dichiarato)»
è distinto dalla conferma API. Non vengono inviate notifiche automatiche per questi promemoria.
Per un invio già programmato bisogna prima annullare la programmazione.
TikTok può usare questo percorso assistito oppure Buffer per gli invii automatici.
Una copertina non costituisce un video Reel; su TikTok può essere un post fotografico.

Test OAuth con risposte simulate: stato monouso, scadenza, isolamento del provider e dell’utente,
identità LinkedIn, host Instagram diretto, token scaduti, esclusione dei promemoria dal worker.
I test non sostituiscono il collaudo con un account autorizzato e una pubblicazione reale approvata.

## TikTok tramite Buffer

Collegare TikTok a Buffer, verificare l’email e generare una chiave API personale.
In Collegamenti → TikTok inserire la chiave, cercare i canali e confermare quello
della sede. La chiave viene cifrata; identità, piattaforma e stato vengono verificati
prima di salvare. Il piano gratuito Buffer prevede tre canali, dieci post in coda
per canale e un limite API: verificare le condizioni correnti su buffer.com/pricing.

Gli orari restano nel Social Hub: il worker invia a Buffer all’orario approvato
con modalità automatica. Solo `sent` viene registrato come pubblicato;
`scheduled` e `sending` vengono controllati nuovamente. Prima della richiesta
viene salvato un marcatore persistente: se l’esito è ambiguo non si crea un secondo
post. Dopo la presa in carico, modifica, annullamento e passaggio al percorso
manuale dal Hub sono bloccati: verificare il post in Buffer. Il controllo termina
dopo 40 tentativi; un problema prolungato richiede verifica in Buffer.

Supportati fino a dieci immagini oppure un video HTTPS MP4/MOV/WebM, senza
mescolare immagini e video. Gli upload locali restano immagini; i video si
forniscono tramite URL. Musica/effetti aggiunti nell’app richiedono il percorso
assistito. Nessun test automatico pubblica su un account reale.

## Più account e riuso delle autorizzazioni

Una sede può avere più account della stessa piattaforma. Ricollegare la stessa identità
aggiorna la connessione mantenendone l’ID; aggiungere un’altra identità non sovrascrive
la precedente. La programmazione richiede la scelta dell’account quando ce n’è più di uno.
L’app Meta/LinkedIn rimane unica. Dopo una autorizzazione Facebook si possono associare
le altre pagine restituite nella medesima sessione, valida dieci minuti, senza rifare
l’app. Servono comunque ruoli e permessi ufficiali per ogni account.
Per TikTok, la selezione “Riusa Buffer già collegato” usa la chiave cifrata solo sul
server per cercare altri canali dello stesso account Buffer; non la restituisce al
browser. Restano validi i limiti del piano Buffer.

Gli invii TikTok normali usano `needsApproval:false`, `saveToDraft:false` e
`schedulingType:automatic`. Il calendario resta nel Social Hub; la trasmissione a
Buffer avviene all’orario programmato. Solo il pulsante di collaudo usa una bozza.


## Statistiche, messaggi e fonti nazionali
Le nuove sezioni leggono Meta su richiesta. Facebook: follower e Mi piace alla
pagina; Instagram: follower, numero contenuti, copertura e visualizzazioni degli
ultimi 7 giorni quando disponibili. Dati mancanti non vengono presentati come zero.
Messaggi è riservata agli amministratori, 25 conversazioni per pagina, fino a 100
messaggi recenti per conversazione; allegati richiedono apertura nel social.
Le risposte testuali (massimo 1000 caratteri) sono limitate alla finestra di 24 ore
verificata sui messaggi ricevuti e non vengono ritentate in caso di esito incerto.
I testi delle conversazioni non vengono salvati nel database del gestionale.
Ticket temporanei di accesso sono vincolati all’operatore e all’account.

I collegamenti esistenti NON acquisiscono automaticamente nuovi permessi:
la sezione offre un flusso esplicito di autorizzazione aggiuntiva Meta.
Messaggistica verso clienti reali può richiedere Advanced Access/App Review.
LinkedIn e TikTok: posta e statistiche non ancora integrate; nessun dato simulato.
Le quattro fonti Credipass Italia sono riferimenti apribili, non feed sincronizzati.
Sondaggi e sticker interattivi non sono implementati da questo aggiornamento.

## Workspace, inbox e report
- Interfaccia blu/oro e logo originale già presente nel repository, servito anche dalla funzione cloud.
- Inbox aggregata Facebook/Instagram, filtri social/account e ricerca nomi. Caricamento all’apertura e polling ogni 60 secondi mentre la pagina è visibile. La bozza di risposta non viene sovrascritta. Nessun webhook o sincronizzazione a browser chiuso; commenti e allegati non integrati. I ticket per conversazione sono riutilizzati, senza memorizzare testi.
- Analisi: periodo 7/14/28 giorni, spiegazioni KPI, serie giornaliera Instagram reach se restituita da Meta, tabella accessibile e stampa/PDF dal browser. Nessun dato stimato; Facebook espone ancora solo contatori correnti, non andamento storico. Report automatici periodici e confronto col periodo precedente non implementati.
- Libreria: cestino recuperabile con ACL per sede. Non elimina fisicamente gli allegati e non annulla le copie nel calendario.
- Programmazione multipla: selezione contenuti della stessa sede, destinazioni/formati espliciti, data comune o distanza 1/7 giorni. Validazione di tutte le destinazioni prima di un batch atomico; request ID idempotente. Approva tutte le bozze nel calendario conserva gli errori per elemento senza ritentare invii.
- ADS: sezione predisposta con collegamento al gestore ufficiale. Account pubblicitario e permessi Ads non collegati, nessuna campagna o spesa avviabile dall’Hub.
