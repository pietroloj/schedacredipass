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
LinkedIn e TikTok non sono attivati perché gli account non sono ancora stati creati.

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
`TESTO_DA_COPIARE.txt`, creando soltanto contenuti in libreria. Limiti: 150 MB
compressi, 250 MB estratti, 600 file, 15 MB per file; nessuna estrazione nel filesystem.
Le cartelle riconosciute sono Facebook, Instagram, LinkedIn, Stories_FB_IG,
Reel_FB_IG e TikTok. Gli script video e le istruzioni restano nel pacchetto originale.
Le date si scelgono esplicitamente; il nome LUNEDI non imposta una data da solo.
Un errore di importazione può essere ritentato nella stessa sessione senza ricaricare
gli asset già riusciti. Ricaricare lo stesso ZIP in una nuova sessione crea nuove bozze.

Il calendario mensile/settimanale filtra per social e stato. Un clic sul giorno
apre la programmazione; un clic sul post apre modifica e approvazione. Le immagini
e i testi vengono copiati dallo slot del social nel job, conservando lo snapshot.
I contenuti da approvare non sono invii attivi. Le copertine Reel non sono video:
il server impedisce di inviarle come Reel. Lo slot Storie programma Instagram Story;
la grafica è riutilizzabile manualmente su Facebook. TikTok resta manuale.

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
TikTok usa questo percorso assistito: Direct Post non è abilitato per lo strumento interno.
Una copertina non costituisce un video Reel/TikTok.

Test OAuth con risposte simulate: stato monouso, scadenza, isolamento del provider e dell’utente,
identità LinkedIn, host Instagram diretto, token scaduti, esclusione dei promemoria dal worker.
I test non sostituiscono il collaudo con un account autorizzato e una pubblicazione reale approvata.
