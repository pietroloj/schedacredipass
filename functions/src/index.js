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


// ============================================================================
// FIREBASE
// ============================================================================

if (!admin.apps.length) {
  admin.initializeApp();
}

const adminDb = admin.firestore();

setGlobalOptions({
  region: "us-central1",
  memory: "1GiB",
  timeoutSeconds: 300,
});


// ============================================================================
// HELPER MATEMATICI
// Inseriti direttamente qui così il file è autonomo.
// ============================================================================

function numero(value) {

  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (typeof value === "number") {

    return Number.isFinite(value)
      ? value
      : null;

  }

  let str = String(value)
    .trim()
    .replace(/[€%\s]/g, "");


  if (!str) {
    return null;
  }


  // Formato italiano 1.234,56
  if (
    str.includes(".") &&
    str.includes(",")
  ) {

    if (
      str.lastIndexOf(",") >
      str.lastIndexOf(".")
    ) {

      str = str
        .replace(/\./g, "")
        .replace(",", ".");

    } else {

      str = str.replace(/,/g, "");

    }

  }

  // Solo virgola
  else if (str.includes(",")) {

    str = str.replace(",", ".");

  }


  const n = Number(str);

  return Number.isFinite(n)
    ? n
    : null;
}


function formatNumberIT(value) {

  const n = numero(value);

  if (n === null) {
    return "N/D";
  }

  return n.toLocaleString(
    "it-IT",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  );
}


function calcolaDTI(
  redditoMensile,
  rataMutuo,
  altriFinanziamenti
) {

  const reddito =
    numero(redditoMensile);

  const rata =
    numero(rataMutuo) || 0;

  const altri =
    numero(altriFinanziamenti) || 0;


  if (
    reddito === null ||
    reddito <= 0
  ) {
    return null;
  }


  return (
    ((rata + altri) / reddito) *
    100
  );
}


function calcolaLTV(
  importoMutuo,
  valoreImmobile
) {

  const mutuo =
    numero(importoMutuo);

  const valore =
    numero(valoreImmobile);


  if (
    mutuo === null ||
    valore === null ||
    valore <= 0
  ) {
    return null;
  }


  return (
    (mutuo / valore) *
    100
  );
}


function calcolaRedditoBancarioMensilePrudenziale(
  estratti = {}
) {

  if (
    !estratti ||
    typeof estratti !== "object"
  ) {
    return null;
  }


  const possibiliValori = [

    estratti.reddito_bancario_mensile,

    estratti.redditoBancarioMensile,

    estratti.reddito_netto_mensile,

    estratti.redditoNettoMensile,

    estratti.netto_mensile,

    estratti.nettoMensile,

    estratti.reddito_mensile,

    estratti.redditoMensile,

    estratti.media_netto_mensile,

    estratti.mediaNettoMensile,

  ];


  for (
    const valore of possibiliValori
  ) {

    const n =
      numero(valore);

    if (
      n !== null &&
      n > 0
    ) {
      return n;
    }

  }


  return null;
}


// ============================================================================
// HELPERS GENERALI
// ============================================================================

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


function computeAnalysisKey({
  idCliente,
  codiceBase,
  files,
}) {

  const fileHashComposite =
    files
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


// ============================================================================
// NORMALIZZAZIONE CONFIDENZA AI
//
// Funziona sia se il classificatore restituisce:
// 0.82
//
// sia se restituisce:
// 82
// ============================================================================

function normalizeConfidence(value) {

  let n =
    Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }


  if (n > 1) {
    n = n / 100;
  }


  if (n < 0) {
    n = 0;
  }


  if (n > 1) {
    n = 1;
  }


  return n;

}


// ============================================================================
// ANALISI DOCUMENTI CLIENTE
// ============================================================================

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


  auditSnap.forEach(
    (doc) => {

      const data =
        doc.data() || {};


      const tipoDocumento =
        data.tipoDocumentoAtteso ||
        "";


      const createdAt =
        data.createdAt
          ?.toMillis
          ?.() ||
        0;


      if (!tipoDocumento) {
        return;
      }


      const current =
        latestByDocType.get(
          tipoDocumento
        );


      if (
        !current ||
        createdAt >
          current.createdAt
      ) {

        latestByDocType.set(

          tipoDocumento,

          {

            createdAt,

            tipoDocumento,

            classificazione:
              data.classificazione ||
              null,

            estrazione:
              data.estrazione ||
              null,

            decisioneBackend:
              data.decisioneBackend ||
              null,

            review:
              data.review ||
              null,

            decisionCode:
              data.decisionCode ||
              "",

          }

        );

      }

    }
  );


  return Array.from(
    latestByDocType.values()
  );

}


