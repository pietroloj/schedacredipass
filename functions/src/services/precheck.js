const { DOC_TYPES } = require("../config/documents");
const { stripNumericSuffix } = require("../utils/strings");
const {
  parseMimeTypeFromDataUrl,
  base64ToBuffer,
  mimeSupported,
} = require("../utils/files");

/*
|--------------------------------------------------------------------------
| PRECHECK TECNICO PERMISSIVO
|--------------------------------------------------------------------------
|
| SCOPO:
| Il precheck NON deve decidere se il documento è semanticamente corretto.
| Deve solamente verificare che il file sia tecnicamente utilizzabile.
|
| La classificazione del tipo di documento viene effettuata DOPO dall'AI.
|
| Pertanto NON blocchiamo:
| - carta identità in PDF unico fronte/retro
| - tessera sanitaria in PDF unico
| - scansioni multipagina
| - documenti classificati con bassa confidenza
| - descrizioni testuali al posto del codice tecnico
|
|--------------------------------------------------------------------------
*/

function getExpectedSides(codiceBase) {
  /*
   * Non rendiamo più obbligatori fronte e retro come file separati.
   *
   * Un unico PDF può contenere entrambe le facciate.
   * Una singola immagine può comunque essere sottoposta all'AI,
   * che deciderà se è sufficiente o se richiede revisione.
   */
  return {
    front: false,
    back: false,
  };
}

/**
 * Cerca di ricavare un codice documento valido.
 *
 * Accetta sia:
 *    doc_ci1
 *    doc_ci
 *
 * sia eventuali descrizioni usate dal frontend.
 */
function normalizeDocumentCode(tipoDocumentoAtteso) {
  const raw = String(tipoDocumentoAtteso || "").trim();

  if (!raw) {
    return "";
  }

  const stripped = stripNumericSuffix(raw);

  /*
   * Se è già un codice riconosciuto lo restituiamo.
   */
  if (DOC_TYPES.includes(stripped)) {
    return stripped;
  }

  /*
   * Compatibilità con descrizioni testuali provenienti dall'upload.html.
   */
  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const mappings = [
    {
      tests: [
        "carta d'identita",
        "carta identita",
        "documento identita",
      ],
      code: "doc_ci",
    },

    {
      tests: [
        "tessera sanitaria",
        "codice fiscale",
      ],
      code: "doc_ts",
    },

    {
      tests: [
        "certificato cumulativo",
        "residenza e stato di famiglia",
        "stato di famiglia",
      ],
      code: "doc_residenza",
    },

    {
      tests: [
        "busta paga",
        "buste paga",
      ],
      code: "doc_bustepaga",
    },

    {
      tests: [
        "certificazione unica",
        "cud",
        "cu ",
      ],
      code: "doc_cud",
    },

    {
      tests: [
        "modello redditi",
        "modello unico",
        "modelli unici",
      ],
      code: "doc_unici",
    },

    {
      tests: [
        "visura camerale",
      ],
      code: "doc_visura",
    },

    {
      tests: [
        "f24",
      ],
      code: "doc_f24",
    },

    {
      tests: [
        "estratto conto",
      ],
      code: "doc_ec",
    },

    {
      tests: [
        "lista movimenti",
        "movimenti conto corrente",
      ],
      code: "doc_mov",
    },

    {
      tests: [
        "atto di matrimonio",
      ],
      code: "doc_matrimonio",
    },

    {
      tests: [
        "atto di provenienza",
      ],
      code: "doc_atto",
    },

    {
      tests: [
        "planimetria",
        "visura catastale",
      ],
      code: "doc_planimetria",
    },

    {
      tests: [
        "preliminare",
        "proposta di acquisto",
      ],
      code: "doc_preliminare",
    },

    {
      tests: [
        "preventivo lavori",
        "computo metrico",
      ],
      code: "doc_preventivo",
    },

    {
      tests: [
        "atto mutuo",
        "mutuo in corso",
      ],
      code: "doc_mutuo_pre",
    },

    {
      tests: [
        "conteggi estintivi",
        "finanziamenti",
      ],
      code: "doc_prestiti",
    },
  ];

  for (const mapping of mappings) {
    if (
      mapping.tests.some((text) =>
        normalized.includes(text)
      )
    ) {
      /*
       * Restituiamo il codice solo se esiste realmente
       * nella configurazione del progetto.
       */
      if (DOC_TYPES.includes(mapping.code)) {
        return mapping.code;
      }
    }
  }

  /*
   * Non riconosciuto.
   *
   * IMPORTANTE:
   * non lo consideriamo automaticamente un errore tecnico.
   */
  return stripped;
}

