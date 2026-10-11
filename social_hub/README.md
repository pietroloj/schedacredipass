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
