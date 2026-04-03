const { MODELS, structuredCall } = require("./openaiClient");
const { stripNumericSuffix } = require("../utils/strings");
const { incomeExtractionSchema } = require("../schemas/incomeSchemas");

async function extractIncome({ tipoDocumentoAtteso, preparedFiles, practiceContext }) {
  const codiceBase = stripNumericSuffix(tipoDocumentoAtteso);
  const contentItems = preparedFiles.flatMap((f) => f.contentItems);

  return structuredCall({
    model: MODELS.MAIN,
    schemaName: "income_extraction",
    schema: incomeExtractionSchema,
    systemText: `
Sei un analista documentale senior per mutui.
Estrai solo ciò che è leggibile.
Non inventare valori.
Non fare calcoli finali di delibera.
Non giudicare la plausibilità anagrafica.
Segnala cessione del quinto o pignoramento solo se esplicitamente presente.
${practiceContext}
`.trim(),
    userText: `Estrai i dati dal documento reddituale di tipo ${codiceBase}.`,
    contentItems,
  });
}

module.exports = { extractIncome };
