const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const OpenAI = require("openai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const COLLECTION_SOURCES = "bank_policy_sources";
const COLLECTION_RUNS = "bank_policy_import_runs";
const COLLECTION_POLICIES = "bank_policies";
const PIPELINE_VERSION = "v1.0.0";

function nowIso() {
  return new Date().toISOString();
}

function safeString(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function normalizeMonth(value) {
  const v = safeString(value);
  if (!/^\d{4}-\d{2}$/.test(v)) {
    throw new Error("sourceMonth deve essere nel formato YYYY-MM");
  }
  return v;
}

function makePolicyDocId({ bancaKey, prodottoKey, version }) {
  const clean = (s) =>
    safeString(s)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");

  return `${clean(bancaKey)}_${clean(prodottoKey)}_${clean(version)}`;
}

function fileExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

function tempPathForName(fileName) {
  return path.join(os.tmpdir(), `${Date.now()}_${path.basename(fileName)}`);
}

function toIsoDateFromMonth(sourceMonth) {
  return `${sourceMonth}-01`;
}

function inferMimeType(filePath) {
  const ext = fileExtension(filePath);
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".csv") return "text/csv";
  if (ext === ".txt") return "text/plain";
  if (ext === ".json") return "application/json";
  if (ext === ".xlsx")
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".xls") return "application/vnd.ms-excel";
  return "application/octet-stream";
}

function buildImportRunId({ bancaKey, sourceMonth }) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `run_${bancaKey}_${sourceMonth}_${ts}`;
}

function isSpreadsheet(filePath) {
  const ext = fileExtension(filePath);
  return ext === ".xlsx" || ext === ".xls" || ext === ".csv";
}

async function downloadStorageFile(storagePath) {
  const tempPath = tempPathForName(storagePath);
  await bucket.file(storagePath).download({ destination: tempPath });
  return tempPath;
}

function convertSpreadsheetToCsvText(localPath) {
  const ext = fileExtension(localPath);

  if (ext === ".csv") {
    return fs.readFileSync(localPath, "utf8");
  }

  const workbook = XLSX.readFile(localPath);
  const pieces = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    pieces.push(`### SHEET: ${sheetName}\n${csv}`);
  }

  return pieces.join("\n\n");
}

async function uploadTextAsOpenAIFile({ text, baseName }) {
  const tempPath = path.join(os.tmpdir(), `${Date.now()}_${baseName}.txt`);
  fs.writeFileSync(tempPath, text, "utf8");

  try {
    const uploaded = await client.files.create({
      file: fs.createReadStream(tempPath),
      purpose: "user_data",
    });

    return uploaded;
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}
  }
}

async function uploadBinaryFileToOpenAI(localPath) {
  const uploaded = await client.files.create({
    file: fs.createReadStream(localPath),
    purpose: "user_data",
  });
  return uploaded;
}

async function prepareOpenAIInputFromStoragePath(storagePath) {
  const localPath = await downloadStorageFile(storagePath);

  try {
    if (isSpreadsheet(storagePath)) {
      const csvText = convertSpreadsheetToCsvText(localPath);
      const uploaded = await uploadTextAsOpenAIFile({
        text: csvText,
        baseName: path.basename(storagePath),
      });

      return {
        storagePath,
        localPath,
        openaiFileId: uploaded.id,
        kind: "spreadsheet_as_text",
        mimeType: "text/plain",
        originalMimeType: inferMimeType(storagePath),
      };
    }

    const uploaded = await uploadBinaryFileToOpenAI(localPath);

    return {
      storagePath,
      localPath,
      openaiFileId: uploaded.id,
      kind: "binary_file",
      mimeType: inferMimeType(storagePath),
      originalMimeType: inferMimeType(storagePath),
    };
  } finally {
    try {
      fs.unlinkSync(localPath);
    } catch (_) {}
  }
}

async function createPolicySourceDocs({
  bancaKey,
  bancaNome,
  sourceMonth,
  storagePaths,
  importRunId,
}) {
  const batch = db.batch();
  const createdIds = [];

  for (const storagePath of storagePaths) {
    const ref = db.collection(COLLECTION_SOURCES).doc();
    createdIds.push(ref.id);

    batch.set(ref, {
      bancaKey,
      bancaNome,
      fileName: path.basename(storagePath),
      fileType: fileExtension(storagePath).replace(".", ""),
      storagePath,
      sourceMonth,
      status: "uploaded",
      importRunId,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      pipelineVersion: PIPELINE_VERSION,
    });
  }

  await batch.commit();
  return createdIds;
}

