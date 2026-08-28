const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

const { POLICY } = require("./config/policy");
const { DOC_GROUPS } = require("./config/documents");

const {
  stripNumericSuffix,
  sha256String,
} = require("./utils/strings");

const {
  buildUiResult,
  buildBaseResponse,
} = require("./utils/responseBuilders");

const {
  technicalPrecheck,
} = require("./services/precheck");

const {
  uploadAndPrepareContents,
} = require("./services/openaiClient");

const {
  classifyDocument,
  retryClassification,
} = require("./services/classifiers");

const {
  extractIdentity,
} = require("./services/extractors.identity");

const {
  extractIncome,
} = require("./services/extractors.income");

const {
  extractBank,
} = require("./services/extractors.bank");

const {
  extractRealEstate,
} = require("./services/extractors.realEstate");

const {
  extractGeneric,
} = require("./services/extractors.generic");

const {
  buildPracticeSnapshot,
} = require("./services/reconciler");

const {
  detectPracticeAnomalies,
} = require("./services/anomalyEngine");

const {
  matchBanksForPractice,
} = require("./services/bankMatcher");

const {
  calcolaRedditoBancarioMensilePrudenziale,
  calcolaDTI,
  calcolaLTV,
  scoreIncomeDecision,
  scoreBankDecision,
  reviewPolicy,
  getDecisionCode,
} = require("./services/decisionEngine");

const {
  calculatePracticeIncome,
} = require("./services/practiceIncomeCalculator");

const {
  calculateFinancialCommitments,
  calculatePracticeRatios,
} = require("./services/practiceFinancialCalculator");


const {
  deletePracticeDocument,
} = require("./services/deletePracticeDocument");

const {
  bootstrapFirstAdmin,
  ensureConsultantProfile,
  createConsultant,
  updateConsultantVisibility,
  updateConsultantPermissions,
} = require("./services/authConsultants");

const {
  getSummaryDoc,
  saveSummaryDoc,
  saveAuditEntry,
  upsertManualReview,
} = require("./repositories/firestoreRepository");


/*
|--------------------------------------------------------------------------
| FUNZIONI MATEMATICHE
|--------------------------------------------------------------------------
|
| Nel tuo precedente index.js queste erano commentate ma venivano poi
| utilizzate all'interno di mergePracticeFinancials().
|
*/

const { normalizeNumber, formatNumberIT } = require("./utils/numbers");


/*
|--------------------------------------------------------------------------
| FIREBASE ADMIN
|--------------------------------------------------------------------------
*/

if (!admin.apps.length) {
  admin.initializeApp();
}

const adminDb = admin.firestore();


/*
|--------------------------------------------------------------------------
| GLOBAL OPTIONS
|--------------------------------------------------------------------------
*/

setGlobalOptions({
  region: "us-central1",
  memory: "1GiB",
  timeoutSeconds: 300,
});


/*
|--------------------------------------------------------------------------
| CONFIGURAZIONE AI PERMISSIVA
|--------------------------------------------------------------------------
|
| Questa parte stabilisce quando l'AI può DAVVERO rifiutare un documento.
|
| Filosofia:
|
| 1. documento corretto
|       -> ACCETTATO
|
| 2. AI poco sicura
|       -> ACCETTATO + REVIEW MANUALE
|
| 3. tipo non determinabile
|       -> ACCETTATO + REVIEW MANUALE
|
| 4. documento leggermente illeggibile
|       -> ACCETTATO + REVIEW MANUALE
|
| 5. documento chiaramente diverso con confidenza >= 98%
|       -> RIFIUTATO
|
| 6. documento gravemente illeggibile con confidenza >= 97%
|       -> RIFIUTATO
|
*/

const PERMISSIVE_AI = {
  hardRejectWrongDocumentConfidence: 0.98,
  hardRejectUnreadableConfidence: 0.97,
  lowConfidenceReviewThreshold: 0.80,
};


/*
|--------------------------------------------------------------------------
| HELPERS GENERALI
|--------------------------------------------------------------------------
*/

function normalizeString(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}


function normalizeConfidence(value) {
  let n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  /*
   * Se per qualche motivo il classifier restituisce 95 invece di 0.95,
   * normalizziamo automaticamente.
   */
  if (n > 1 && n <= 100) {
    n = n / 100;
  }

  return Math.max(0, Math.min(1, n));
}


function percentConfidence(value) {
  return Math.round(normalizeConfidence(value) * 100);
}


function humanDocumentName(value) {
  const text = String(value ?? "").trim();

  if (!text) {
    return "documento non determinato";
  }

  return text.replace(/_/g, " ");
}


/*
|--------------------------------------------------------------------------
| SPIEGAZIONE DEL RIFIUTO
|--------------------------------------------------------------------------
|
| Costruiamo un messaggio comprensibile anche per il cliente.
|
*/

function buildRejectionExplanation({
  classificazione,
  tipoDocumentoAtteso,
  reasonType,
}) {
  const detected =
    classificazione?.tipo_documento_rilevato ||
    "non_determinabile";

  const confidence =
    percentConfidence(
      classificazione?.confidenza_classificazione
    );

  const originalReason =
    String(
      classificazione?.motivo_errore || ""
    ).trim();

  const expectedLabel =
    humanDocumentName(tipoDocumentoAtteso);

  const detectedLabel =
    humanDocumentName(detected);


  /*
   * DOCUMENTO ILLEGGIBILE
   */

  if (reasonType === "unreadable") {
    let message =
      `Il documento non può essere accettato perché risulta gravemente illeggibile.`;

    if (confidence > 0) {
      message +=
        ` Il controllo automatico ha rilevato questa condizione con una confidenza del ${confidence}%.`;
    }

    message +=
      ` Prova a caricare nuovamente il documento assicurandoti che sia completo, ben illuminato, a fuoco e senza parti tagliate.`;

    if (originalReason) {
      message +=
        ` Dettaglio del controllo: ${originalReason}`;
    }

    return message;
  }


  /*
   * DOCUMENTO DIFFERENTE
   */

  if (reasonType === "wrong_document") {
    let message =
      `Il documento caricato sembra essere diverso da quello richiesto.`;

    message +=
      ` Era richiesto "${expectedLabel}", mentre il sistema ha riconosciuto "${detectedLabel}".`;

    if (confidence > 0) {
      message +=
        ` Confidenza del riconoscimento: ${confidence}%.`;
    }

    message +=
      ` Verifica di aver selezionato il documento corretto e riprova.`;

    if (originalReason) {
      message +=
        ` Dettaglio del controllo: ${originalReason}`;
    }

    return message;
  }


  /*
   * FALLBACK
   */

  return (
    originalReason ||
    `Il documento non è stato riconosciuto correttamente. Verifica il file caricato e riprova.`
  );
}


/*
|--------------------------------------------------------------------------
| VALUTAZIONE PERMISSIVA CLASSIFICAZIONE
|--------------------------------------------------------------------------
*/