// ============================================================================
// MERGE DATI FINANZIARI
// ============================================================================

function mergePracticeFinancials({

  documentAnalyses,

  importoMutuo,

  valoreImmobile,

  rataMutuoStimata,

  rateAltriFinanziamenti,

}) {

  const merged = {

    redditoBancarioMensile:
      null,

    dti:
      null,

    ltv:
      null,

    scoreIncome:
      null,

    scoreBank:
      null,

    criticitaFinanziarie:
      [],

    puntiForzaFinanziari:
      [],

  };


  for (
    const doc
    of documentAnalyses
  ) {

    const dec =
      doc.decisioneBackend ||
      {};


    if (
      dec.redditoBancarioMensile !==
        undefined &&
      dec.redditoBancarioMensile !==
        null
    ) {

      merged.redditoBancarioMensile =
        dec.redditoBancarioMensile;

    }


    if (
      dec.dti !== undefined &&
      dec.dti !== null
    ) {

      merged.dti =
        dec.dti;

    }


    if (
      dec.ltv !== undefined &&
      dec.ltv !== null
    ) {

      merged.ltv =
        dec.ltv;

    }


    if (
      dec.score !== undefined &&
      dec.score !== null
    ) {

      merged.scoreIncome =
        dec.score;

    }


    if (
      dec.scoreComportamentoBancario !==
        undefined &&
      dec.scoreComportamentoBancario !==
        null
    ) {

      merged.scoreBank =
        dec.scoreComportamentoBancario;

    }


    if (
      Array.isArray(
        dec.criticita
      )
    ) {

      merged
        .criticitaFinanziarie
        .push(
          ...dec.criticita
        );

    }


    if (
      Array.isArray(
        dec.puntiForza
      )
    ) {

      merged
        .puntiForzaFinanziari
        .push(
          ...dec.puntiForza
        );

    }

  }


  if (
    merged.redditoBancarioMensile ===
    null
  ) {

    const incomeDoc =
      documentAnalyses.find(
        (d) =>
          [
            "doc_cud",
            "doc_unici",
            "doc_bustepaga",
            "cud",
            "unici",
            "bustepaga",
          ].includes(
            d.tipoDocumento
          )
      );


    const estratti =
      incomeDoc
        ?.estrazione
        ?.dati_estratti ||
      {};


    merged.redditoBancarioMensile =
      calcolaRedditoBancarioMensilePrudenziale(
        estratti
      );

  }


  if (
    merged.dti === null &&
    merged.redditoBancarioMensile !==
      null
  ) {

    merged.dti =
      calcolaDTI(

        merged.redditoBancarioMensile,

        rataMutuoStimata,

        rateAltriFinanziamenti

      );

  }


  if (
    merged.ltv === null
  ) {

    merged.ltv =
      calcolaLTV(

        importoMutuo,

        valoreImmobile

      );

  }


  merged.criticitaFinanziarie =
    Array.from(
      new Set(
        merged.criticitaFinanziarie
      )
    );


  merged.puntiForzaFinanziari =
    Array.from(
      new Set(
        merged.puntiForzaFinanziari
      )
    );


  return merged;

}


