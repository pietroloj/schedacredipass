const admin = require("firebase-admin");
const { maskSensitiveIdentityFields } = require("../utils/masking");
const { nowIso } = require("../utils/strings");

const COLLECTION = "analisi_deliberante";
const MANUAL_REVIEW_COLLECTION = "manual_reviews";

function buildFileMeta(preparedFiles) {
  return preparedFiles.map((f) => ({
    side: f.side,
    mimeType: f.mimeType,
    bytes: f.bytes,
    sha256: f.sha256,
    fileId: f.fileId,
  }));
}

function buildSafeExtractionForSummary(codiceBase, estrazione) {
  if (!estrazione) return null;
  if (!["doc_ci", "doc_ts", "doc_residenza"].includes(codiceBase)) return estrazione;
  return { ...estrazione, dati_estratti: maskSensitiveIdentityFields(estrazione.dati_estratti || {}) };
}

async function getSummaryDoc(idCliente) {
  const snap = await admin.firestore().collection(COLLECTION).doc(idCliente).get();
  return snap.exists ? snap.data() : null;
}

async function saveSummaryDoc({
  idCliente,
  pipelineVersion,
  analysisKey,
  tipoDocumentoAtteso,
  classificazione,
  estrazione,
  decisioneBackend,
  review,
  ui,
  preparedFiles,
  decisionCode,
  resultCached,
  practiceSnapshot,
  practiceAnomalies,
}) {
  const payload = {
    aggiornatoIl: admin.firestore.FieldValue.serverTimestamp(),
    pipelineVersion,
    analysisKey,
    analysisResultCached: resultCached,
    tipoDocumento: tipoDocumentoAtteso,
    nomeDocumentoAtteso: tipoDocumentoAtteso,
    esitoValido: classificazione.valido,
    tipoDocumentoRilevato: classificazione.tipo_documento_rilevato,
    confidenza: classificazione.confidenza_classificazione,
    reviewManuale: review.reviewManuale,
    motiviReview: review.motiviReview,
    decisionCode,
    ui,
    classificazioneDocumento: classificazione,
    analisiDocumento: buildSafeExtractionForSummary(tipoDocumentoAtteso, estrazione),
    decisioneBackend: decisioneBackend || null,
    praticaRicostruita: practiceSnapshot || null,
    anomaliePratica: practiceAnomalies || null,
    fileMeta: buildFileMeta(preparedFiles),
  };
  await admin.firestore().collection(COLLECTION).doc(idCliente).set(payload, { merge: true });
}

async function saveAuditEntry({
  idCliente,
  pipelineVersion,
  analysisKey,
  tipoDocumentoAtteso,
  precheck,
  classificazione,
  retryClassificazione,
  estrazione,
  decisioneBackend,
  review,
  preparedFiles,
  decisionCode,
  practiceSnapshot,
  practiceAnomalies,
}) {
  await admin.firestore().collection(COLLECTION).doc(idCliente).collection("audit").add({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    timestampIso: nowIso(),
    pipelineVersion,
    analysisKey,
    tipoDocumentoAtteso,
    precheck,
    classificazione,
    retryClassificazione: retryClassificazione || null,
    estrazione: estrazione || null,
    decisioneBackend: decisioneBackend || null,
    review,
    decisionCode,
    praticaRicostruita: practiceSnapshot || null,
    anomaliePratica: practiceAnomalies || null,
    fileMeta: buildFileMeta(preparedFiles),
  });
}

async function upsertManualReview({ idCliente, tipoDocumentoAtteso, analysisKey, classificazione, estrazione, motiviReview, decisionCode }) {
  const docId = `${idCliente}_${analysisKey}`;
  await admin.firestore().collection(MANUAL_REVIEW_COLLECTION).doc(docId).set({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: "pending",
    idCliente,
    tipoDocumentoAtteso,
    analysisKey,
    decisionCode,
    motiviReview,
    classificazione,
    estrazione,
  }, { merge: true });
}

module.exports = { getSummaryDoc, saveSummaryDoc, saveAuditEntry, upsertManualReview };