function valutaClassificazionePermissiva(
  classificazione,
  tipoDocumentoAtteso
) {
  const confidence =
    normalizeConfidence(
      classificazione?.confidenza_classificazione
    );

  const detected =
    normalizeString(
      classificazione?.tipo_documento_rilevato
    );

  const coherent =
    classificazione?.coerenza_documentale === true;

  const unreadable =
    classificazione?.gravemente_illeggibile === true;

  const originalValid =
    classificazione?.valido === true;

  const undetermined =
    !detected ||
    detected === "non_determinabile" ||
    detected === "non determinabile" ||
    detected === "unknown" ||
    detected === "sconosciuto";


  /*
  |--------------------------------------------------------------------------
  | HARD REJECT 1
  | Documento davvero illeggibile
  |--------------------------------------------------------------------------
  */

  if (
    unreadable &&
    confidence >=
      PERMISSIVE_AI.hardRejectUnreadableConfidence
  ) {
    return {
      hardReject: true,
      manualReview: false,
      reasonType: "unreadable",

      motivo: buildRejectionExplanation({
        classificazione,
        tipoDocumentoAtteso,
        reasonType: "unreadable",
      }),
    };
  }


  /*
  |--------------------------------------------------------------------------
  | HARD REJECT 2
  | Documento chiaramente differente
  |--------------------------------------------------------------------------
  |
  | Importante:
  | la soglia è volutamente 98%.
  |
  | Quindi:
  |
  | Carta identità richiesta
  | tessera sanitaria rilevata 72%
  |     -> NON BLOCCA
  |
  | Carta identità richiesta
  | tessera sanitaria rilevata 99%
  |     -> BLOCCA
  |
  */

  if (
    !coherent &&
    !undetermined &&
    confidence >=
      PERMISSIVE_AI.hardRejectWrongDocumentConfidence
  ) {
    return {
      hardReject: true,
      manualReview: false,
      reasonType: "wrong_document",

      motivo: buildRejectionExplanation({
        classificazione,
        tipoDocumentoAtteso,
        reasonType: "wrong_document",
      }),
    };
  }


  /*
  |--------------------------------------------------------------------------
  | REVIEW MANUALE
  |--------------------------------------------------------------------------
  |
  | Tutti i casi dubbi passano.
  |
  */

  const motiviReview = [];

  if (unreadable) {
    motiviReview.push(
      "Il documento potrebbe essere parzialmente illeggibile."
    );
  }

  if (undetermined) {
    motiviReview.push(
      "Il tipo di documento non è stato determinato con certezza."
    );
  }

  if (!coherent) {
    motiviReview.push(
      "La corrispondenza con il documento richiesto non è certa."
    );
  }

  if (
    confidence <
    PERMISSIVE_AI.lowConfidenceReviewThreshold
  ) {
    motiviReview.push(
      `Confidenza AI bassa (${percentConfidence(confidence)}%).`
    );
  }

  if (!originalValid) {
    motiviReview.push(
      "Il classificatore automatico aveva originariamente segnalato il documento come non valido."
    );
  }


  if (motiviReview.length > 0) {
    return {
      hardReject: false,
      manualReview: true,
      reasonType: "review",
      motivo: Array.from(
        new Set(motiviReview)
      ).join(" "),
    };
  }


  /*
  |--------------------------------------------------------------------------
  | DOCUMENTO OK
  |--------------------------------------------------------------------------
  */

  return {
    hardReject: false,
    manualReview: false,
    reasonType: "accepted",
    motivo: "",
  };
}


/*
|--------------------------------------------------------------------------
| CONTESTO PRATICA
|--------------------------------------------------------------------------
*/

function buildPracticeContext(data) {
  return `
CONTESTO PRATICA MUTUO
- Importo mutuo: ${data.importoMutuo ?? "N/D"}
- Valore immobile: ${data.valoreImmobile ?? "N/D"}
- Rata mutuo stimata: ${data.rataMutuoStimata ?? "N/D"}
- Rate altri finanziamenti: ${data.rateAltriFinanziamenti ?? "N/D"}
- Durata anni: ${data.durataAnni ?? "N/D"}
- Prodotto bancario: ${data.prodottoBancario ?? "N/D"}
- Finalità mutuo: ${data.finalitaMutuo ?? "N/D"}
- Note pratica: ${data.notePratica ?? "N/D"}
`.trim();
}



/*
|--------------------------------------------------------------------------
| NORMALIZZAZIONE CODICI DOCUMENTO DAL FRONTEND
|--------------------------------------------------------------------------
|
| Il frontend storico invia:
|   tipoDocumentoAtteso = descrizione umana (es. "Estratto conto trimestrale")
|   codiceDocumento     = codice tecnico (es. "ec1", "cud1")
|
| Il backend, invece, lavora con codici canonici:
|   doc_ec1, doc_cud1, doc_mov1, ...
|
| Senza questa conversione CU ed estratti conto finiscono nell'extractor
| generico e quindi score reddito / score bancario restano N/D.
|
*/

function normalizeIncomingDocumentCode({
  codiceDocumento,
  tipoDocumentoAtteso,
}) {
  const rawCode = String(codiceDocumento || "").trim().toLowerCase();
  const rawExpected = String(tipoDocumentoAtteso || "").trim().toLowerCase();

  const code = rawCode || rawExpected;

  // Se è già canonico, non tocchiamolo.
  if (/^doc_[a-z0-9_]+$/i.test(code)) {
    return code;
  }

  // Se contiene un suffisso R1/R2, lo preserviamo.
  const suffixMatch = code.match(/(\d+)$/);
  const suffix = suffixMatch ? suffixMatch[1] : "";
  const base = code.replace(/\d+$/, "");

  const FIELD_TO_CANONICAL = {
    ci: "doc_ci",
    ts: "doc_ts",
    residenza: "doc_residenza",
    matrimonio: "doc_matrimonio",
    isee: "doc_isee",

    bustepaga: "doc_bustepaga",
    cud: "doc_cud",
    cu: "doc_cud",
    unici: "doc_unici",
    unico: "doc_unici",
    redditi: "doc_unici",
    f24: "doc_f24",
    visura: "doc_visura",

    ec: "doc_ec",
    mov: "doc_mov",
    prestiti: "doc_prestiti",
    mutuo_pre: "doc_mutuo_pre",

    atto: "doc_atto",
    planimetria: "doc_planimetria",
    visuracat: "doc_visuracat",
    preliminare: "doc_preliminare",
    preventivo: "doc_preventivo",

    contratto: "doc_contratto",
    integrazione: "doc_integrazione",
    extra: "doc_extra",
  };

  if (FIELD_TO_CANONICAL[base]) {
    return `${FIELD_TO_CANONICAL[base]}${suffix}`;
  }

  // Fallback sulle descrizioni umane inviate dal vecchio upload.html.
  const human = rawExpected;

  const HUMAN_RULES = [
    [/certificazione unica|cud\b/, "doc_cud"],
    [/busta paga|cedolino/, "doc_bustepaga"],
    [/modello redditi|modello unico|unico con ricevuta/, "doc_unici"],
    [/estratto conto/, "doc_ec"],
    [/lista movimenti|movimenti conto/, "doc_mov"],
    [/carta d.identit|carta identit/, "doc_ci"],
    [/tessera sanitaria|codice fiscale/, "doc_ts"],
    [/isee/, "doc_isee"],
    [/visura camerale/, "doc_visura"],
    [/f24/, "doc_f24"],
    [/atto di provenienza|atto provenienza/, "doc_atto"],
    [/planimetria/, "doc_planimetria"],
    [/visura catastale/, "doc_visuracat"],
    [/preliminare|proposta/, "doc_preliminare"],
  ];

  for (const [regex, canonical] of HUMAN_RULES) {
    if (regex.test(human)) {
      return `${canonical}${suffix}`;
    }
  }

  // Ultimo fallback: prefisso doc_ su un codice tecnico semplice.
  if (/^[a-z][a-z0-9_]*\d*$/i.test(code)) {
    return `doc_${code}`;
  }

  return code;
}

/*
|--------------------------------------------------------------------------
| ANALYSIS KEY
|--------------------------------------------------------------------------
*/

function computeAnalysisKey({
  idCliente,
  codiceBase,
  files,
}) {
  const fileHashComposite = files
    .map(
      (f) =>
        `${f.side}:${f.sha256}`
    )
    .sort()
    .join("|");

  return sha256String(
    `${POLICY.pipelineVersion}|${idCliente}|${codiceBase}|${fileHashComposite}`
  );
}


/*
|--------------------------------------------------------------------------
| CARICAMENTO ANALISI DOCUMENTI CLIENTE
|--------------------------------------------------------------------------
*/

