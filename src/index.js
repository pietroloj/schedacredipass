const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

const { POLICY } = require("./config/policy");
const { DOC_GROUPS } = require("./config/documents");
const { stripNumericSuffix, sha256String } = require("./utils/strings");
const { buildUiResult, buildBaseResponse } = require("./utils/responseBuilders");
const { technicalPrecheck } = require("./services/precheck");
const { uploadAndPrepareContents } = require("./services/openaiClient");
const { classifyDocument, retryClassification } = require("./services/classifiers");
const { extractIdentity } = require("./services/extractors.identity");
const { extractIncome } = require("./services/extractors.income");
const { extractBank } = require("./services/extractors.bank");
const { extractRealEstate } = require("./services/extractors.realEstate");
const { extractGeneric } = require("./services/extractors.generic");
const { buildPracticeSnapshot } = require("./services/reconciler");
const { detectPracticeAnomalies } = require("./services/anomalyEngine");
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

admin.initializeApp();
setGlobalOptions({ region: "us-central1", memory: "1GiB", timeoutSeconds: 300 });

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

function computeAnalysisKey({ idCliente, codiceBase, files }) {
  const fileHashComposite = files.map((f) => `${f.side}:${f.sha256}`).sort().join("|");
  return sha256String(`${POLICY.pipelineVersion}|${idCliente}|${codiceBase}|${fileHashComposite}`);
}

