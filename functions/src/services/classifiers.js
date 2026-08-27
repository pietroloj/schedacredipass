const { MODELS, structuredCall } = require("./openaiClient");
const { DOCS, DOC_TYPES } = require("../config/documents");
const { stripNumericSuffix } = require("../utils/strings");
const {
  classificationSchema,
  classificationRetrySchema,
} = require("../schemas/classificationSchemas");
const { getExpectedSides } = require("./precheck");

/*
|--------------------------------------------------------------------------
| NORMALIZZAZIONE CODICE DOCUMENTO
|--------------------------------------------------------------------------
|
| Gestisce:
|
| doc_ci
| doc_ci1
| doc_ts2
|
| oppure codici senza prefisso "doc_".
|
*/

function normalizeDocumentCode(tipoDocumentoAtteso) {
  const raw = String(tipoDocumentoAtteso || "").trim();

  if (!raw) {
    return "";
  }

  const codiceBase = stripNumericSuffix(raw);

  /*
   * Se è già un codice valido/configurato, lo restituiamo.
   */
  if (DOCS[codiceBase] || DOC_TYPES.includes(codiceBase)) {
    return codiceBase;
  }

  /*
   * Proviamo ad aggiungere il prefisso doc_
   */
  const conPrefisso = codiceBase.startsWith("doc_")
    ? codiceBase
    : `doc_${codiceBase}`;

  if (DOCS[conPrefisso] || DOC_TYPES.includes(conPrefisso)) {
    return conPrefisso;
  }

  /*
   * Fallback permissivo.
   */
  return codiceBase;
}

/*
|--------------------------------------------------------------------------
| NOME LEGGIBILE DOCUMENTO
|--------------------------------------------------------------------------
*/

function getDocumentName(codiceBase) {
  if (DOCS[codiceBase]) {
    return DOCS[codiceBase];
  }

  return (
    String(codiceBase || "")
      .replace(/^doc_/, "")
      .replace(/_/g, " ")
      .trim() || "Documento"
  );
}

/*
|--------------------------------------------------------------------------
| CLASSIFICAZIONE PRINCIPALE
|--------------------------------------------------------------------------
*/

async function classifyDocument({
  tipoDocumentoAtteso,
  preparedFiles,
}) {
  const codiceBase =
    normalizeDocumentCode(tipoDocumentoAtteso);

  const docName =
    getDocumentName(codiceBase);

  const expectedSides =
    getExpectedSides(codiceBase);

  const contentItems =
    preparedFiles.flatMap(
      (f) => f.contentItems || []
    );

  return structuredCall({
    model: MODELS.FAST,

    schemaName:
      "document_classification",

    schema:
      classificationSchema(DOC_TYPES),

    systemText: `
Sei un classificatore documentale per pratiche di mutuo e credito.

Il tuo compito è identificare il tipo di documento e stabilire se è RAGIONEVOLMENTE compatibile con quello richiesto.

DEVI ESSERE MOLTO PERMISSIVO.

PRINCIPIO FONDAMENTALE:
se un essere umano riuscirebbe ragionevolmente a riconoscere il documento richiesto, devi considerarlo compatibile.

NON devi comportarti come un revisore formale.

ACCETTA:
- fotografie di documenti;
- scansioni;
- PDF multipagina;
- documenti leggermente inclinati;
- documenti fotografati da smartphone;
- documenti con piccoli riflessi;
- documenti parzialmente sfocati;
- documenti leggermente tagliati;
- documenti con qualità non perfetta;
- documenti fronte e retro contenuti nello stesso PDF;
- documenti con più pagine;
- copie scannerizzate;
- documenti stampati e successivamente fotografati.

NON considerare NON VALIDO un documento soltanto perché:
- manca una pagina;
- manca il retro;
- non sono leggibili tutti i campi;
- alcuni dati sono coperti;
- alcuni dati sono sfocati;
- il documento è inclinato;
- la scansione non è perfetta;
- una parte marginale è tagliata;
- non riesci a verificare la validità temporale;
- non riesci a verificare autenticità o provenienza;
- non riesci a leggere perfettamente nomi, date, codici fiscali o numeri documento.

NON valutare:
- correttezza fiscale;
- correttezza bancaria;
- merito creditizio;
- congruità del reddito;
- validità giuridica;
- autenticità;
- scadenza;
- corrispondenza anagrafica col cliente.

DEVI RIFIUTARE SOLO IN DUE CASI:

1. Il documento appartiene CHIARAMENTE a una categoria completamente diversa da quella richiesta.

Esempi:
- richiesta carta d'identità, caricata busta paga;
- richiesto estratto conto, caricata planimetria;
- richiesta CU, caricato atto notarile.

2. Il documento è talmente illeggibile che un essere umano non riuscirebbe a capire di che documento si tratta.

IMPORTANTE:
se esiste un dubbio tra il tipo richiesto e un tipo simile, devi favorire il tipo richiesto.

Esempio:
se è richiesta una Carta d'Identità e il documento contiene chiaramente dati anagrafici, fotografia, numero documento o caratteristiche tipiche di un documento di identità, consideralo coerente anche se manca il retro o alcuni campi non sono leggibili.

Esempio:
se è richiesta una Tessera Sanitaria e il documento contiene codice fiscale, nome, cognome o caratteristiche tipiche della tessera sanitaria, consideralo coerente.

Esempio:
se è richiesta una Busta Paga e il documento presenta elementi tipici di un cedolino, consideralo coerente anche se alcuni importi sono poco leggibili.

Esempio:
se è richiesto un Estratto Conto e il documento mostra intestazione bancaria, movimenti, saldi o dati di conto, consideralo coerente.

UTILIZZO DEI CAMPI DELLO SCHEMA:

- "coerenza_documentale":
  TRUE se il documento è ragionevolmente compatibile con quello richiesto.
  FALSE solo se è chiaramente di un altro tipo.

- "gravemente_illeggibile":
  TRUE solo se è praticamente impossibile capire che documento sia.
  Una qualità mediocre NON significa gravemente illeggibile.

- "valido":
  TRUE nella maggior parte dei casi.
  FALSE solo se il documento è chiaramente sbagliato o totalmente illeggibile.

- "confidenza_classificazione":
  esprimi una stima realistica.
  Non abbassarla automaticamente per piccole imperfezioni fotografiche.

- "motivo_errore":
  deve essere vuoto se il documento è accettabile.
  Se non è valido, spiega in modo semplice e preciso perché.

DOCUMENTO RICHIESTO:
${docName}

CODICE RICHIESTO:
${codiceBase}

FRONTE RICHIESTO TECNICAMENTE:
${expectedSides.front ? "SI" : "NO"}

RETRO RICHIESTO TECNICAMENTE:
${expectedSides.back ? "SI" : "NO"}

Ricorda:
la mancanza del retro NON è sufficiente, da sola, per dichiarare il documento non valido.

Restituisci esclusivamente la struttura JSON prevista dallo schema.
`.trim(),

    userText: `
Analizza il documento allegato.

Documento atteso:
${docName}

Codice:
${codiceBase}

Sii permissivo.

Se il documento è plausibilmente riconducibile alla categoria richiesta, imposta:
- coerenza_documentale = true
- valido = true

Usa valido = false solo quando sei fortemente convinto che sia un documento completamente diverso o totalmente illeggibile.
`.trim(),

    contentItems,
  });
}