async function loadClientDocumentAnalyses(
  idCliente
) {
  const docRef =
    adminDb
      .collection("analisi_deliberante")
      .doc(idCliente);

  const auditSnap =
    await docRef
      .collection("audit")
      .get();

  const latestByDocType =
    new Map();

  auditSnap.forEach((doc) => {
    const data =
      doc.data() || {};

    /*
     * Dai nuovi upload salviamo il codice completo (es. doc_cud1/doc_cud2)
     * dentro decisioneBackend._tipoDocumentoOriginale.
     * Gli audit precedenti continueranno a funzionare usando il tipo base.
     */
    const tipoDocumento =
      data
        .decisioneBackend
        ?._tipoDocumentoOriginale ||
      data
        .tipoDocumentoOriginale ||
      data
        .tipoDocumentoAtteso ||
      "";

    if (!tipoDocumento) {
      return;
    }

    const tipoDocumentoBase =
      stripNumericSuffix(
        tipoDocumento
      );

    const createdAt =
      data
        .createdAt
        ?.toMillis?.() ||
      0;

    const key =
      String(
        tipoDocumento
      );

    const current =
      latestByDocType.get(
        key
      );

    if (
      !current ||
      createdAt >
        current.createdAt
    ) {
      latestByDocType.set(
        key,
        {
          createdAt,
          tipoDocumento,
          tipoDocumentoBase,

          classificazione:
            data
              .classificazione ||
            null,

          estrazione:
            data
              .estrazione ||
            null,

          decisioneBackend:
            data
              .decisioneBackend ||
            null,

          review:
            data
              .review ||
            null,

          decisionCode:
            data
              .decisionCode ||
            "",
        }
      );
    }
  });

  return Array.from(
    latestByDocType.values()
  );
}


/*
|--------------------------------------------------------------------------
| MERGE DATI FINANZIARI
|--------------------------------------------------------------------------
*/

function getApplicantKey(
  tipoDocumento = ""
) {
  const raw =
    String(
      tipoDocumento
    );

  const match =
    raw.match(/(\d+)$/);

  if (!match) {
    return "unknown";
  }

  return `r${match[1]}`;
}


function getIncomePriority(
  tipoDocumentoBase = ""
) {
  const base =
    String(
      tipoDocumentoBase
    ).toLowerCase();

  if (
    base.includes("cud") ||
    base.includes("cu")
  ) {
    return 100;
  }

  if (
    base.includes("unici") ||
    base.includes("unico") ||
    base.includes("redditi")
  ) {
    return 80;
  }

  if (
    base.includes("bustepaga") ||
    base.includes("busta")
  ) {
    return 50;
  }

  return 0;
}


function average(
  values = []
) {
  const nums =
    values
      .map((v) =>
        normalizeNumber(v)
      )
      .filter(
        (v) =>
          Number.isFinite(v)
      );

  if (!nums.length) {
    return null;
  }

  return (
    nums.reduce(
      (sum, n) =>
        sum + n,
      0
    ) /
    nums.length
  );
}


function mergePracticeFinancials({
  documentAnalyses,
  practiceData = {},
  importoMutuo,
  valoreImmobile,
  rataMutuoStimata,
  rateAltriFinanziamenti,
}) {
  const practiceIncome =
    calculatePracticeIncome(
      documentAnalyses,
      practiceData
    );

  const impegni =
    calculateFinancialCommitments(
      practiceData,
      {
        fallbackOtherRates:
          rateAltriFinanziamenti,
      }
    );

  const ratios =
    calculatePracticeRatios({
      redditoMensile:
        practiceIncome
          .redditoNettoMensile,

      rataNuovoMutuo:
        rataMutuoStimata,

      impegni,
    });

  const merged = {
    redditoBancarioMensile:
      practiceIncome
        .redditoNettoMensile,

    fonteReddito:
      practiceIncome
        .fonteReddito,

    redditiPerRichiedente:
      practiceIncome
        .redditiPerRichiedente ||
      {},

    /*
     * dti rimane alias del DTI POST-operazione per retrocompatibilità.
     */
    dti:
      ratios.dtiPost,

    dtiPre:
      ratios.dtiPre,

    dtiPost:
      ratios.dtiPost,

    ltv:
      null,

    impegni,

    impegniFinanziariPre:
      impegni
        .impegniFinanziariPre,

    impegniFinanziariPost:
      impegni
        .impegniFinanziariPost,

    impegniNonFinanziari:
      impegni
        .impegniNonFinanziari,

    redditoResiduoPre:
      ratios
        .redditoResiduoPre,

    redditoResiduoPost:
      ratios
        .redditoResiduoPost,

    disponibilitaPostNuovaRata:
      ratios
        .disponibilitaPostNuovaRata,

    scoreIncome:
      practiceIncome
        .score,

    scoreBank:
      null,

    bankDataAvailable:
      false,

    criticitaFinanziarie: [
      ...(
        practiceIncome
          .criticita ||
        []
      ),
    ],

    puntiForzaFinanziari:
      [],

    alertBancari: {
      scommesse: [],
      contanti: [],
      rate: [],
      entrateStraordinarie: [],
      riscossione: [],
      crypto: [],
      accrediti: [],
      saldoNegativoOScoperti:
        false,
    },
  };

  const bankScores = [];

  for (
    const doc of
    documentAnalyses
  ) {
    const dec =
      doc
        .decisioneBackend ||
      {};

    if (
      dec
        .scoreComportamentoBancario !==
        undefined
      &&
      dec
        .scoreComportamentoBancario !==
        null
    ) {
      merged
        .bankDataAvailable =
        true;

      bankScores.push(
        dec
          .scoreComportamentoBancario
      );

      merged
        .alertBancari
        .scommesse
        .push(
          ...(
            dec
              .alertScommesse ||
            []
          )
        );

      merged
        .alertBancari
        .contanti
        .push(
          ...(
            dec
              .alertContanti ||
            []
          )
        );

      merged
        .alertBancari
        .rate
        .push(
          ...(
            dec
              .alertRateFinanziamenti ||
            []
          )
        );

      merged
        .alertBancari
        .entrateStraordinarie
        .push(
          ...(
            dec
              .alertEntrateStraordinarie ||
            []
          )
        );

      merged
        .alertBancari
        .riscossione
        .push(
          ...(
            dec
              .alertRiscossione ||
            []
          )
        );

      merged
        .alertBancari
        .crypto
        .push(
          ...(
            dec
              .alertCrypto ||
            []
          )
        );

      merged
        .alertBancari
        .accrediti
        .push(
          ...(
            dec
              .accreditiStipendioPensione ||
            []
          )
        );

      if (
        dec
          .saldoNegativoOScoperti
      ) {
        merged
          .alertBancari
          .saldoNegativoOScoperti =
          true;
      }
    }

    if (
      Array.isArray(
        dec
          .criticita
      )
    ) {
      merged
        .criticitaFinanziarie
        .push(
          ...dec
            .criticita
        );
    }

    if (
      Array.isArray(
        dec
          .puntiForza
      )
    ) {
      merged
        .puntiForzaFinanziari
        .push(
          ...dec
            .puntiForza
        );
    }
  }

  if (
    bankScores.length
  ) {
    const total =
      bankScores.reduce(
        (sum, value) =>
          sum
          +
          (
            normalizeNumber(
              value
            )
            ||
            0
          ),
        0
      );

    merged.scoreBank =
      round2(
        total /
        bankScores.length
      );
  }

  merged.ltv =
    calcolaLTV(
      importoMutuo,
      valoreImmobile
    );

  merged.criticitaFinanziarie =
    Array.from(
      new Set(
        merged
          .criticitaFinanziarie
          .filter(
            Boolean
          )
      )
    );

  merged.puntiForzaFinanziari =
    Array.from(
      new Set(
        merged
          .puntiForzaFinanziari
          .filter(
            Boolean
          )
      )
    );

  for (
    const key of [
      "scommesse",
      "contanti",
      "rate",
      "entrateStraordinarie",
      "riscossione",
      "crypto",
      "accrediti",
    ]
  ) {
    merged
      .alertBancari[key] =
      Array.from(
        new Set(
          merged
            .alertBancari[key]
            .filter(
              Boolean
            )
        )
      );
  }

  return merged;
}

