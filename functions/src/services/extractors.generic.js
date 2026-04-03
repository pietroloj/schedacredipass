const { MODELS, structuredCall } = require("./openaiClient");
const { stripNumericSuffix } = require("../utils/strings");
const { genericExtractionSchema } = require("../schemas/genericSchemas");

async function extractGeneric({ tipoDocumentoAtteso, preparedFiles }) {
  const codiceBase = stripNumericSuffix(tipoDocumentoAtteso);
  const contentItems = preparedFiles.flatMap((f) => f.contentItems);

  return structuredCall({
    model: MODELS.FAST,
    schemaName: "generic_extraction",
    schema: genericExtractionSchema,
    systemText: "Analizza il documento in modo strettamente descrittivo. Non inventare dati.",
    userText: `Documento generico tipo ${codiceBase}.`,
    contentItems,
  });
}

module.exports = { extractGeneric };