exports.analizzaDocumentoAI = onCall({ secrets: ["OPENAI_API_KEY"] }, async (request) => {
  const data = request.data || {};
  const {
    idCliente,
    tipoDocumentoAtteso,
    urlFileBase64,
    urlFileBase64Front,
    urlFileBase64Back,
    importoMutuo = null,
    valoreImmobile = null,
    rataMutuoStimata = null,
    rateAltriFinanziamenti = null,
    durataAnni = null,
    prodottoBancario = null,
    finalitaMutuo = null,
    notePratica = null,
  } = data;

  if (!idCliente) throw new HttpsError("invalid-argument", "ID cliente mancante.");
  if (!tipoDocumentoAtteso) throw new HttpsError("invalid-argument", "Tipo documento atteso mancante.");

  const codiceBase = stripNumericSuffix(tipoDocumentoAtteso);
  const files = [];
  if (urlFileBase64Front) files.push({ side: "front", base64: urlFileBase64Front });
  if (urlFileBase64Back) files.push({ side: "back", base64: urlFileBase64Back });
  if (urlFileBase64 && files.length === 0) files.push({ side: "single", base64: urlFileBase64 });

  const precheck = technicalPrecheck({ files, tipoDocumentoAtteso: codiceBase });
  if (!precheck.ok) {
    return buildBaseResponse({
      ok: false,
      stato: "precheck_failed",
      tipoDocumentoAtteso: codiceBase,
      valido: false,
      decisionCode: "PRECHECK_FAILED",
      pipelineVersion: POLICY.pipelineVersion,
      ui: buildUiResult({ severity: "error", titolo: "File non valido", messaggio: precheck.motivo, badge: ["Precheck KO"] }),
    });
  }

  let preparedFiles = [];
  let classificazione = null;
  let retryClassificazione = null;
  let estrazione = null;
  let decisioneBackend = null;
  let practiceSnapshot = null;
  let practiceAnomalies = null;
  let review = { reviewManuale: false, motiviReview: [] };
  let analysisKey = "";

  try {
    preparedFiles = await uploadAndPrepareContents(files);
    analysisKey = computeAnalysisKey({ idCliente, codiceBase, files: preparedFiles });

    if (POLICY.enableIdempotencyCache) {
      const summary = await getSummaryDoc(idCliente);
      if (summary?.analysisKey === analysisKey && summary?.analysisResultCached) return summary.analysisResultCached;
    }

    classificazione = await classifyDocument({ tipoDocumentoAtteso: codiceBase, preparedFiles });
    if (classificazione.tipo_documento_rilevato === "non_determinabile" || classificazione.confidenza_classificazione < POLICY.classificationConfidenceReject) {
      retryClassificazione = await retryClassification({ tipoDocumentoAtteso: codiceBase, preparedFiles });
      if (retryClassificazione.confidenza_classificazione > classificazione.confidenza_classificazione) {
        classificazione = {
          ...classificazione,
          tipo_documento_rilevato: retryClassificazione.tipo_documento_rilevato,
          coerenza_documentale: retryClassificazione.coerenza_documentale,
          gravemente_illeggibile: retryClassificazione.gravemente_illeggibile,
          confidenza_classificazione: retryClassificazione.confidenza_classificazione,
          motivo_errore: retryClassificazione.motivo_errore || classificazione.motivo_errore,
          valido: retryClassificazione.coerenza_documentale && !retryClassificazione.gravemente_illeggibile,
        };
      }
    }

    if (!classificazione.valido) {
      const stato = "classified_rejected";
      const decisionCode = getDecisionCode({ stato, codiceBase, reviewManuale: false, classificazione });
      const result = buildBaseResponse({
        ok: true,
        stato,
        tipoDocumentoAtteso: codiceBase,
        tipoDocumentoRilevato: classificazione.tipo_documento_rilevato,
        confidence: classificazione.confidenza_classificazione,
        valido: false,
        decisionCode,
        analysisKey,
        pipelineVersion: POLICY.pipelineVersion,
        classificazione,
        ui: buildUiResult({ severity: "error", titolo: "Documento non valido", messaggio: classificazione.motivo_errore || "Documento non coerente o non leggibile.", badge: ["Classificazione KO"] }),
      });

      await saveSummaryDoc({
        idCliente,
        pipelineVersion: POLICY.pipelineVersion,
        analysisKey,
        tipoDocumentoAtteso: codiceBase,
        classificazione,
        estrazione: null,
        decisioneBackend: null,
        review,
        ui: result.ui,
        preparedFiles,
        decisionCode,
        resultCached: result,
      });
      await saveAuditEntry({
        idCliente,
        pipelineVersion: POLICY.pipelineVersion,
        analysisKey,
        tipoDocumentoAtteso: codiceBase,
        precheck,
        classificazione,
        retryClassificazione,
        estrazione: null,
        decisioneBackend: null,
        review,
        preparedFiles,
        decisionCode,
      });
      return result;
    }

    const practiceContext = buildPracticeContext({ importoMutuo, valoreImmobile, rataMutuoStimata, rateAltriFinanziamenti, durataAnni, prodottoBancario, finalitaMutuo, notePratica });

    if (DOC_GROUPS.identity.includes(codiceBase)) {
      estrazione = await extractIdentity({ tipoDocumentoAtteso: codiceBase, preparedFiles });
    } else if (DOC_GROUPS.income.includes(codiceBase)) {
      estrazione = await extractIncome({ tipoDocumentoAtteso: codiceBase, preparedFiles, practiceContext });
      decisioneBackend = scoreIncomeDecision({ estrazione, data: { importoMutuo, valoreImmobile, rataMutuoStimata, rateAltriFinanziamenti } });
    } else if (DOC_GROUPS.bank.includes(codiceBase)) {
      estrazione = await extractBank({ tipoDocumentoAtteso: codiceBase, preparedFiles, practiceContext });
      decisioneBackend = scoreBankDecision({ estrazione });
    } else if (DOC_GROUPS.realEstate.includes(codiceBase)) {
      estrazione = await extractRealEstate({ tipoDocumentoAtteso: codiceBase, preparedFiles, practiceContext });
    } else {
      estrazione = await extractGeneric({ tipoDocumentoAtteso: codiceBase, preparedFiles });
    }

    practiceSnapshot = buildPracticeSnapshot([{ tipoDocumento: codiceBase, classificazione, estrazione }]);
    practiceAnomalies = detectPracticeAnomalies(practiceSnapshot);

    review = reviewPolicy({ classificazione, estrazione, tipoDocumentoAtteso: codiceBase, practiceAnomalies });
    const stato = review.reviewManuale ? "manual_review" : "completed";
    const decisionCode = getDecisionCode({ stato, codiceBase, reviewManuale: review.reviewManuale, classificazione, decisioneBackend, practiceAnomalies });

    const result = buildBaseResponse({
      ok: true,
      stato,
      tipoDocumentoAtteso: codiceBase,
      tipoDocumentoRilevato: classificazione.tipo_documento_rilevato,
      confidence: classificazione.confidenza_classificazione,
      valido: true,
      reviewManuale: review.reviewManuale,
      motiviReview: review.motiviReview,
      decisionCode,
      analysisKey,
      pipelineVersion: POLICY.pipelineVersion,
      classificazione,
      estrazione,
      decisioneBackend: { ...decisioneBackend, practiceSnapshot, practiceAnomalies },
      ui: buildUiResult({
        severity: review.reviewManuale ? "warning" : "success",
        titolo: review.reviewManuale ? "Documento da verificare" : "Documento valido",
        messaggio: review.reviewManuale ? "Documento coerente ma richiede revisione manuale." : "Documento coerente, leggibile e analizzato correttamente.",
        badge: [codiceBase, classificazione.leggibile_umano ? "Leggibile" : "Da verificare", review.reviewManuale ? "Review" : "OK"],
      }),
    });

    await saveSummaryDoc({
      idCliente,
      pipelineVersion: POLICY.pipelineVersion,
      analysisKey,
      tipoDocumentoAtteso: codiceBase,
      classificazione,
      estrazione,
      decisioneBackend: result.decisioneBackend,
      review,
      ui: result.ui,
      preparedFiles,
      decisionCode,
      resultCached: result,
      practiceSnapshot,
      practiceAnomalies,
    });
    await saveAuditEntry({
      idCliente,
      pipelineVersion: POLICY.pipelineVersion,
      analysisKey,
      tipoDocumentoAtteso: codiceBase,
      precheck,
      classificazione,
      retryClassificazione,
      estrazione,
      decisioneBackend: result.decisioneBackend,
      review,
      preparedFiles,
      decisionCode,
      practiceSnapshot,
      practiceAnomalies,
    });
    if (review.reviewManuale) {
      await upsertManualReview({ idCliente, tipoDocumentoAtteso: codiceBase, analysisKey, classificazione, estrazione, motiviReview: review.motiviReview, decisionCode });
    }

    return result;
  } catch (error) {
    console.error("ERRORE analizzaDocumentoAI:", error);
    throw new HttpsError("internal", error?.message || "Errore del server AI.");
  }
});