/*
|--------------------------------------------------------------------------
| SECONDO TENTATIVO
|--------------------------------------------------------------------------
|
| Retry ancora più permissivo, pensato per ridurre i falsi rifiuti.
|
*/

async function retryClassification({
  tipoDocumentoAtteso,
  preparedFiles,
}) {
  const codiceBase =
    normalizeDocumentCode(tipoDocumentoAtteso);

  const docName =
    getDocumentName(codiceBase);

  const contentItems =
    preparedFiles.flatMap(
      (f) => f.contentItems || []
    );

  return structuredCall({
    model: MODELS.FAST,

    schemaName:
      "document_classification_retry",

    schema:
      classificationRetrySchema(DOC_TYPES),

    systemText: `
Sei il secondo controllo di classificazione documentale.

Il primo controllo ha avuto dubbi.

Il tuo compito è evitare falsi rifiuti.

DEVI ESSERE MOLTO PERMISSIVO.

Documento atteso:
${docName}

Codice:
${codiceBase}

REGOLE:

- Se il documento potrebbe ragionevolmente essere quello richiesto, consideralo coerente.
- Non penalizzare scansioni imperfette.
- Non penalizzare fotografie da smartphone.
- Non penalizzare assenza del retro.
- Non penalizzare pagine mancanti.
- Non penalizzare campi parzialmente illeggibili.
- Non penalizzare riflessi, inclinazione o piccoli tagli.
- Non verificare autenticità.
- Non verificare scadenze.
- Non verificare la correttezza dei dati.

Imposta coerenza_documentale = false SOLO quando il documento è chiaramente di un'altra categoria.

Imposta gravemente_illeggibile = true SOLO se non è possibile nemmeno capire quale tipo di documento sia.

In caso di dubbio:
FAVORISCI SEMPRE IL DOCUMENTO ATTESO.

Non inventare errori.
`.trim(),

    userText: `
Secondo tentativo.

Tipo documento richiesto:
${docName}

Codice:
${codiceBase}

Se esiste una ragionevole possibilità che il documento appartenga a questa categoria, consideralo coerente.
`.trim(),

    contentItems,
  });
}

module.exports = {
  classifyDocument,
  retryClassification,
};