// ============================================================================
// SUMMARY PRATICA
// ============================================================================

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
    anomalies.hasBlocking
      ? "error"
      : reviewFlags.reviewManuale
      ? "warning"
      : "success";


  const esito =
    anomalies.hasBlocking
      ?
        "Pratica con anomalie bloccanti"
      :
      reviewFlags.reviewManuale
      ?
        "Pratica da revisionare"
      :
        "Pratica coerente";


  return {

    esito,

    severity,

    riepilogo: {

      soggetti:
        snapshot.soggetti,

      immobile:
        snapshot.immobile,

      operazione: {

        ...snapshot.operazione,

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

        ...snapshot.reddito,

        redditoBancarioMensile:
          mergedFinancials
            .redditoBancarioMensile,

        dti:
          mergedFinancials
            .dti,

        ltv:
          mergedFinancials
            .ltv,

      },

      esposizioni:
        snapshot.esposizioni,

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

    reportTestuale: [

      "📁 DOSSIER PRATICA MUTUO",

      `Esito: ${esito}`,

      snapshot
        .immobile
        ?.indirizzo
        ?
        `Immobile: ${snapshot.immobile.indirizzo}`
        :
        "Immobile: N/D",

      snapshot
        .operazione
        ?.prezzoCompravendita
        ?
        `Prezzo compravendita: ${snapshot.operazione.prezzoCompravendita}`
        :
        "Prezzo compravendita: N/D",

      mergedFinancials
        .redditoBancarioMensile !==
        null
        ?
        `Reddito bancario mensile: € ${formatNumberIT(mergedFinancials.redditoBancarioMensile)}`
        :
        "Reddito bancario mensile: N/D",

      mergedFinancials
        .dti !==
        null
        ?
        `DTI: ${formatNumberIT(mergedFinancials.dti)}%`
        :
        "DTI: N/D",

      mergedFinancials
        .ltv !==
        null
        ?
        `LTV: ${formatNumberIT(mergedFinancials.ltv)}%`
        :
        "LTV: N/D",

      anomalies
        .anomalieBloccanti
        .length
        ?
        `Anomalie bloccanti: ${anomalies.anomalieBloccanti.join(" | ")}`
        :
        "Anomalie bloccanti: nessuna",

      anomalies
        .anomalieWarning
        .length
        ?
        `Warning: ${anomalies.anomalieWarning.join(" | ")}`
        :
        "Warning: nessuno",

    ].join("\n"),

  };

}


// ============================================================================
// ============================================================================
// CLOUD FUNCTION: ANALIZZA DOCUMENTO
// ============================================================================
// ============================================================================