async function createImportRun({
  runId,
  bancaKey,
  bancaNome,
  sourceMonth,
  storagePaths,
}) {
  await db.collection(COLLECTION_RUNS).doc(runId).set({
    runId,
    bancaKey,
    bancaNome,
    sourceMonth,
    sourceFiles: storagePaths.map((p) => path.basename(p)),
    storagePaths,
    status: "pending",
    createdPolicies: [],
    disabledPolicies: [],
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    pipelineVersion: PIPELINE_VERSION,
  });
}

async function completeImportRun({
  runId,
  createdPolicies,
  disabledPolicies,
}) {
  await db.collection(COLLECTION_RUNS).doc(runId).set(
    {
      status: "completed",
      createdPolicies,
      disabledPolicies,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function failImportRun({
  runId,
  errorMessage,
}) {
  await db.collection(COLLECTION_RUNS).doc(runId).set(
    {
      status: "failed",
      errorMessage,
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function disablePreviousPolicies({
  bancaKey,
  prodottoKey,
  newPolicyDocId,
  sourceMonth,
}) {
  const q = await db
    .collection(COLLECTION_POLICIES)
    .where("bancaKey", "==", bancaKey)
    .where("prodottoKey", "==", prodottoKey)
    .where("active", "==", true)
    .get();

  const batch = db.batch();
  const disabled = [];

  q.forEach((doc) => {
    if (doc.id === newPolicyDocId) return;

    disabled.push(doc.id);
    batch.set(
      doc.ref,
      {
        active: false,
        validTo: `${sourceMonth}-01`,
        supersededByPolicyId: newPolicyDocId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  if (disabled.length) {
    await batch.commit();
  }

  return disabled;
}

function buildPolicyExtractionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      bancaKey: { type: "string" },
      bancaNome: { type: "string" },
      sourceMonth: { type: "string" },
      policies: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            prodottoKey: { type: "string" },
            prodottoNome: { type: "string" },
            finalita: {
              type: "array",
              items: { type: "string" },
            },
            targetClienti: {
              type: "array",
              items: { type: "string" },
            },
            priorita: { type: "integer" },
            thresholds: {
              type: "object",
              additionalProperties: false,
              properties: {
                ltvMax: { type: ["number", "null"] },
                dtiWarning: { type: ["number", "null"] },
                dtiMax: { type: ["number", "null"] },
                rataMinResiduaEuro: { type: ["number", "null"] },
                redditoMinNettoMensile: { type: ["number", "null"] },
                etaMaxFinePiano: { type: ["number", "null"] },
              },
              required: [
                "ltvMax",
                "dtiWarning",
                "dtiMax",
                "rataMinResiduaEuro",
                "redditoMinNettoMensile",
                "etaMaxFinePiano",
              ],
            },
            requiredDocuments: {
              type: "array",
              items: { type: "string" },
            },
            hardRules: {
              type: "object",
              additionalProperties: false,
              properties: {
                requireIdentityMatch: { type: "boolean" },
                requireCatastoMatch: { type: "boolean" },
                requireAttoPreliminareMatch: { type: "boolean" },
                requireApeIfAcquisto: { type: "boolean" },
                allowRistrutturazione: { type: "boolean" },
                allowSurroga: { type: "boolean" },
              },
              required: [
                "requireIdentityMatch",
                "requireCatastoMatch",
                "requireAttoPreliminareMatch",
                "requireApeIfAcquisto",
                "allowRistrutturazione",
                "allowSurroga",
              ],
            },
            preferences: {
              type: "object",
              additionalProperties: false,
              properties: {
                preferTempoIndeterminato: { type: "boolean" },
                allowCessioneQuinto: { type: "boolean" },
                allowPignoramento: { type: "boolean" },
                allowAdditionalLoans: { type: "boolean" },
                preferLowLtv: { type: "boolean" },
                preferCleanBankFlows: { type: "boolean" },
              },
              required: [
                "preferTempoIndeterminato",
                "allowCessioneQuinto",
                "allowPignoramento",
                "allowAdditionalLoans",
                "preferLowLtv",
                "preferCleanBankFlows",
              ],
            },
            scoringWeights: {
              type: "object",
              additionalProperties: false,
              properties: {
                base: { type: "integer" },
                ltvBonusUnder60: { type: "integer" },
                ltvBonusUnder80: { type: "integer" },
                dtiBonusUnder30: { type: "integer" },
                dtiBonusUnder35: { type: "integer" },
                tempoIndeterminatoBonus: { type: "integer" },
                anzianitaBonusOver5: { type: "integer" },
                bankCleanBonus: { type: "integer" },
                cessioneQuintoPenalty: { type: "integer" },
                pignoramentoPenalty: { type: "integer" },
                gamblingPenalty: { type: "integer" },
                missingRequiredDocumentPenalty: { type: "integer" },
                blockingAnomalyPenalty: { type: "integer" },
              },
              required: [
                "base",
                "ltvBonusUnder60",
                "ltvBonusUnder80",
                "dtiBonusUnder30",
                "dtiBonusUnder35",
                "tempoIndeterminatoBonus",
                "anzianitaBonusOver5",
                "bankCleanBonus",
                "cessioneQuintoPenalty",
                "pignoramentoPenalty",
                "gamblingPenalty",
                "missingRequiredDocumentPenalty",
                "blockingAnomalyPenalty",
              ],
            },
            notesTemplate: {
              type: "object",
              additionalProperties: false,
              properties: {
                strengths: {
                  type: "array",
                  items: { type: "string" },
                },
                weaknesses: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["strengths", "weaknesses"],
            },
            policySource: {
              type: "object",
              additionalProperties: false,
              properties: {
                sourceType: { type: "string" },
                sourceLabel: { type: "string" },
                version: { type: "string" },
                updatedAt: { type: "string" },
              },
              required: ["sourceType", "sourceLabel", "version", "updatedAt"],
            },
          },
          required: [
            "prodottoKey",
            "prodottoNome",
            "finalita",
            "targetClienti",
            "priorita",
            "thresholds",
            "requiredDocuments",
            "hardRules",
            "preferences",
            "scoringWeights",
            "notesTemplate",
            "policySource",
          ],
        },
      },
    },
    required: ["bancaKey", "bancaNome", "sourceMonth", "policies"],
  };
}

async function extractPoliciesWithAI({
  bancaKey,
  bancaNome,
  sourceMonth,
  preparedInputs,
}) {
  const contentItems = [];

  for (const file of preparedInputs) {
    contentItems.push({
      type: "input_text",
      text: `Fonte policy: ${file.storagePath} | kind: ${file.kind} | originalMimeType: ${file.originalMimeType}`,
    });
    contentItems.push({
      type: "input_file",
      file_id: file.openaiFileId,
    });
  }

  const response = await client.responses.create({
    model: "gpt-5.4",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `
Sei un estrattore di policy bancarie per mutui.

OBIETTIVO:
- leggere uno o più file sorgente banca
- estrarre le policy in formato strutturato
- NON inventare soglie o regole che non compaiono chiaramente
- se una soglia non è chiara, metti null
- se ci sono più prodotti, crea più elementi nell'array policies
- usa chiavi pulite e coerenti
- mantieni finalita tra: acquisto, surroga, ristrutturazione, acquisto_ristrutturazione, liquidita, altro
- per sourceType usa:
  - official_bank_policy
  - internal_operating_rule
  - temporary_calibrated_rule
- se il file è ambiguo ma sembra banca/prodotto, estrai in modo prudente
- NON fare raccomandazioni commerciali
- restituisci solo dati strutturati
            `.trim(),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
Banca attesa: ${bancaNome}
bancaKey attesa: ${bancaKey}
sourceMonth atteso: ${sourceMonth}

Estrai una o più policy dai file allegati.
            `.trim(),
          },
          ...contentItems,
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "bank_policy_import",
        strict: true,
        schema: buildPolicyExtractionSchema(),
      },
    },
  });

  return JSON.parse(response.output_text);
}

async function saveExtractedPolicies({
  extracted,
  bancaKey,
  bancaNome,
  sourceMonth,
  importRunId,
  sourceDocIds,
  storagePaths,
}) {
  const createdPolicies = [];
  const disabledPolicies = [];

  for (const policy of extracted.policies || []) {
    const docId = makePolicyDocId({
      bancaKey,
      prodottoKey: policy.prodottoKey,
      version: sourceMonth.replace(/-/g, "_"),
    });

    const disabled = await disablePreviousPolicies({
      bancaKey,
      prodottoKey: policy.prodottoKey,
      newPolicyDocId: docId,
      sourceMonth,
    });

    disabledPolicies.push(...disabled);

    await db.collection(COLLECTION_POLICIES).doc(docId).set({
      active: true,
      bancaKey,
      bancaNome,
      prodottoKey: policy.prodottoKey,
      prodottoNome: policy.prodottoNome,
      finalita: policy.finalita || [],
      targetClienti: policy.targetClienti || [],
      priorita: policy.priorita ?? 50,
      thresholds: policy.thresholds || {},
      requiredDocuments: policy.requiredDocuments || [],
      hardRules: policy.hardRules || {},
      preferences: policy.preferences || {},
      scoringWeights: policy.scoringWeights || {},
      notesTemplate: policy.notesTemplate || {
        strengths: [],
        weaknesses: [],
      },
      policySource: {
        ...(policy.policySource || {}),
        version: safeString(policy.policySource?.version || sourceMonth),
        updatedAt: safeString(policy.policySource?.updatedAt || nowIso().slice(0, 10)),
      },
      sourceMonth,
      version: sourceMonth,
      validFrom: toIsoDateFromMonth(sourceMonth),
      validTo: null,
      sourceFileIds: sourceDocIds,
      sourceStoragePaths: storagePaths,
      importRunId,
      pipelineVersion: PIPELINE_VERSION,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    createdPolicies.push(docId);
  }

  return {
    createdPolicies,
    disabledPolicies: Array.from(new Set(disabledPolicies)),
  };
}

const importaPolicyBancarieDaFileVersionata = onCall(
  { secrets: ["OPENAI_API_KEY"] },
  async (request) => {
    const data = request.data || {};

    const bancaKey = safeString(data.bancaKey).toLowerCase();
    const bancaNome = safeString(data.bancaNome);
    const sourceMonth = normalizeMonth(data.sourceMonth);
    const storagePaths = Array.isArray(data.storagePaths)
      ? data.storagePaths.map((x) => safeString(x)).filter(Boolean)
      : [];

    if (!bancaKey) {
      throw new HttpsError("invalid-argument", "bancaKey mancante.");
    }

    if (!bancaNome) {
      throw new HttpsError("invalid-argument", "bancaNome mancante.");
    }

    if (!storagePaths.length) {
      throw new HttpsError("invalid-argument", "storagePaths vuoto.");
    }

    const importRunId = buildImportRunId({ bancaKey, sourceMonth });

    try {
      await createImportRun({
        runId: importRunId,
        bancaKey,
        bancaNome,
        sourceMonth,
        storagePaths,
      });

      const sourceDocIds = await createPolicySourceDocs({
        bancaKey,
        bancaNome,
        sourceMonth,
        storagePaths,
        importRunId,
      });

      const preparedInputs = [];
      for (const storagePath of storagePaths) {
        const prepared = await prepareOpenAIInputFromStoragePath(storagePath);
        preparedInputs.push(prepared);
      }

      const extracted = await extractPoliciesWithAI({
        bancaKey,
        bancaNome,
        sourceMonth,
        preparedInputs,
      });

      const { createdPolicies, disabledPolicies } = await saveExtractedPolicies({
        extracted,
        bancaKey,
        bancaNome,
        sourceMonth,
        importRunId,
        sourceDocIds,
        storagePaths,
      });

      const batch = db.batch();
      for (const sourceDocId of sourceDocIds) {
        const ref = db.collection(COLLECTION_SOURCES).doc(sourceDocId);
        batch.set(
          ref,
          {
            status: "imported",
            linkedPolicies: createdPolicies,
            importedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();

      await completeImportRun({
        runId: importRunId,
        createdPolicies,
        disabledPolicies,
      });

      return {
        ok: true,
        importRunId,
        bancaKey,
        bancaNome,
        sourceMonth,
        createdPolicies,
        disabledPolicies,
        importedSourceDocs: sourceDocIds,
      };
    } catch (error) {
      await failImportRun({
        runId: importRunId,
        errorMessage: error?.message || "Errore sconosciuto",
      });

      throw new HttpsError(
        "internal",
        error?.message || "Errore durante l'import delle policy bancarie."
      );
    }
  }
);

module.exports = {
  importaPolicyBancarieDaFileVersionata,
};
