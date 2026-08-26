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
  scoreIncomeDecision,
  scoreBankDecision,
  reviewPolicy,
  getDecisionCode,
} = require("./services/decisionEngine");

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

const {
  calcolaRedditoBancarioMensilePrudenziale,
  calcolaDTI,
  calcolaLTV,
  formatNumberIT,
} = require("./utils/mathHelpers");


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


function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function toNumberSafe(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let s = String(value).trim().replace(/€/g, "").replace(/\s/g, "");
  if (!s) return null;

  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractionData(doc) {
  const root = doc?.estrazione || {};
  const nested = root?.dati_estratti || {};
  return { ...root, ...nested };
}

function documentSubjectIndex(tipoDocumento = "") {
  const m = String(tipoDocumento).match(/(?:_|)(1|2)$/);
  return m ? Number(m[1]) : null;
}

function isIncomeDocument(tipoDocumento = "") {
  const base = stripNumericSuffix(String(tipoDocumento || "").replace(/^doc_/, ""));
  return ["cud", "cu", "unici", "unico", "bustepaga", "busta_paga", "redditi"].includes(base);
}

function isBankDocument(tipoDocumento = "") {
  const base = stripNumericSuffix(String(tipoDocumento || "").replace(/^doc_/, ""));
  return ["ec", "mov", "estrattoconto", "estratto_conto", "movimenti"].includes(base);
}

function normalizeEvidenceItem(item) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  return [
    item.data,
    item.controparte,
    item.ordinante,
    item.descrizione,
    item.causale,
    item.importo,
    item.frequenza,
    item.note,
  ].filter(Boolean).join(" - ");
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

  /*
   * Manteniamo separati R1/R2 e documenti differenti.
   * In passato il suffisso numerico veniva perso e, ad esempio,
   * doc_cud1 e doc_cud2 finivano nella stessa chiave: l'ultimo sovrascriveva l'altro.
   */
  const latestByDocumentKey = new Map();

  auditSnap.forEach((doc) => {
    const data = doc.data() || {};

    const tipoDocumento =
      data.codiceDocumento ||
      data.tipoDocumentoAtteso ||
      "";

    const createdAt =
      data.createdAt?.toMillis?.() || 0;

    if (!tipoDocumento) return;

    const key = String(tipoDocumento).trim().toLowerCase();
    const current = latestByDocumentKey.get(key);

    if (!current || createdAt > current.createdAt) {
      latestByDocumentKey.set(key, {
        createdAt,
        tipoDocumento,
        tipoDocumentoBase: stripNumericSuffix(tipoDocumento),
        classificazione: data.classificazione || null,
        estrazione: data.estrazione || null,
        decisioneBackend: data.decisioneBackend || null,
        review: data.review || null,
        decisionCode: data.decisionCode || "",
      });
    }
  });

  return Array.from(latestByDocumentKey.values());
}


/*
|--------------------------------------------------------------------------
| MERGE DATI FINANZIARI
|--------------------------------------------------------------------------
*/