/*
|--------------------------------------------------------------------------
| SUMMARY PRATICA
|--------------------------------------------------------------------------
*/

function buildPracticeSummary({
  snapshot,
  anomalies,
  mergedFinancials,
  reviewFlags,
  importoMutuo,
  valoreImmobile,
  rataMutuoStimata,
  finalitaMutuo,
}) {
  const severity =
    anomalies
      .hasBlocking
      ? "error"
      : reviewFlags
          .reviewManuale
      ? "warning"
      : "success";


  const esito =
    anomalies
      .hasBlocking
      ? "Pratica con anomalie bloccanti"
      : reviewFlags
          .reviewManuale
      ? "Pratica da revisionare"
      : "Pratica coerente";


  const soggettiLabel =
    (
      snapshot
        .soggetti
        ?.nominativi ||
      []
    ).join(", ") ||
    "N/D";


  const report = [
    "📁 DOSSIER PRATICA MUTUO",

    `Esito: ${esito}`,

    `Soggetti: ${soggettiLabel}`,

    snapshot
      .immobile
      ?.indirizzo
      ? `Immobile: ${snapshot.immobile.indirizzo}`
      : "Immobile: N/D",

    snapshot
      .operazione
      ?.prezzoCompravendita
      ? `Prezzo compravendita: ${snapshot.operazione.prezzoCompravendita}`
      : "Prezzo compravendita: N/D",

    importoMutuo !== null
      ? `Importo mutuo: € ${formatNumberIT(importoMutuo)}`
      : "Importo mutuo: N/D",

    valoreImmobile !== null
      ? `Valore immobile: € ${formatNumberIT(valoreImmobile)}`
      : "Valore immobile: N/D",

    mergedFinancials
      .redditoBancarioMensile !==
    null
      ? `Reddito mensile considerato: € ${formatNumberIT(
          mergedFinancials
            .redditoBancarioMensile
        )} (${mergedFinancials.fonteReddito})`
      : "Reddito mensile considerato: N/D",

    mergedFinancials
      .dtiPre !==
    null
      ? `DTI pre-operazione: ${formatNumberIT(mergedFinancials.dtiPre)}%`
      : "DTI pre-operazione: N/D",

    mergedFinancials
      .dtiPost !==
    null
      ? `DTI post-operazione: ${formatNumberIT(mergedFinancials.dtiPost)}%`
      : "DTI post-operazione: N/D",

    `Impegni finanziari pre-operazione: € ${formatNumberIT(
      mergedFinancials.impegniFinanziariPre || 0
    )}`,

    `Impegni finanziari post-operazione: € ${formatNumberIT(
      mergedFinancials.impegniFinanziariPost || 0
    )}`,

    `Impegni non finanziari: € ${formatNumberIT(
      mergedFinancials.impegniNonFinanziari || 0
    )}`,

    mergedFinancials
      .redditoResiduoPost !==
    null
      ? `Reddito residuo post-operazione: € ${formatNumberIT(mergedFinancials.redditoResiduoPost)}`
      : "Reddito residuo post-operazione: N/D",

    mergedFinancials
      .ltv !==
    null
      ? `LTV: ${formatNumberIT(mergedFinancials.ltv)}%`
      : "LTV: N/D",

    mergedFinancials
      .scoreIncome !==
    null
      ? `Score reddito: ${formatNumberIT(mergedFinancials.scoreIncome)}/100`
      : "Score reddito: N/D",

    mergedFinancials
      .scoreBank !==
    null
      ? `Score bancario: ${formatNumberIT(mergedFinancials.scoreBank)}/100`
      : "Score bancario: N/D (nessun estratto conto/lista movimenti analizzato)",

    mergedFinancials
      .bankDataAvailable
      ? `Movimenti gioco/scommesse rilevati: ${mergedFinancials.alertBancari.scommesse.length}`
      : "Movimenti gioco/scommesse rilevati: N/D",

    mergedFinancials
      .bankDataAvailable
      ? `Movimenti contanti/ATM da verificare: ${mergedFinancials.alertBancari.contanti.length}`
      : "Movimenti contanti/ATM da verificare: N/D",

    mergedFinancials
      .bankDataAvailable
      ? `Rate/finanziamenti rilevati su conto: ${mergedFinancials.alertBancari.rate.length}`
      : "Rate/finanziamenti rilevati su conto: N/D",

    mergedFinancials
      .bankDataAvailable
      ? `Saldo negativo/scoperti: ${
          mergedFinancials
            .alertBancari
            .saldoNegativoOScoperti
            ? "Sì"
            : "No"
        }`
      : "Saldo negativo/scoperti: N/D",

    anomalies
      .anomalieBloccanti
      .length
      ? `Anomalie bloccanti: ${anomalies.anomalieBloccanti.join(" | ")}`
      : "Anomalie bloccanti: nessuna",

    reviewFlags
      .motiviReview
      .length
      ? `Elementi da verificare: ${reviewFlags.motiviReview.join(" | ")}`
      : "Elementi da verificare: nessuno",
  ];


  return {
    esito,
    severity,

    riepilogo: {
      soggetti:
        snapshot
          .soggetti,

      immobile:
        snapshot
          .immobile,

      operazione: {
        ...snapshot
          .operazione,

        importoMutuo:
          importoMutuo ??
          null,

        valoreImmobile:
          valoreImmobile ??
          null,

        rataMutuoStimata:
          rataMutuoStimata ??
          null,

        finalitaMutuo:
          finalitaMutuo ??
          null,
      },

      reddito: {
        ...snapshot
          .reddito,

        redditoBancarioMensile:
          mergedFinancials
            .redditoBancarioMensile,

        fonteReddito:
          mergedFinancials
            .fonteReddito,

        redditiPerRichiedente:
          mergedFinancials
            .redditiPerRichiedente,

        dti:
          mergedFinancials
            .dtiPost,

        dtiPre:
          mergedFinancials
            .dtiPre,

        dtiPost:
          mergedFinancials
            .dtiPost,

        impegniFinanziariPre:
          mergedFinancials
            .impegniFinanziariPre,

        impegniFinanziariPost:
          mergedFinancials
            .impegniFinanziariPost,

        impegniNonFinanziari:
          mergedFinancials
            .impegniNonFinanziari,

        redditoResiduoPost:
          mergedFinancials
            .redditoResiduoPost,

        ltv:
          mergedFinancials
            .ltv,
      },

      banca: {
        ...snapshot
          .banca,

        score:
          mergedFinancials
            .scoreBank,

        disponibile:
          mergedFinancials
            .bankDataAvailable,

        alert:
          mergedFinancials
            .alertBancari,
      },

      esposizioni:
        snapshot
          .esposizioni,
    },

    anomalie:
      anomalies,

    review:
      reviewFlags,

    indicatori: {
      scoreIncome:
        mergedFinancials
          .scoreIncome,

      scoreBank:
        mergedFinancials
          .scoreBank,

      criticitaFinanziarie:
        mergedFinancials
          .criticitaFinanziarie,

      puntiForzaFinanziari:
        mergedFinancials
          .puntiForzaFinanziari,
    },

    reportTestuale:
      report.join("\n"),
  };
}


/*
|--------------------------------------------------------------------------
|--------------------------------------------------------------------------
| CLOUD FUNCTION
| ANALIZZA DOCUMENTO AI
|--------------------------------------------------------------------------
|--------------------------------------------------------------------------
*/

exports.deletePracticeDocument =
  deletePracticeDocument;




