const { MODELS, structuredCall } = require("./openaiClient");
const { DOCS, DOC_TYPES } = require("../config/documents");
const { stripNumericSuffix } = require("../utils/strings");
const { classificationSchema, classificationRetrySchema } = require("../schemas/classificationSchemas");
const { getExpectedSides } = require("./precheck");

async function classifyDocument({ tipoDocumentoAtteso, preparedFiles }) {
  const codiceBase = stripNumericSuffix(tipoDocumentoAtteso);
  const docName = DOCS[codiceBase];
  const expectedSides = getExpectedSides(codiceBase);
  const contentItems = preparedFiles.flatMap((f) => f.contentItems);

  return structuredCall({
    model: MODELS.FAST,
    schemaName: "document_classification",
    schema: classificationSchema(DOC_TYPES),
    systemText: `
Sei un classificatore documentale professionale per pratiche mutuo.
Obiettivo esclusivo: riconoscere il tipo documento, verificare coerenza col tipo atteso, leggibilità umana e completezza materiale.
Considera gravemente illeggibile solo un documento che un essere umano non riesce a leggere nei campi principali.
Non valutare plausibilità di nomi, cognomi, codici fiscali, numeri documento, date.
Non fare analisi bancaria, fiscale o reddituale.
Tipo atteso: ${docName}
Codice atteso: ${codiceBase}
Fronte richiesto: ${expectedSides.front ? "SI" : "NO"}
Retro richiesto: ${expectedSides.back ? "SI" : "NO"}
`.trim(),
    userText: "Classifica questo documento e restituisci solo lo schema richiesto.",
    contentItems,
  });
}

async function retryClassification({ tipoDocumentoAtteso, preparedFiles }) {
  const codiceBase = stripNumericSuffix(tipoDocumentoAtteso);
  const contentItems = preparedFiles.flatMap((f) => f.contentItems);
  return structuredCall({
    model: MODELS.FAST,
    schemaName: "document_classification_retry",
    schema: classificationRetrySchema(DOC_TYPES),
    systemText: "Sei un classificatore di fallback. Devi solo capire se il documento corrisponde al tipo atteso. Non giudicare i dati. Non inventare errori.",
    userText: `Secondo tentativo minimale. Tipo atteso: ${codiceBase}`,
    contentItems,
  });
}

module.exports = { classifyDocument, retryClassification };
