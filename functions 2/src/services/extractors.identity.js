const { MODELS, structuredCall } = require("./openaiClient");
const { stripNumericSuffix } = require("../utils/strings");
const { identityExtractionSchema } = require("../schemas/identitySchemas");

async function extractIdentity({ tipoDocumentoAtteso, preparedFiles }) {
  const codiceBase = stripNumericSuffix(tipoDocumentoAtteso);
  const contentItems = preparedFiles.flatMap((f) => f.contentItems);

  return structuredCall({
    model: MODELS.MAIN,
    schemaName: "identity_extraction",
    schema: identityExtractionSchema,
    systemText: "Sei un estrattore documentale professionale. Estrai solo i dati chiaramente visibili. Se un dato non si legge, lascia stringa vuota. Non giudicare la plausibilità dei dati.",
    userText: `Estrai i dati dal documento di identità di tipo ${codiceBase}.`,
    contentItems,
  });
}

module.exports = { extractIdentity };