exports.bootstrapFirstAdmin =
  bootstrapFirstAdmin;

exports.ensureConsultantProfile =
  ensureConsultantProfile;

exports.createConsultant =
  createConsultant;

exports.updateConsultantVisibility =
  updateConsultantVisibility;

exports.updateConsultantPermissions =
  updateConsultantPermissions;

exports.analizzaDocumentoAI =
  onCall(
    {
      secrets: [
        "OPENAI_API_KEY",
      ],
    },

    async (request) => {
      const data =
        request.data || {};


      const {
        idCliente,

        tipoDocumentoAtteso,

        codiceDocumento = null,

        urlFileBase64,

        urlFileBase64Front,

        urlFileBase64Back,

        importoMutuo = null,

        valoreImmobile = null,

        rataMutuoStimata = null,

        rateAltriFinanziamenti =
          null,

        durataAnni = null,

        prodottoBancario = null,

        finalitaMutuo = null,

        notePratica = null,
      } = data;


      /*
      |--------------------------------------------------------------------------
      | VALIDAZIONE PARAMETRI
      |--------------------------------------------------------------------------
      */

      if (!idCliente) {
        throw new HttpsError(
          "invalid-argument",
          "ID cliente mancante."
        );
      }


      if (!tipoDocumentoAtteso) {
        throw new HttpsError(
          "invalid-argument",
          "Tipo documento atteso mancante."
        );
      }


      const codiceDocumentoNormalizzato =
        normalizeIncomingDocumentCode({
          codiceDocumento,
          tipoDocumentoAtteso,
        });

      const codiceBase =
        stripNumericSuffix(
          codiceDocumentoNormalizzato
        );

      console.log("AI document routing", {
        tipoDocumentoAtteso,
        codiceDocumento,
        codiceDocumentoNormalizzato,
        codiceBase,
        gruppo: DOC_GROUPS.income.includes(codiceBase)
          ? "income"
          : DOC_GROUPS.bank.includes(codiceBase)
          ? "bank"
          : DOC_GROUPS.identity.includes(codiceBase)
          ? "identity"
          : DOC_GROUPS.realEstate.includes(codiceBase)
          ? "realEstate"
          : "generic",
      });


      /*
      |--------------------------------------------------------------------------
      | FILE
      |--------------------------------------------------------------------------
      */

      const files = [];


      if (urlFileBase64Front) {
        files.push({
          side: "front",
          base64:
            urlFileBase64Front,
        });
      }


      if (urlFileBase64Back) {
        files.push({
          side: "back",
          base64:
            urlFileBase64Back,
        });
      }


      if (
        urlFileBase64 &&
        files.length === 0
      ) {
        files.push({
          side: "single",
          base64:
            urlFileBase64,
        });
      }


      /*
      |--------------------------------------------------------------------------
      | PRECHECK TECNICO
      |--------------------------------------------------------------------------
      |
      | Questo resta bloccante.
      |
      | Se il file è realmente corrotto / vuoto / tecnicamente inutilizzabile
      | non ha senso farlo passare.
      |
      */

      const precheck =
        technicalPrecheck({
          files,

          tipoDocumentoAtteso:
            codiceBase,
        });


      if (!precheck.ok) {
        const motivoPrecheck =
          precheck.motivo ||
          "Il file non può essere elaborato.";

        return buildBaseResponse({
          ok: false,

          stato:
            "precheck_failed",

          tipoDocumentoAtteso:
            codiceBase,

          valido: false,

          motivo_errore:
            motivoPrecheck,

          spiegazione_rifiuto:
            motivoPrecheck,

          decisionCode:
            "PRECHECK_FAILED",

          pipelineVersion:
            POLICY.pipelineVersion,

          ui: buildUiResult({
            severity: "error",

            titolo:
              "File non valido",

            messaggio:
              motivoPrecheck,

            badge: [
              "Precheck KO",
            ],
          }),
        });
      }


      /*
      |--------------------------------------------------------------------------
      | VARIABILI PIPELINE
      |--------------------------------------------------------------------------
      */

      let preparedFiles = [];

      let classificazione =
        null;

      let retryClassificazione =
        null;

      let estrazione =
        null;

      let decisioneBackend =
        null;

      let practiceSnapshot =
        null;

      let practiceAnomalies =
        null;

      let review = {
        reviewManuale: false,
        motiviReview: [],
      };

      let analysisKey = "";

      let valutazioneClassificazione =
        {
          hardReject: false,
          manualReview: false,
          motivo: "",
        };


      try {
        /*
        |--------------------------------------------------------------------------
        | PREPARAZIONE CONTENUTI
        |--------------------------------------------------------------------------
        */

        preparedFiles =
          await uploadAndPrepareContents(
            files
          );


        /*
        |--------------------------------------------------------------------------
        | CHIAVE ANALISI
        |--------------------------------------------------------------------------
        */

        analysisKey =
          computeAnalysisKey({
            idCliente,

            codiceBase,

            files:
              preparedFiles,
          });


        /*
        |--------------------------------------------------------------------------
        | CACHE
        |--------------------------------------------------------------------------
        */

        if (
          POLICY.enableIdempotencyCache
        ) {
          const summary =
            await getSummaryDoc(
              idCliente
            );


          if (
            summary?.analysisKey ===
              analysisKey &&
            summary
              ?.analysisResultCached
          ) {
            return summary
              .analysisResultCached;
          }
        }


        /*
        |--------------------------------------------------------------------------
        | PRIMA CLASSIFICAZIONE
        |--------------------------------------------------------------------------
        */

        classificazione =
          await classifyDocument({
            tipoDocumentoAtteso:
              codiceBase,

            preparedFiles,
          });


        /*
        |--------------------------------------------------------------------------
        | NORMALIZZAZIONE CONFIDENZA
        |--------------------------------------------------------------------------
        */

        classificazione = {
          ...classificazione,

          confidenza_classificazione:
            normalizeConfidence(
              classificazione
                ?.confidenza_classificazione
            ),
        };


        /*
        |--------------------------------------------------------------------------
        | RETRY
        |--------------------------------------------------------------------------
        |
        | Facciamo un secondo tentativo se:
        |
        | - tipo non determinabile
        | - confidenza inferiore alla soglia configurata
        | - classificatore originale dice non valido
        |
        */

        const tipoRilevato =
          normalizeString(
            classificazione
              ?.tipo_documento_rilevato
          );


        const needsRetry =
          tipoRilevato ===
            "non_determinabile" ||
          classificazione
            .confidenza_classificazione <
            POLICY
              .classificationConfidenceReject ||
          classificazione.valido ===
            false;


        if (needsRetry) {
          retryClassificazione =
            await retryClassification({
              tipoDocumentoAtteso:
                codiceBase,

              preparedFiles,
            });


          if (
            retryClassificazione
          ) {
            retryClassificazione = {
              ...retryClassificazione,

              confidenza_classificazione:
                normalizeConfidence(
                  retryClassificazione
                    ?.confidenza_classificazione
                ),
            };


            if (
              retryClassificazione
                .confidenza_classificazione >
              classificazione
                .confidenza_classificazione
            ) {
              classificazione = {
                ...classificazione,

                tipo_documento_rilevato:
                  retryClassificazione
                    .tipo_documento_rilevato,

                coerenza_documentale:
                  retryClassificazione
                    .coerenza_documentale,

                gravemente_illeggibile:
                  retryClassificazione
                    .gravemente_illeggibile,

                confidenza_classificazione:
                  retryClassificazione
                    .confidenza_classificazione,

                motivo_errore:
                  retryClassificazione
                    .motivo_errore ||
                  classificazione
                    .motivo_errore,

                valido:
                  retryClassificazione
                    .coerenza_documentale &&
                  !retryClassificazione
                    .gravemente_illeggibile,
              };
            }
          }
        }


        /*
        |--------------------------------------------------------------------------
        | NUOVA VALUTAZIONE PERMISSIVA
        |--------------------------------------------------------------------------
        */

        valutazioneClassificazione =
          valutaClassificazionePermissiva(
            classificazione,
            codiceBase
          );


        console.log(
          "========================================"
        );

        console.log(
          "VALUTAZIONE AI PERMISSIVA"
        );

        console.log({
          cliente:
            idCliente,

          documentoAtteso:
            codiceBase,

          documentoRilevato:
            classificazione
              ?.tipo_documento_rilevato,

          confidenza:
            classificazione
              ?.confidenza_classificazione,

          confidenzaPercentuale:
            percentConfidence(
              classificazione
                ?.confidenza_classificazione
            ),

          coerenza:
            classificazione
              ?.coerenza_documentale,

          gravementeIlleggibile:
            classificazione
              ?.gravemente_illeggibile,

          validoOriginale:
            classificazione
              ?.valido,

          hardReject:
            valutazioneClassificazione
              .hardReject,

          reviewManuale:
            valutazioneClassificazione
              .manualReview,

          motivo:
            valutazioneClassificazione
              .motivo,
        });

        console.log(
          "========================================"
        );


        /*
        |--------------------------------------------------------------------------
        | HARD REJECT
        |--------------------------------------------------------------------------
        |
        | Arriviamo qui SOLO se:
        |
        | - documento chiaramente diverso >= 98%
        |
        | oppure
        |
        | - documento gravemente illeggibile >= 97%
        |
        */

        if (
          valutazioneClassificazione
            .hardReject
        ) {
          const stato =
            "classified_rejected";


          /*
           * Motivo leggibile dal cliente
           */
          const motivoRifiuto =
            valutazioneClassificazione
              .motivo ||
            "Il documento caricato non corrisponde a quello richiesto.";


          /*
           * Inseriamo il motivo anche dentro classificazione.
           * In questo modo il tuo frontend può leggerlo sia da:
           *
           * risposta.motivo_errore
           *
           * sia da:
           *
           * risposta.classificazione.motivo_errore
           */
          classificazione = {
            ...classificazione,

            motivo_errore:
              motivoRifiuto,

            spiegazione_rifiuto:
              motivoRifiuto,
          };


          const decisionCode =
            getDecisionCode({
              stato,

              codiceBase,

              reviewManuale:
                false,

              classificazione,
            });


          const result =
            buildBaseResponse({
              ok: true,

              stato,

              tipoDocumentoAtteso:
                codiceBase,

              tipoDocumentoRilevato:
                classificazione
                  ?.tipo_documento_rilevato ||
                null,

              confidence:
                classificazione
                  ?.confidenza_classificazione ||
                0,

              valido: false,

              /*
               * IMPORTANTISSIMO:
               * questi campi arrivano direttamente
               * al tuo upload.html.
               */
              motivo_errore:
                motivoRifiuto,

              spiegazione_rifiuto:
                motivoRifiuto,

              decisionCode,

              analysisKey,

              pipelineVersion:
                POLICY.pipelineVersion,

              classificazione,

              ui: buildUiResult({
                severity:
                  "error",

                titolo:
                  "Documento non accettato",

                messaggio:
                  motivoRifiuto,

                badge: [
                  "Documento KO",

                  `${percentConfidence(
                    classificazione
                      ?.confidenza_classificazione
                  )}%`,
                ],
              }),
            });


          /*
          |--------------------------------------------------------------------------
          | SALVATAGGIO SUMMARY
          |--------------------------------------------------------------------------
          */

          await saveSummaryDoc({
            idCliente,

            pipelineVersion:
              POLICY.pipelineVersion,

            analysisKey,

            tipoDocumentoAtteso:
              codiceBase,

            classificazione,

            estrazione: null,

            decisioneBackend:
              null,

            review: {
              reviewManuale:
                false,

              motiviReview:
                [],
            },

            ui:
              result.ui,

            preparedFiles,

            decisionCode,

            resultCached:
              result,
          });


          /*
          |--------------------------------------------------------------------------
          | AUDIT
          |--------------------------------------------------------------------------
          */

          await saveAuditEntry({
            idCliente,

            pipelineVersion:
              POLICY.pipelineVersion,

            analysisKey,

            tipoDocumentoAtteso:
              codiceBase,

            precheck,

            classificazione,

            retryClassificazione,

            estrazione: null,

            decisioneBackend:
              null,

            review: {
              reviewManuale:
                false,

              motiviReview:
                [],
            },

            preparedFiles,

            decisionCode,
          });


          return result;
        }


        /*
        |--------------------------------------------------------------------------
        | DOCUMENTO DUBBIO
        |--------------------------------------------------------------------------
        |
        | NON LO RIFIUTIAMO.
        |
        | Forziamo valido = true per permettere alla pipeline di continuare.
        |
        */

        if (
          valutazioneClassificazione
            .manualReview
        ) {
          classificazione = {
            ...classificazione,

            valido: true,

            /*
             * Conserviamo comunque il fatto
             * che l'AI aveva dei dubbi.
             */
            classificazione_originalmente_incerta:
              true,

            motivo_review:
              valutazioneClassificazione
                .motivo,
          };
        }


        /*
        |--------------------------------------------------------------------------
        | CONTESTO PRATICA
        |--------------------------------------------------------------------------
        */

        const practiceContext =
          buildPracticeContext({
            importoMutuo,

            valoreImmobile,

            rataMutuoStimata,

            rateAltriFinanziamenti,

            durataAnni,

            prodottoBancario,

            finalitaMutuo,

            notePratica,
          });


        /*
        |--------------------------------------------------------------------------
        | ESTRAZIONE IN BASE AL GRUPPO DOCUMENTALE
        |--------------------------------------------------------------------------
        */

        if (
          DOC_GROUPS.identity.includes(
            codiceBase
          )
        ) {
          estrazione =
            await extractIdentity({
              tipoDocumentoAtteso:
                codiceBase,

              preparedFiles,
            });
        }

        else if (
          DOC_GROUPS.income.includes(
            codiceBase
          )
        ) {
          estrazione =
            await extractIncome({
              tipoDocumentoAtteso:
                codiceBase,

              preparedFiles,

              practiceContext,
            });


          decisioneBackend =
            scoreIncomeDecision({
              estrazione,

              data: {
                importoMutuo,

                valoreImmobile,

                rataMutuoStimata,

                rateAltriFinanziamenti,
              },
            });
        }

        else if (
          DOC_GROUPS.bank.includes(
            codiceBase
          )
        ) {
          estrazione =
            await extractBank({
              tipoDocumentoAtteso:
                codiceBase,

              preparedFiles,

              practiceContext,
            });


          decisioneBackend =
            scoreBankDecision({
              estrazione,
            });
        }

        else if (
          DOC_GROUPS.realEstate.includes(
            codiceBase
          )
        ) {
          estrazione =
            await extractRealEstate({
              tipoDocumentoAtteso:
                codiceBase,

              preparedFiles,

              practiceContext,
            });
        }

        else {
          estrazione =
            await extractGeneric({
              tipoDocumentoAtteso:
                codiceBase,

              preparedFiles,
            });
        }


        /*
        |--------------------------------------------------------------------------
        | SNAPSHOT
        |--------------------------------------------------------------------------
        */

        practiceSnapshot =
          buildPracticeSnapshot([
            {
              tipoDocumento:
                codiceBase,

              classificazione,

              estrazione,
            },
          ]);


        /*
        |--------------------------------------------------------------------------
        | ANOMALIE
        |--------------------------------------------------------------------------
        */

        practiceAnomalies =
          detectPracticeAnomalies(
            practiceSnapshot
          );


        /*
        |--------------------------------------------------------------------------
        | REVIEW POLICY STANDARD
        |--------------------------------------------------------------------------
        */

        review =
          reviewPolicy({
            classificazione,

            estrazione,

            tipoDocumentoAtteso:
              codiceBase,

            practiceAnomalies,
          });


        /*
        |--------------------------------------------------------------------------
        | FORZIAMO REVIEW SE CLASSIFICAZIONE DUBBIA
        |--------------------------------------------------------------------------
        */

        if (
          valutazioneClassificazione
            .manualReview
        ) {
          review.reviewManuale =
            true;


          review.motiviReview =
            Array.from(
              new Set([
                ...(
                  review.motiviReview ||
                  []
                ),

                valutazioneClassificazione
                  .motivo ||
                  "Classificazione AI da verificare manualmente.",
              ])
            );
        }


        /*
        |--------------------------------------------------------------------------
        | STATO
        |--------------------------------------------------------------------------
        */

        const stato =
          review.reviewManuale
            ? "manual_review"
            : "completed";


        /*
        |--------------------------------------------------------------------------
        | DECISION CODE
        |--------------------------------------------------------------------------
        */

        const decisionCode =
          getDecisionCode({
            stato,

            codiceBase,

            reviewManuale:
              review.reviewManuale,

            classificazione,

            decisioneBackend,

            practiceAnomalies,
          });


        /*
        |--------------------------------------------------------------------------
        | MESSAGGIO UI
        |--------------------------------------------------------------------------
        */

        let uiTitolo;

        let uiMessaggio;

        let uiSeverity;


        if (
          review.reviewManuale
        ) {
          uiTitolo =
            "Documento acquisito - verifica consigliata";

          uiMessaggio =
            valutazioneClassificazione
              .motivo ||
            "Il documento è stato acquisito, ma alcuni elementi richiedono una verifica manuale.";

          uiSeverity =
            "warning";
        }

        else {
          uiTitolo =
            "Documento valido";

          uiMessaggio =
            "Documento coerente, leggibile e analizzato correttamente.";

          uiSeverity =
            "success";
        }


        /*
        |--------------------------------------------------------------------------
        | RISULTATO
        |--------------------------------------------------------------------------
        */

        const result =
          buildBaseResponse({
            ok: true,

            stato,

            tipoDocumentoAtteso:
              codiceBase,

            tipoDocumentoRilevato:
              classificazione
                ?.tipo_documento_rilevato,

            confidence:
              classificazione
                ?.confidenza_classificazione,

            /*
             * Anche in review manuale il documento
             * è valido per il caricamento.
             */
            valido: true,

            reviewManuale:
              review.reviewManuale,

            motiviReview:
              review.motiviReview,

            /*
             * Motivo mostrabile anche dal frontend
             * se vuoi visualizzare un warning.
             */
            motivo_review:
              review.reviewManuale
                ? review.motiviReview.join(
                    " "
                  )
                : "",

            decisionCode,

            analysisKey,

            pipelineVersion:
              POLICY.pipelineVersion,

            classificazione,

            estrazione,

            decisioneBackend: {
              ...decisioneBackend,

              /*
               * Conserviamo anche il codice originale,
               * ad esempio doc_cud1/doc_cud2.
               */
              _tipoDocumentoOriginale:
                codiceDocumentoNormalizzato,

              practiceSnapshot,

              practiceAnomalies,
            },

            ui: buildUiResult({
              severity:
                uiSeverity,

              titolo:
                uiTitolo,

              messaggio:
                uiMessaggio,

              badge: [
                codiceBase,

                classificazione
                  .leggibile_umano
                  ? "Leggibile"
                  : "Da verificare",

                review.reviewManuale
                  ? "Review"
                  : "OK",

                `${percentConfidence(
                  classificazione
                    ?.confidenza_classificazione
                )}%`,
              ],
            }),
          });


        /*
        |--------------------------------------------------------------------------
        | SALVATAGGIO SUMMARY
        |--------------------------------------------------------------------------
        */

        await saveSummaryDoc({
          idCliente,

          pipelineVersion:
            POLICY.pipelineVersion,

          analysisKey,

          tipoDocumentoAtteso:
            codiceBase,

          classificazione,

          estrazione,

          decisioneBackend:
            result.decisioneBackend,

          review,

          ui:
            result.ui,

          preparedFiles,

          decisionCode,

          resultCached:
            result,

          practiceSnapshot,

          practiceAnomalies,
        });


        /*
        |--------------------------------------------------------------------------
        | AUDIT
        |--------------------------------------------------------------------------
        */

        await saveAuditEntry({
          idCliente,

          pipelineVersion:
            POLICY.pipelineVersion,

          analysisKey,

          tipoDocumentoAtteso:
            codiceBase,

          precheck,

          classificazione,

          retryClassificazione,

          estrazione,

          decisioneBackend:
            result.decisioneBackend,

          review,

          preparedFiles,

          decisionCode,

          practiceSnapshot,

          practiceAnomalies,
        });


        /*
        |--------------------------------------------------------------------------
        | MANUAL REVIEW
        |--------------------------------------------------------------------------
        */

        if (
          review.reviewManuale
        ) {
          await upsertManualReview({
            idCliente,

            tipoDocumentoAtteso:
              codiceBase,

            analysisKey,

            classificazione,

            estrazione,

            motiviReview:
              review.motiviReview,

            decisionCode,
          });
        }


        return result;
      }

      catch (error) {
        console.error(
          "ERRORE analizzaDocumentoAI:",
          error
        );

        throw new HttpsError(
          "internal",

          error?.message ||
            "Errore del server AI."
        );
      }
    }
  );