function mergePracticeFinancials({
  documentAnalyses,
  practiceData = {},
  importoMutuo,
  valoreImmobile,
  rataMutuoStimata,
  rateAltriFinanziamenti,
}) {
  const merged = {
    redditoBancarioMensile: null,
    redditoFonte: "",
    dti: null,
    ltv: null,
    scoreIncome: null,
    scoreBank: null,
    criticitaFinanziarie: [],
    puntiForzaFinanziari: [],
    evidenzeBancarie: {
      gambling: [],
      contanti: [],
      rateRilevate: [],
      stipendi: [],
      movimentiRicorrenti: [],
      saldoNegativoOScoperti: false,
    },
  };

  const incomeBySubject = new Map();
  const incomeWithoutSubject = [];
  const incomeScores = [];
  const bankScores = [];

  for (const doc of documentAnalyses) {
    const dec = doc.decisioneBackend || {};
    const e = extractionData(doc);
    const tipo = doc.tipoDocumento || "";

    if (isIncomeDocument(tipo)) {
      const subject = documentSubjectIndex(tipo);
      const candidate = toNumberSafe(dec.redditoBancarioMensile);

      if (candidate !== null && candidate > 0) {
        if (subject) {
          const arr = incomeBySubject.get(subject) || [];
          arr.push(candidate);
          incomeBySubject.set(subject, arr);
        } else {
          incomeWithoutSubject.push(candidate);
        }
      }

      const score = toNumberSafe(dec.score);
      if (score !== null) incomeScores.push(score);
    }

    const bankScore = toNumberSafe(dec.scoreComportamentoBancario);
    if (bankScore !== null) bankScores.push(bankScore);

    if (Array.isArray(dec.criticita)) merged.criticitaFinanziarie.push(...dec.criticita);
    if (Array.isArray(dec.puntiForza)) merged.puntiForzaFinanziari.push(...dec.puntiForza);

    if (isBankDocument(tipo) || Array.isArray(e.movimenti_gambling_rilevati) || Array.isArray(e.stipendi_rilevati)) {
      if (Array.isArray(e.movimenti_gambling_rilevati)) {
        merged.evidenzeBancarie.gambling.push(...e.movimenti_gambling_rilevati);
      }

      if (Array.isArray(e.rate_rilevate)) {
        merged.evidenzeBancarie.rateRilevate.push(...e.rate_rilevate);
      }

      if (Array.isArray(e.stipendi_rilevati)) {
        merged.evidenzeBancarie.stipendi.push(...e.stipendi_rilevati);
      }

      if (Array.isArray(e.movimenti_ricorrenti)) {
        merged.evidenzeBancarie.movimentiRicorrenti.push(...e.movimenti_ricorrenti);

        for (const item of e.movimenti_ricorrenti) {
          const txt = normalizeEvidenceItem(item).toLowerCase();
          if (/versamento contanti|versamento di contanti|prelievo contanti|prelievo atm|prelievo bancomat|cash/.test(txt)) {
            merged.evidenzeBancarie.contanti.push(item);
          }
        }
      }

      if (e.saldo_negativo_o_scoperti === true) {
        merged.evidenzeBancarie.saldoNegativoOScoperti = true;
      }
    }
  }

  /* Reddito documentale: per ogni richiedente scegliamo prudentemente il valore più basso positivo tra i documenti disponibili. */
  if (incomeBySubject.size > 0) {
    let totale = 0;
    for (const values of incomeBySubject.values()) {
      const valid = values.filter((v) => Number.isFinite(v) && v > 0);
      if (valid.length) totale += Math.min(...valid);
    }
    if (totale > 0) {
      merged.redditoBancarioMensile = totale;
      merged.redditoFonte = "documenti_reddituali_r1_r2";
    }
  }

  if (merged.redditoBancarioMensile === null && incomeWithoutSubject.length > 0) {
    merged.redditoBancarioMensile = Math.min(...incomeWithoutSubject.filter((v) => v > 0));
    merged.redditoFonte = "documento_reddituale";
  }

  /* Fallback su estrazione numerica pura se il decision engine del documento non ha restituito il reddito. */
  if (merged.redditoBancarioMensile === null) {
    const candidates = [];

    for (const doc of documentAnalyses) {
      if (!isIncomeDocument(doc.tipoDocumento)) continue;
      const estratti = doc?.estrazione?.dati_estratti || doc?.estrazione || {};
      const value = calcolaRedditoBancarioMensilePrudenziale(estratti);
      if (Number.isFinite(value) && value > 0) candidates.push(value);
    }

    if (candidates.length) {
      merged.redditoBancarioMensile = Math.min(...candidates);
      merged.redditoFonte = "fallback_estrazione_documentale";
    }
  }

  /* Ultimo fallback: dati dichiarati nella scheda consulenza. */
  if (merged.redditoBancarioMensile === null) {
    const r1 = toNumberSafe(firstDefined(practiceData.reddito_richiedente_1, practiceData.cliente_reddito));
    const r2 = toNumberSafe(firstDefined(practiceData.reddito_richiedente_2, practiceData.cliente2_reddito));
    const dichiarato = (r1 || 0) + (r2 || 0);

    if (dichiarato > 0) {
      merged.redditoBancarioMensile = dichiarato;
      merged.redditoFonte = "scheda_consulenza_non_verificato";
      merged.criticitaFinanziarie.push("Reddito utilizzato dalla scheda consulenza: da verificare con documentazione reddituale");
    }
  }

  if (incomeScores.length) {
    merged.scoreIncome = Math.min(...incomeScores);
  }

  if (bankScores.length) {
    merged.scoreBank = Math.min(...bankScores);
  }

  const rateDichiarate = toNumberSafe(rateAltriFinanziamenti);

  if (merged.dti === null && merged.redditoBancarioMensile !== null) {
    merged.dti = calcolaDTI(
      merged.redditoBancarioMensile,
      toNumberSafe(rataMutuoStimata),
      rateDichiarate
    );
  }

  if (merged.ltv === null) {
    merged.ltv = calcolaLTV(
      toNumberSafe(importoMutuo),
      toNumberSafe(valoreImmobile)
    );
  }

  /* Score reddituale di fallback: serve solo quando il decision engine non ne ha prodotto uno. */
  if (merged.scoreIncome === null && Number.isFinite(merged.dti)) {
    merged.scoreIncome =
      merged.dti <= 30 ? 90 :
      merged.dti <= 35 ? 82 :
      merged.dti <= 40 ? 72 :
      merged.dti <= 45 ? 60 : 45;
  }

  /* Score bancario di fallback, basato solo sulle evidenze realmente estratte. */
  if (merged.scoreBank === null) {
    const bank = merged.evidenzeBancarie;
    const hasBankEvidence =
      bank.gambling.length ||
      bank.contanti.length ||
      bank.rateRilevate.length ||
      bank.stipendi.length ||
      bank.movimentiRicorrenti.length ||
      bank.saldoNegativoOScoperti;

    if (hasBankEvidence) {
      let score = 85;
      if (bank.saldoNegativoOScoperti) score -= 22;
      score -= Math.min(bank.gambling.length * 8, 32);
      score -= Math.min(bank.contanti.length * 3, 15);
      score -= Math.min(bank.rateRilevate.length * 3, 15);
      if (bank.stipendi.length >= 2) score += 5;
      merged.scoreBank = Math.max(0, Math.min(100, score));
    }
  }

  if (merged.evidenzeBancarie.gambling.length) {
    merged.criticitaFinanziarie.push(`Rilevati ${merged.evidenzeBancarie.gambling.length} movimenti riconducibili a gioco/scommesse da approfondire`);
  }

  if (merged.evidenzeBancarie.contanti.length) {
    merged.criticitaFinanziarie.push(`Rilevati ${merged.evidenzeBancarie.contanti.length} movimenti in contanti/ATM meritevoli di verifica`);
  }

  if (merged.evidenzeBancarie.saldoNegativoOScoperti) {
    merged.criticitaFinanziarie.push("Rilevati saldo negativo, scoperto o insoluti nel comportamento bancario");
  }

  if (merged.evidenzeBancarie.rateRilevate.length) {
    merged.criticitaFinanziarie.push(`Rilevati ${merged.evidenzeBancarie.rateRilevate.length} movimenti potenzialmente riconducibili a rate/finanziamenti`);
  }

  if (merged.evidenzeBancarie.stipendi.length >= 2) {
    merged.puntiForzaFinanziari.push("Accrediti stipendio/pensione ricorrenti rilevati negli estratti conto");
  }

  merged.criticitaFinanziarie = Array.from(new Set(merged.criticitaFinanziarie.filter(Boolean)));
  merged.puntiForzaFinanziari = Array.from(new Set(merged.puntiForzaFinanziari.filter(Boolean)));

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
  const severity = anomalies.hasBlocking ? "error" : reviewFlags.reviewManuale ? "warning" : "success";

  const esito = anomalies.hasBlocking
    ? "Pratica con anomalie bloccanti"
    : reviewFlags.reviewManuale
    ? "Pratica da revisionare"
    : "Pratica coerente";

  const bank = mergedFinancials.evidenzeBancarie || {};
  const prezzo = snapshot.operazione?.prezzoCompravendita || null;
  const indirizzo = snapshot.immobile?.indirizzo || null;
  const comune = snapshot.immobile?.comune || null;

  const reportLines = [
    "📁 DOSSIER PRATICA MUTUO",
    `Esito: ${esito}`,
    `Soggetti: ${snapshot.soggetti?.nominativi?.length ? snapshot.soggetti.nominativi.join(" / ") : "N/D"}`,
    `Immobile: ${indirizzo ? `${indirizzo}${comune ? ` - ${comune}` : ""}` : "N/D"}`,
    `Prezzo compravendita: ${prezzo || "N/D"}`,
    importoMutuo !== null ? `Importo mutuo: € ${formatNumberIT(importoMutuo)}` : "Importo mutuo: N/D",
    valoreImmobile !== null ? `Valore immobile: € ${formatNumberIT(valoreImmobile)}` : "Valore immobile: N/D",
    mergedFinancials.redditoBancarioMensile !== null
      ? `Reddito mensile considerato: € ${formatNumberIT(mergedFinancials.redditoBancarioMensile)} (${mergedFinancials.redditoFonte || "fonte N/D"})`
      : "Reddito mensile considerato: N/D",
    mergedFinancials.dti !== null ? `DTI: ${formatNumberIT(mergedFinancials.dti)}%` : "DTI: N/D",
    mergedFinancials.ltv !== null ? `LTV: ${formatNumberIT(mergedFinancials.ltv)}%` : "LTV: N/D",
    mergedFinancials.scoreIncome !== null ? `Score reddito: ${formatNumberIT(mergedFinancials.scoreIncome)}/100` : "Score reddito: N/D",
    mergedFinancials.scoreBank !== null ? `Score bancario: ${formatNumberIT(mergedFinancials.scoreBank)}/100` : "Score bancario: N/D",
    `Movimenti gioco/scommesse rilevati: ${(bank.gambling || []).length}`,
    `Movimenti contanti/ATM da verificare: ${(bank.contanti || []).length}`,
    `Rate/finanziamenti rilevati su conto: ${(bank.rateRilevate || []).length}`,
    `Saldo negativo/scoperti: ${bank.saldoNegativoOScoperti ? "Sì" : "No"}`,
    anomalies.anomalieBloccanti.length
      ? `Anomalie bloccanti: ${anomalies.anomalieBloccanti.join(" | ")}`
      : "Anomalie bloccanti: nessuna",
    anomalies.anomalieWarning.length
      ? `Warning: ${anomalies.anomalieWarning.join(" | ")}`
      : "Warning: nessuno",
    mergedFinancials.criticitaFinanziarie.length
      ? `Criticità finanziarie: ${mergedFinancials.criticitaFinanziarie.join(" | ")}`
      : "Criticità finanziarie: nessuna rilevata",
  ];

  return {
    esito,
    severity,
    riepilogo: {
      soggetti: snapshot.soggetti,
      immobile: snapshot.immobile,
      operazione: {
        ...snapshot.operazione,
        importoMutuo: importoMutuo ?? null,
        valoreImmobile: valoreImmobile ?? null,
        rataMutuoStimata: rataMutuoStimata ?? null,
        finalitaMutuo: finalitaMutuo ?? null,
      },
      reddito: {
        ...snapshot.reddito,
        redditoBancarioMensile: mergedFinancials.redditoBancarioMensile,
        redditoFonte: mergedFinancials.redditoFonte,
        dti: mergedFinancials.dti,
        ltv: mergedFinancials.ltv,
      },
      esposizioni: snapshot.esposizioni,
      banca: snapshot.banca,
    },
    anomalie: anomalies,
    review: reviewFlags,
    indicatori: {
      scoreIncome: mergedFinancials.scoreIncome,
      scoreBank: mergedFinancials.scoreBank,
      criticitaFinanziarie: mergedFinancials.criticitaFinanziarie,
      puntiForzaFinanziari: mergedFinancials.puntiForzaFinanziari,
      evidenzeBancarie: mergedFinancials.evidenzeBancarie,
    },
    reportTestuale: reportLines.join("\n"),
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


      const codiceBase =
        stripNumericSuffix(
          tipoDocumentoAtteso
        );


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
              codiceDocumento || codiceBase,

            codiceDocumento:
              codiceDocumento || codiceBase,

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
            codiceDocumento || codiceBase,

          codiceDocumento:
            codiceDocumento || codiceBase,

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
      secrets: ["OPENAI_API_KEY"],
    },

    async (request) => {
      const data = request.data || {};

      const {
        idCliente,
        importoMutuo = null,
        valoreImmobile = null,
        rataMutuoStimata = null,
        rateAltriFinanziamenti = null,
        finalitaMutuo = null,
      } = data;

      if (!idCliente) {
        throw new HttpsError("invalid-argument", "ID cliente mancante.");
      }

      try {
        /* 1. Scheda consulenza / dossier principale */
        const praticaSnap = await adminDb
          .collection("pratiche_mutuo")
          .doc(idCliente)
          .get();

        const practiceData = praticaSnap.exists ? (praticaSnap.data() || {}) : {};

        /* 2. Risoluzione parametri: chiamata live > scheda consulenza > fallback prudente */
        const resolvedImportoMutuo = toNumberSafe(firstDefined(
          importoMutuo,
          practiceData.importo_richiesto,
          practiceData.mutuo_importo
        ));

        const resolvedPrezzoCompravendita = toNumberSafe(firstDefined(
          practiceData.valore_compravendita,
          practiceData.mutuo_compravendita
        ));

        const resolvedValoreImmobile = toNumberSafe(firstDefined(
          valoreImmobile,
          practiceData.valore_immobile,
          practiceData.immobile_valore,
          resolvedPrezzoCompravendita
        ));

        const resolvedRataMutuoStimata = toNumberSafe(firstDefined(
          rataMutuoStimata,
          practiceData.rata_mutuo_stimata,
          practiceData.rata_stimata,
          practiceData.mutuo_rata,
          practiceData.rata_nuovo_mutuo
        ));

        const resolvedRateAltriFinanziamenti = toNumberSafe(firstDefined(
          rateAltriFinanziamenti,
          practiceData.totale_rate_finanziamenti,
          practiceData.rata_fin_pre
        ));

        const resolvedFinalitaMutuo = firstDefined(
          finalitaMutuo,
          practiceData.finalita,
          practiceData.mutuo_finalita
        );

        /* 3. Tutte le analisi documentali, mantenendo distinti R1/R2 */
        const documentAnalyses = await loadClientDocumentAnalyses(idCliente);

        if (!documentAnalyses.length) {
          return {
            ok: false,
            stato: "no_documents",
            messaggio: "Nessun documento analizzato trovato per questo cliente.",
            datiSchedaDisponibili: Object.keys(practiceData).length > 0,
          };
        }

        /* 4. Snapshot unificato: documenti verificati + fallback scheda consulenza */
        const snapshot = buildPracticeSnapshot(documentAnalyses, practiceData);

        if (!snapshot.operazione.prezzoCompravendita && resolvedPrezzoCompravendita !== null) {
          snapshot.operazione.prezzoCompravendita = resolvedPrezzoCompravendita;
        }
        if (!snapshot.operazione.importoMutuo && resolvedImportoMutuo !== null) {
          snapshot.operazione.importoMutuo = resolvedImportoMutuo;
        }
        if (!snapshot.operazione.valoreImmobile && resolvedValoreImmobile !== null) {
          snapshot.operazione.valoreImmobile = resolvedValoreImmobile;
        }
        if (!snapshot.operazione.rataMutuoStimata && resolvedRataMutuoStimata !== null) {
          snapshot.operazione.rataMutuoStimata = resolvedRataMutuoStimata;
        }
        if (!snapshot.operazione.finalita && resolvedFinalitaMutuo) {
          snapshot.operazione.finalita = resolvedFinalitaMutuo;
        }

        /* 5. Anomalie sul dossier già riconciliato */
        const anomalies = detectPracticeAnomalies(snapshot);

        /* 6. Dati finanziari aggregati R1/R2 + analisi bancaria */
        const mergedFinancials = mergePracticeFinancials({
          documentAnalyses,
          practiceData,
          importoMutuo: resolvedImportoMutuo,
          valoreImmobile: resolvedValoreImmobile,
          rataMutuoStimata: resolvedRataMutuoStimata,
          rateAltriFinanziamenti: resolvedRateAltriFinanziamenti,
        });

        /* 7. Review manuale: anomalie documentali + criticità finanziarie */
        const motiviReview = Array.from(new Set([
          ...(anomalies.anomalieBloccanti || []),
          ...(anomalies.anomalieWarning || []),
          ...documentAnalyses.flatMap((d) => d.review?.motiviReview || []),
          ...(mergedFinancials.criticitaFinanziarie || []),
        ].filter(Boolean)));

        const reviewFlags = {
          reviewManuale:
            anomalies.hasBlocking ||
            (anomalies.anomalieWarning || []).length > 0 ||
            documentAnalyses.some((d) => d.review?.reviewManuale === true) ||
            (mergedFinancials.criticitaFinanziarie || []).length > 0,
          motiviReview,
        };

        /* 8. Summary completo */
        const practiceSummary = buildPracticeSummary({
          snapshot,
          anomalies,
          mergedFinancials,
          reviewFlags,
          importoMutuo: resolvedImportoMutuo,
          valoreImmobile: resolvedValoreImmobile,
          rataMutuoStimata: resolvedRataMutuoStimata,
          finalitaMutuo: resolvedFinalitaMutuo,
        });

        /* 9. Matching banche */
        const bankMatch = await matchBanksForPractice({
          practiceSummary,
          documentAnalyses,
          anomalies,
          mergedFinancials,
          finalitaMutuo: resolvedFinalitaMutuo,
        });

        const finalDecisionCode = anomalies.hasBlocking
          ? "PRACTICE_BLOCKING_ANOMALY"
          : reviewFlags.reviewManuale
          ? "PRACTICE_REVIEW"
          : "PRACTICE_OK";

        const payload = {
          aggiornatoIl: admin.firestore.FieldValue.serverTimestamp(),
          pipelineVersion: POLICY.pipelineVersion,
          praticaCompleta: {
            decisionCode: finalDecisionCode,
            documentiConsiderati: documentAnalyses.map((d) => ({
              tipoDocumento: d.tipoDocumento,
              tipoDocumentoBase: d.tipoDocumentoBase || stripNumericSuffix(d.tipoDocumento || ""),
              decisionCode: d.decisionCode || "",
              reviewManuale: d.review?.reviewManuale === true,
              motiviReview: d.review?.motiviReview || [],
            })),
            datiSchedaConsulenza: {
              disponibili: Object.keys(practiceData).length > 0,
              importoMutuo: resolvedImportoMutuo,
              prezzoCompravendita: resolvedPrezzoCompravendita,
              valoreImmobile: resolvedValoreImmobile,
              rataMutuoStimata: resolvedRataMutuoStimata,
              rateAltriFinanziamenti: resolvedRateAltriFinanziamenti,
              finalitaMutuo: resolvedFinalitaMutuo,
            },
            snapshot,
            anomalies,
            mergedFinancials,
            reviewFlags,
            practiceSummary,
            bankMatch,
          },
        };

        await adminDb
          .collection("analisi_deliberante")
          .doc(idCliente)
          .set(payload, { merge: true });

        if (reviewFlags.reviewManuale) {
          await adminDb
            .collection("manual_reviews")
            .doc(`practice_${idCliente}`)
            .set({
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              status: "pending",
              idCliente,
              scope: "practice",
              decisionCode: finalDecisionCode,
              motiviReview: reviewFlags.motiviReview,
              snapshot,
              anomalies,
              mergedFinancials,
            }, { merge: true });
        }

        return {
          ok: true,
          stato: anomalies.hasBlocking
            ? "practice_blocking_anomaly"
            : reviewFlags.reviewManuale
            ? "practice_review"
            : "practice_ok",
          decisionCode: finalDecisionCode,
          pratica: practiceSummary,
          mergedFinancials,
          bancheConsigliate: bankMatch?.consigliate || [],
          bancheAlternative: bankMatch?.alternative || [],
        };
      } catch (error) {
        console.error("ERRORE ricostruisciPraticaCompleta:", error);
        throw new HttpsError("internal", error?.message || "Errore nella ricostruzione pratica.");
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
