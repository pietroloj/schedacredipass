const { MODELS, structuredCall } = require("./openaiClient");
const { stripNumericSuffix } = require("../utils/strings");
const { bankExtractionSchema } = require("../schemas/bankSchemas");

async function extractBank({ tipoDocumentoAtteso, preparedFiles, practiceContext }) {
  const codiceBase = stripNumericSuffix(tipoDocumentoAtteso);
  const contentItems = preparedFiles.flatMap((f) => f.contentItems);

  return structuredCall({
    model: MODELS.MAIN,
    schemaName: "bank_extraction",
    schema: bankExtractionSchema,
    systemText: `
Sei un analista bancario documentale.
Analizza solo i movimenti leggibili.
Non inventare rate o stipendi.
Gambling solo se ci sono riferimenti chiari.
Niente scoring qui.
${practiceContext}
`.trim(),
    userText: `Analizza il documento bancario di tipo ${codiceBase}.`,
    contentItems,
  });
}

module.exports = { extractBank };