/*
|--------------------------------------------------------------------------
|--------------------------------------------------------------------------
| RICOSTRUZIONE PRATICA COMPLETA
|--------------------------------------------------------------------------
|--------------------------------------------------------------------------
*/

exports.ricostruisciPraticaCompleta =
  onCall(
    {
      secrets: [
        "OPENAI_API_KEY",
      ],
    },

    async (request) => {
      if (!request.auth?.uid) {
        throw new HttpsError(
          "unauthenticated",
          "Accesso richiesto per la pre-delibera completa."
        );
      }

      const data =
        request.data || {};


      const {
        idCliente,

        importoMutuo = null,

        valoreImmobile = null,

        rataMutuoStimata =
          null,

        rateAltriFinanziamenti =
          null,

        finalitaMutuo = null,
      } = data;


      if (!idCliente) {
        throw new HttpsError(
          "invalid-argument",

          "ID cliente mancante."
        );
      }


      try {
        /*
        |--------------------------------------------------------------------------
        | SCHEDA CONSULENZA / DATI PRATICA
        |--------------------------------------------------------------------------
        */

        const practiceDocSnap =
          await adminDb
            .collection("pratiche_mutuo")
            .doc(idCliente)
            .get();

        const practiceData =
          practiceDocSnap.exists
            ? (
                practiceDocSnap.data() ||
                {}
              )
            : {};


        const resolvedImportoMutuo =
          normalizeNumber(
            importoMutuo ??
            practiceData.importo_richiesto ??
            practiceData.mutuo_importo
          );

        const resolvedValoreImmobile =
          normalizeNumber(
            valoreImmobile ??
            practiceData.valore_immobile ??
            practiceData.immobile_valore
          );

        const resolvedRataMutuoStimata =
          normalizeNumber(
            rataMutuoStimata ??
            practiceData.rata_mutuo_stimata ??
            practiceData.rata_stimata ??
            practiceData.mutuo_rata ??
            practiceData.rata_nuovo_mutuo
          );

        const resolvedRateAltriFinanziamenti =
          normalizeNumber(
            rateAltriFinanziamenti ??
            practiceData.totale_rate_finanziamenti ??
            practiceData.rata_fin_pre
          );

        const resolvedFinalitaMutuo =
          finalitaMutuo ??
          practiceData.finalita ??
          practiceData.mutuo_finalita ??
          null;


        /*
        |--------------------------------------------------------------------------
        | DOCUMENTI ANALIZZATI
        |--------------------------------------------------------------------------
        */

        const documentAnalyses =
          await loadClientDocumentAnalyses(
            idCliente
          );

        /* Anche senza documenti continuiamo con i dati della scheda, marcandoli come non verificati. */
/*
        |--------------------------------------------------------------------------
        | SNAPSHOT
        |--------------------------------------------------------------------------
        */

        const snapshot =
          buildPracticeSnapshot(
            documentAnalyses,
            practiceData
          );


        /*
        |--------------------------------------------------------------------------
        | ANOMALIE
        |--------------------------------------------------------------------------
        */

        const anomalies =
          detectPracticeAnomalies(
            snapshot
          );


        /*
        |--------------------------------------------------------------------------
        | DATI FINANZIARI
        |--------------------------------------------------------------------------
        */

        const mergedFinancials =
          mergePracticeFinancials({
            documentAnalyses,
            practiceData,

            importoMutuo:
              resolvedImportoMutuo,

            valoreImmobile:
              resolvedValoreImmobile,

            rataMutuoStimata:
              resolvedRataMutuoStimata,

            rateAltriFinanziamenti:
              resolvedRateAltriFinanziamenti,
          });


        /*
        |--------------------------------------------------------------------------
        | REVIEW FLAGS
        |--------------------------------------------------------------------------
        */

        const extraReviewReasons =
          [];

        if (
          mergedFinancials
            .fonteReddito ===
          "parzialmente_o_totalmente_non_verificato"
        ) {
          extraReviewReasons.push(
            "Reddito utilizzato dalla scheda consulenza: da verificare con documentazione reddituale"
          );
        }

        if (
          !mergedFinancials
            .bankDataAvailable
        ) {
          extraReviewReasons.push(
            "Analisi bancaria non disponibile: nessun estratto conto/lista movimenti elaborato"
          );
        }


        const reviewFlags = {
          reviewManuale:
            anomalies
              .hasBlocking ||

            anomalies
              .anomalieWarning
              .length >
              0 ||

            documentAnalyses
              .some(
                (d) =>
                  d
                    .review
                    ?.reviewManuale ===
                  true
              ) ||

            extraReviewReasons
              .length >
              0,

          motiviReview:
            Array.from(
              new Set([
                ...anomalies
                  .anomalieBloccanti,

                ...anomalies
                  .anomalieWarning,

                ...documentAnalyses
                  .flatMap(
                    (d) =>
                      d
                        .review
                        ?.motiviReview ||
                      []
                  ),

                ...mergedFinancials
                  .criticitaFinanziarie,

                ...extraReviewReasons,
              ])
            ),
        };


        /*
        |--------------------------------------------------------------------------
        | SUMMARY
        |--------------------------------------------------------------------------
        */

        const practiceSummary =
          buildPracticeSummary({
            snapshot,

            anomalies,

            mergedFinancials,

            reviewFlags,

            importoMutuo:
              resolvedImportoMutuo,

            valoreImmobile:
              resolvedValoreImmobile,

            rataMutuoStimata:
              resolvedRataMutuoStimata,

            finalitaMutuo:
              resolvedFinalitaMutuo,
          });


        /*
        |--------------------------------------------------------------------------
        | BANK MATCHING
        |--------------------------------------------------------------------------
        */

        const bankMatch =
          await matchBanksForPractice({
            practiceSummary,

            documentAnalyses,

            anomalies,

            mergedFinancials,

            finalitaMutuo:
              resolvedFinalitaMutuo,
          });


        /*
        |--------------------------------------------------------------------------
        | DECISION CODE
        |--------------------------------------------------------------------------
        */

        const finalDecisionCode =
          anomalies.hasBlocking
            ? "PRACTICE_BLOCKING_ANOMALY"

            : reviewFlags
                .reviewManuale
            ? "PRACTICE_REVIEW"

            : "PRACTICE_OK";


        /*
        |--------------------------------------------------------------------------
        | PAYLOAD
        |--------------------------------------------------------------------------
        */

        const payload = {
          aggiornatoIl:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          pipelineVersion:
            POLICY.pipelineVersion,

          praticaCompleta: {
            decisionCode:
              finalDecisionCode,


            documentiConsiderati:
              documentAnalyses.map(
                (d) => ({
                  tipoDocumento:
                    d.tipoDocumento,

                  decisionCode:
                    d.decisionCode ||
                    "",

                  reviewManuale:
                    d.review
                      ?.reviewManuale ===
                    true,

                  motiviReview:
                    d.review
                      ?.motiviReview ||
                    [],
                })
              ),


            snapshot,

            anomalies,

            mergedFinancials,

            reviewFlags,

            practiceSummary,

            bankMatch,
          },
        };


        /*
        |--------------------------------------------------------------------------
        | FIRESTORE
        |--------------------------------------------------------------------------
        */

        await adminDb
          .collection(
            "analisi_deliberante"
          )
          .doc(idCliente)
          .set(
            payload,
            {
              merge: true,
            }
          );


        /*
        |--------------------------------------------------------------------------
        | REVIEW PRATICA
        |--------------------------------------------------------------------------
        */

        if (
          reviewFlags.reviewManuale
        ) {
          await adminDb
            .collection(
              "manual_reviews"
            )
            .doc(
              `practice_${idCliente}`
            )
            .set(
              {
                createdAt:
                  admin.firestore
                    .FieldValue
                    .serverTimestamp(),

                status:
                  "pending",

                idCliente,

                scope:
                  "practice",

                decisionCode:
                  finalDecisionCode,

                motiviReview:
                  reviewFlags
                    .motiviReview,

                snapshot,

                anomalies,
              },

              {
                merge: true,
              }
            );
        }


        /*
        |--------------------------------------------------------------------------
        | RISPOSTA
        |--------------------------------------------------------------------------
        */

        return {
          ok: true,

          stato:
            anomalies.hasBlocking
              ? "practice_blocking_anomaly"

              : reviewFlags
                  .reviewManuale
              ? "practice_review"

              : "practice_ok",

          decisionCode:
            finalDecisionCode,

          pratica:
            practiceSummary,

          bancheConsigliate:
            bankMatch?.consigliate ||
            [],

          bancheAlternative:
            bankMatch?.alternative ||
            [],
        };
      }

      catch (error) {
        console.error(
          "ERRORE ricostruisciPraticaCompleta:",
          error
        );


        throw new HttpsError(
          "internal",

          error?.message ||
            "Errore nella ricostruzione pratica."
        );
      }
    }
  );