function technicalPrecheck({
  files,
  tipoDocumentoAtteso,
}) {
  const codiceBase =
    normalizeDocumentCode(tipoDocumentoAtteso);

  /*
  |--------------------------------------------------------------------------
  | 1. DEVE ESISTERE ALMENO UN FILE
  |--------------------------------------------------------------------------
  */

  if (
    !Array.isArray(files) ||
    files.length === 0
  ) {
    return {
      ok: false,
      motivo:
        "Nessun file ricevuto. Seleziona o scansiona almeno un documento.",
      codiceBase,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | 2. CONTROLLO ESCLUSIVAMENTE TECNICO DEI FILE
  |--------------------------------------------------------------------------
  */

  for (let index = 0; index < files.length; index++) {
    const file = files[index];

    if (!file || !file.base64) {
      return {
        ok: false,
        motivo:
          `Il file ${index + 1} non contiene dati utilizzabili.`,
        codiceBase,
      };
    }

    let mime = "";

    try {
      mime =
        parseMimeTypeFromDataUrl(
          file.base64 || ""
        );
    } catch (error) {
      console.warn(
        "Impossibile determinare MIME:",
        error
      );
    }

    /*
     * Se il MIME è disponibile ma non supportato,
     * allora ha senso bloccare.
     *
     * Se invece non è determinabile non blocchiamo:
     * proverà lo step successivo.
     */
    if (
      mime &&
      !mimeSupported(mime)
    ) {
      return {
        ok: false,
        motivo:
          `Formato file non supportato: ${mime}. Utilizza PDF, JPG, JPEG o PNG.`,
        codiceBase,
        mime,
      };
    }

    let buffer;

    try {
      buffer =
        base64ToBuffer(file.base64);
    } catch (error) {
      console.error(
        "Errore conversione base64:",
        error
      );

      return {
        ok: false,
        motivo:
          `Il file ${index + 1} non può essere letto. Prova a caricarlo nuovamente.`,
        codiceBase,
      };
    }

    /*
     * 100 byte è sufficiente per eliminare solo file
     * realmente vuoti/corrotti.
     *
     * Prima avevi 500.
     */
    if (
      !buffer ||
      buffer.length < 100
    ) {
      return {
        ok: false,
        motivo:
          `Il file ${index + 1} risulta vuoto o danneggiato.`,
        codiceBase,
        dimensione:
          buffer?.length || 0,
      };
    }
  }

  /*
  |--------------------------------------------------------------------------
  | 3. NON OBBLIGHIAMO FRONTE E RETRO COME FILE DISTINTI
  |--------------------------------------------------------------------------
  |
  | Un PDF può contenere:
  |
  | pagina 1 = fronte CI
  | pagina 2 = retro CI
  |
  | Pertanto non deve essere respinto dal PRECHECK.
  |
  | Sarà classificazione/extraction a stabilire se il contenuto
  | è sufficiente.
  |
  */

  /*
  |--------------------------------------------------------------------------
  | 4. TIPO DOCUMENTO NON PRESENTE IN DOC_TYPES
  |--------------------------------------------------------------------------
  |
  | In modalità permissiva NON blocchiamo qui.
  |
  | Lo segnaliamo solamente nel risultato.
  |
  */

  const tipoRegistrato =
    DOC_TYPES.includes(codiceBase);

  if (!tipoRegistrato) {
    console.warn(
      `[PRECHECK] Tipo documento non presente in DOC_TYPES: "${codiceBase}". ` +
      `Il file viene comunque ammesso al processing.`
    );
  }

  return {
    ok: true,
    motivo: "",
    codiceBase,
    tipoRegistrato,
    numeroFiles: files.length,
  };
}

module.exports = {
  technicalPrecheck,
  getExpectedSides,
  normalizeDocumentCode,
};