exports.analizzaDocumentoAI =
onCall(
  {
    secrets: [
      "OPENAI_API_KEY",
    ],
  },

  async (request) => {

    const data =
      request.data ||
      {};


    const {

      idCliente,

      tipoDocumentoAtteso,

      urlFileBase64,

      urlFileBase64Front,

      urlFileBase64Back,

      importoMutuo =
        null,

      valoreImmobile =
        null,

      rataMutuoStimata =
        null,

      rateAltriFinanziamenti =
        null,

      durataAnni =
        null,

      prodottoBancario =
        null,

      finalitaMutuo =
        null,

      notePratica =
        null,

    } = data;


    // ======================================================================
    // DATI OBBLIGATORI
    // ======================================================================

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


    const files = [];


    if (
      urlFileBase64Front
    ) {

      files.push({
        side: "front",
        base64:
          urlFileBase64Front,
      });

    }


    if (
      urlFileBase64Back
    ) {

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


    // ======================================================================
    // PRECHECK TECNICO
    //
    // QUESTO RIMANE SEVERO:
    // se il file è tecnicamente inutilizzabile non ha senso proseguire.
    // ======================================================================

    const precheck =
      technicalPrecheck({

        files,

        tipoDocumentoAtteso:
          codiceBase,

      });


    if (!precheck.ok) {

      return buildBaseResponse({

        ok:
          false,

        stato:
          "precheck_failed",

        tipoDocumentoAtteso:
          codiceBase,

        valido:
          false,

        decisionCode:
          "PRECHECK_FAILED",

        pipelineVersion:
          POLICY.pipelineVersion,

        ui:
          buildUiResult({

            severity:
              "error",

            titolo:
              "File non valido",

            messaggio:
              precheck.motivo,

            badge: [
              "Precheck KO",
            ],

          }),

      });

    }


    // ======================================================================
    // VARIABILI PIPELINE
    // ======================================================================

    let preparedFiles =
      [];

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

      reviewManuale:
        false,

      motiviReview:
        [],

    };

    let analysisKey =
      "";


    // ======================================================================
    // NUOVE VARIABILI PER CLASSIFICAZIONE PERMISSIVA
    // ======================================================================

    let classificazioneForzataInReview =
      false;

    let motiviClassificazioneForzata =
      [];


    try {

      // ====================================================================
      // PREPARAZIONE FILE
      // ====================================================================

      preparedFiles =
        await uploadAndPrepareContents(
          files
        );


      analysisKey =
        computeAnalysisKey({

          idCliente,

          codiceBase,

          files:
            preparedFiles,

        });


      // ====================================================================
      // CACHE
      // ====================================================================

      if (
        POLICY.enableIdempotencyCache
      ) {

        const summary =
          await getSummaryDoc(
            idCliente
          );


        if (
          summary
            ?.analysisKey ===
            analysisKey &&
          summary
            ?.analysisResultCached
        ) {

          return summary
            .analysisResultCached;

        }

      }


      // ====================================================================
      // PRIMA CLASSIFICAZIONE
      // ====================================================================

      classificazione =
        await classifyDocument({

          tipoDocumentoAtteso:
            codiceBase,

          preparedFiles,

        });


      let confidence =
        normalizeConfidence(

          classificazione
            ?.confidenza_classificazione

        );


      // ====================================================================
      // RETRY CLASSIFICAZIONE
      //
      // Se AI è incerta proviamo una seconda volta.
      // ====================================================================

      const sogliaRetry =
        normalizeConfidence(

          POLICY
            .classificationConfidenceReject ??
          0.75

        );


      const tipoPrimaClassificazione =
        String(

          classificazione
            ?.tipo_documento_rilevato ||
          ""

        )
          .trim()
          .toLowerCase();


      const richiedeRetry =

        tipoPrimaClassificazione ===
          "non_determinabile"

        ||

        tipoPrimaClassificazione ===
          "non determinabile"

        ||

        confidence <
          sogliaRetry;


      if (richiedeRetry) {

        retryClassificazione =
          await retryClassification({

            tipoDocumentoAtteso:
              codiceBase,

            preparedFiles,

          });


        const retryConfidence =
          normalizeConfidence(

            retryClassificazione
              ?.confidenza_classificazione

          );


        if (
          retryConfidence >
          confidence
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
                .motivo_errore
              ||
              classificazione
                .motivo_errore,

            leggibile_umano:
              retryClassificazione
                .leggibile_umano
              ??
              classificazione
                .leggibile_umano,

            valido:
              Boolean(
                retryClassificazione
                  .coerenza_documentale
              )
              &&
              !Boolean(
                retryClassificazione
                  .gravemente_illeggibile
              ),

          };


          confidence =
            retryConfidence;

        }

      }


      // ====================================================================
      // ====================================================================
      // CLASSIFICAZIONE PERMISSIVA
      // ====================================================================
      //
      // REGOLA:
      //
      // 1. AI incerta       -> ACCETTA + REVIEW
      // 2. Non determinato  -> ACCETTA + REVIEW
      // 3. Poco leggibile   -> ACCETTA + REVIEW
      // 4. Documento diverso con confidenza debole -> ACCETTA + REVIEW
      //
      // BLOCCO SOLO:
      //
      // A. gravemente illeggibile
      // B. documento chiaramente diverso con confidenza >= 95%
      //
      // ====================================================================


      confidence =
        normalizeConfidence(

          classificazione
            ?.confidenza_classificazione

        );


      const tipoRilevato =
        String(

          classificazione
            ?.tipo_documento_rilevato ||
          ""

        )
          .trim()
          .toLowerCase();


      const tipoAtteso =
        String(
          codiceBase ||
          ""
        )
          .trim()
          .toLowerCase();


      const nonDeterminabile =

        !tipoRilevato

        ||

        tipoRilevato ===
          "non_determinabile"

        ||

        tipoRilevato ===
          "non determinabile"

        ||

        tipoRilevato ===
          "unknown"

        ||

        tipoRilevato ===
          "sconosciuto"

        ||

        tipoRilevato ===
          "nd"

        ||

        tipoRilevato ===
          "n/d";


      // ====================================================================
      // HARD REJECT 1
      // Documento veramente illeggibile
      // ====================================================================

      const hardUnreadable =

        classificazione
          ?.gravemente_illeggibile ===
          true;


      // ====================================================================
      // HARD REJECT 2
      //
      // Documento chiaramente diverso.
      //
      // Uso 95%.
      // Quindi un mismatch al 60%, 70%, 80% NON blocca.
      // ====================================================================

      const hardMismatch =

        !nonDeterminabile

        &&

        tipoRilevato !==
          tipoAtteso

        &&

        confidence >=
          0.95;


      // ====================================================================
      // RIFIUTO EFFETTIVO
      // ====================================================================

      if (
        hardUnreadable ||
        hardMismatch
      ) {

        const motiviRifiuto =
          [];


        if (hardUnreadable) {

          motiviRifiuto.push(

            "Il documento risulta gravemente illeggibile e non consente una verifica attendibile."

          );

        }


        if (hardMismatch) {

          motiviRifiuto.push(

            `Il documento rilevato (${classificazione.tipo_documento_rilevato}) non corrisponde al documento richiesto (${codiceBase}).`

          );

        }


        const stato =
          "classified_rejected";


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

            ok:
              true,

            stato,

            tipoDocumentoAtteso:
              codiceBase,

            tipoDocumentoRilevato:
              classificazione
                .tipo_documento_rilevato,

            confidence,

            valido:
              false,

            decisionCode,

            analysisKey,

            pipelineVersion:
              POLICY.pipelineVersion,

            classificazione,

            ui:
              buildUiResult({

                severity:
                  "error",

                titolo:
                  "Documento non valido",

                messaggio:
                  motiviRifiuto.join(" ")
                  ||
                  classificazione
                    .motivo_errore
                  ||
                  "Il documento caricato non può essere utilizzato.",

                badge: [
                  "Documento rifiutato",
                ],

              }),

          });


        await saveSummaryDoc({

          idCliente,

          pipelineVersion:
            POLICY.pipelineVersion,

          analysisKey,

          tipoDocumentoAtteso:
            codiceBase,

          classificazione,

          estrazione:
            null,

          decisioneBackend:
            null,

          review,

          ui:
            result.ui,

          preparedFiles,

          decisionCode,

          resultCached:
            result,

        });


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

          estrazione:
            null,

          decisioneBackend:
            null,

          review,

          preparedFiles,

          decisionCode,

        });


        return result;

      }


      // ====================================================================
      // DA QUI IN POI NON BLOCHIAMO PIÙ IL CLIENTE
      // ====================================================================


      // --------------------------------------------------------------------
      // Classificazione originale negativa
      // --------------------------------------------------------------------

      if (
        classificazione
          ?.valido ===
          false
      ) {

        classificazioneForzataInReview =
          true;


        motiviClassificazioneForzata
          .push(

            classificazione
              ?.motivo_errore
            ||
            "La classificazione automatica non è risultata sufficientemente certa."

          );

      }


      // --------------------------------------------------------------------
      // Documento non determinabile
      // --------------------------------------------------------------------

      if (
        nonDeterminabile
      ) {

        classificazioneForzataInReview =
          true;


        motiviClassificazioneForzata
          .push(

            "Il tipo di documento non è stato determinato con certezza dall'AI."

          );

      }


      // --------------------------------------------------------------------
      // Confidenza classificazione sotto 75%
      // --------------------------------------------------------------------

      if (
        confidence <
        0.75
      ) {

        classificazioneForzataInReview =
          true;


        motiviClassificazioneForzata
          .push(

            `Confidenza della classificazione ridotta (${Math.round(confidence * 100)}%).`

          );

      }


      // --------------------------------------------------------------------
      // Documento diverso, MA AI non sufficientemente sicura per bloccarlo
      // --------------------------------------------------------------------

      if (
        !nonDeterminabile &&
        tipoRilevato !==
          tipoAtteso &&
        confidence <
          0.95
      ) {

        classificazioneForzataInReview =
          true;


        motiviClassificazioneForzata
          .push(

            `Possibile classificazione differente (${classificazione.tipo_documento_rilevato}), ma con confidenza insufficiente per rifiutare automaticamente il documento.`

          );

      }


      // --------------------------------------------------------------------
      // Documento leggibile per umano ma AI dubbia
      // --------------------------------------------------------------------

      if (
        classificazione
          ?.leggibile_umano ===
          true
        &&
        classificazione
          ?.valido ===
          false
      ) {

        classificazioneForzataInReview =
          true;


        motiviClassificazioneForzata
          .push(

            "Il documento appare leggibile ma la classificazione automatica è dubbia."

          );

      }


      // ====================================================================
      // FORZIAMO IL PROSEGUIMENTO DEL DOCUMENTO
      //
      // Il documento viene quindi estratto e analizzato.
      // La revisione manuale rimane registrata.
      // ====================================================================

      classificazione = {

        ...classificazione,

        valido:
          true,

        confidenza_normalizzata:
          confidence,

        accettato_permissivamente:
          classificazioneForzataInReview,

        richiede_verifica_manuale:
          classificazioneForzataInReview,

      };


      // ====================================================================
      // CONTESTO PRATICA
      // ====================================================================

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


      // ====================================================================
      // ESTRAZIONE DATI
      // ====================================================================

      if (
        DOC_GROUPS
          .identity
          .includes(
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
        DOC_GROUPS
          .income
          .includes(
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
        DOC_GROUPS
          .bank
          .includes(
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
        DOC_GROUPS
          .realEstate
          .includes(
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


      // ====================================================================
      // SNAPSHOT DOCUMENTO
      // ====================================================================

      practiceSnapshot =
        buildPracticeSnapshot([

          {

            tipoDocumento:
              codiceBase,

            classificazione,

            estrazione,

          },

        ]);


      // ====================================================================
      // ANOMALIE
      // ====================================================================

      practiceAnomalies =
        detectPracticeAnomalies(
          practiceSnapshot
        );


      // ====================================================================
      // REVIEW POLICY ORIGINALE
      // ====================================================================

      review =
        reviewPolicy({

          classificazione,

          estrazione,

          tipoDocumentoAtteso:
            codiceBase,

          practiceAnomalies,

        });


      if (
        !review ||
        typeof review !==
          "object"
      ) {

        review = {

          reviewManuale:
            false,

          motiviReview:
            [],

        };

      }


      if (
        !Array.isArray(
          review.motiviReview
        )
      ) {

        review.motiviReview =
          [];

      }


      // ====================================================================
      // APPLICAZIONE REVIEW DELLA LOGICA PERMISSIVA
      // ====================================================================

      if (
        classificazioneForzataInReview
      ) {

        review = {

          ...review,

          reviewManuale:
            true,

          motiviReview:
            Array.from(

              new Set([

                ...(
                  review
                    .motiviReview ||
                  []
                ),

                ...motiviClassificazioneForzata,

              ])

            ),

        };

      }


      const stato =

        review.reviewManuale

          ?

          "manual_review"

          :

          "completed";


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


      // ====================================================================
      // RISPOSTA
      //
      // ATTENZIONE:
      // valido è TRUE anche se serve revisione.
      //
      // Questo è ciò che impedisce al tuo upload.html di bloccare il cliente.
      // ====================================================================

      const result =
        buildBaseResponse({

          ok:
            true,

          stato,

          tipoDocumentoAtteso:
            codiceBase,

          tipoDocumentoRilevato:
            classificazione
              .tipo_documento_rilevato,

          confidence,

          valido:
            true,

          reviewManuale:
            review.reviewManuale,

          motiviReview:
            review.motiviReview,

          decisionCode,

          analysisKey,

          pipelineVersion:
            POLICY.pipelineVersion,

          classificazione,

          estrazione,

          decisioneBackend: {

            ...(
              decisioneBackend ||
              {}
            ),

            practiceSnapshot,

            practiceAnomalies,

          },

          ui:
            buildUiResult({

              severity:
                review.reviewManuale
                  ?
                  "warning"
                  :
                  "success",

              titolo:
                review.reviewManuale
                  ?
                  "Documento acquisito - verifica consigliata"
                  :
                  "Documento valido",

              messaggio:
                review.reviewManuale
                  ?
                  "Il documento è stato acquisito correttamente. Alcuni elementi saranno verificati durante la revisione della pratica."
                  :
                  "Documento coerente, leggibile e analizzato correttamente.",

              badge: [

                codiceBase,

                classificazione
                  .leggibile_umano ===
                  false
                  ?
                  "Leggibilità da verificare"
                  :
                  "Acquisito",

                review
                  .reviewManuale
                  ?
                  "Review"
                  :
                  "OK",

              ],

            }),

        });


      // ====================================================================
      // SALVATAGGIO SUMMARY
      // ====================================================================

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


      // ====================================================================
      // AUDIT
      // ====================================================================

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


      // ====================================================================
      // MANUAL REVIEW
      // ====================================================================

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


// ============================================================================
// ============================================================================
// CLOUD FUNCTION: RICOSTRUISCI PRATICA COMPLETA
// ============================================================================
// ============================================================================

exports.ricostruisciPraticaCompleta =
onCall(
  {
    secrets: [
      "OPENAI_API_KEY",
    ],
  },

  async (request) => {

    const data =
      request.data ||
      {};


    const {

      idCliente,

      importoMutuo =
        null,

      valoreImmobile =
        null,

      rataMutuoStimata =
        null,

      rateAltriFinanziamenti =
        null,

      finalitaMutuo =
        null,

    } = data;


    if (!idCliente) {

      throw new HttpsError(

        "invalid-argument",

        "ID cliente mancante."

      );

    }


    try {

      // ====================================================================
      // RECUPERO TUTTE LE ANALISI
      // ====================================================================

      const documentAnalyses =
        await loadClientDocumentAnalyses(
          idCliente
        );


      if (
        !documentAnalyses.length
      ) {

        return {

          ok:
            false,

          stato:
            "no_documents",

          messaggio:
            "Nessun documento analizzato trovato per questo cliente.",

        };

      }


      // ====================================================================
      // SNAPSHOT PRATICA
      // ====================================================================

      const snapshot =
        buildPracticeSnapshot(
          documentAnalyses
        );


      // ====================================================================
      // ANOMALIE
      // ====================================================================

      const anomalies =
        detectPracticeAnomalies(
          snapshot
        );


      // ====================================================================
      // DATI FINANZIARI
      // ====================================================================

      const mergedFinancials =
        mergePracticeFinancials({

          documentAnalyses,

          importoMutuo,

          valoreImmobile,

          rataMutuoStimata,

          rateAltriFinanziamenti,

        });


      // ====================================================================
      // REVIEW COMPLESSIVA
      // ====================================================================

      const reviewFlags = {

        reviewManuale:

          anomalies.hasBlocking

          ||

          anomalies
            .anomalieWarning
            .length >
            0

          ||

          documentAnalyses
            .some(
              (d) =>
                d.review
                  ?.reviewManuale ===
                true
            ),


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
                    d.review
                      ?.motiviReview ||
                    []
                ),

            ])

          ),

      };


      // ====================================================================
      // SUMMARY
      // ====================================================================

      const practiceSummary =
        buildPracticeSummary({

          snapshot,

          anomalies,

          mergedFinancials,

          reviewFlags,

          importoMutuo,

          valoreImmobile,

          rataMutuoStimata,

          finalitaMutuo,

        });


      // ====================================================================
      // BANK MATCHING
      // ====================================================================

      const bankMatch =
        await matchBanksForPractice({

          practiceSummary,

          documentAnalyses,

          anomalies,

          mergedFinancials,

          finalitaMutuo,

        });


      // ====================================================================
      // DECISION CODE
      // ====================================================================

      const finalDecisionCode =

        anomalies.hasBlocking

          ?

          "PRACTICE_BLOCKING_ANOMALY"

          :

          reviewFlags.reviewManuale

          ?

          "PRACTICE_REVIEW"

          :

          "PRACTICE_OK";


      // ====================================================================
      // PAYLOAD FIRESTORE
      // ====================================================================

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
            documentAnalyses
              .map(
                (d) => ({

                  tipoDocumento:
                    d.tipoDocumento,

                  decisionCode:
                    d.decisionCode ||
                    "",

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


      // ====================================================================
      // SALVATAGGIO PRATICA COMPLETA
      // ====================================================================

      await adminDb
        .collection(
          "analisi_deliberante"
        )
        .doc(
          idCliente
        )
        .set(
          payload,
          {
            merge:
              true,
          }
        );


      // ====================================================================
      // MANUAL REVIEW PRATICA
      // ====================================================================

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
              merge:
                true,
            }

          );

      }


      // ====================================================================
      // RETURN
      // ====================================================================

      return {

        ok:
          true,

        stato:

          anomalies.hasBlocking

            ?

            "practice_blocking_anomaly"

            :

            reviewFlags.reviewManuale

            ?

            "practice_review"

            :

            "practice_ok",


        decisionCode:
          finalDecisionCode,


        pratica:
          practiceSummary,


        bancheConsigliate:
          bankMatch
            ?.consigliate ||
          [],


        bancheAlternative:
          bankMatch
            ?.alternative ||
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


// ============================================================================
// IMPORT POLICY BANCARIE
// ============================================================================

const {
  importaPolicyBancarieDaFileVersionata,
} = require("./policyImporter");


exports.importaPolicyBancarieDaFileVersionata =
  importaPolicyBancarieDaFileVersionata;