/*
|--------------------------------------------------------------------------
|--------------------------------------------------------------------------
| IMPORTAZIONE POLICY BANCARIE
|--------------------------------------------------------------------------
|--------------------------------------------------------------------------
*/

const {
  importaPolicyBancarieDaFileVersionata,
} = require("./policyImporter");


exports.importaPolicyBancarieDaFileVersionata =
  importaPolicyBancarieDaFileVersionata;

/*
|--------------------------------------------------------------------------
|--------------------------------------------------------------------------
| REMINDER AUTOMATICI PRATICA / DOCUMENTAZIONE
|--------------------------------------------------------------------------
|--------------------------------------------------------------------------
|
| Gestisce:
|
| - reminder documentazione ogni 48 ore;
| - reminder anche con documentazione parzialmente caricata;
| - stop automatico quando la documentazione è completa;
| - pausa dei reminder documentali con pratica "Sospesa";
| - ripresa automatica quando la pratica esce da "Sospesa";
| - escalation dopo 7 giorni se la documentazione è ancora incompleta;
| - reminder interni per consulente e Backoffice;
| - reminder con data personalizzata per "Sospesa" / "Attesa documenti".
|
*/

const {
  controllaReminderDocumenti,
} = require("./document-reminders");


exports.controllaReminderDocumenti =
  controllaReminderDocumenti;

