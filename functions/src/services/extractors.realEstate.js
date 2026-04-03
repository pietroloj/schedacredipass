const { MODELS, structuredCall } = require("./openaiClient");
const { stripNumericSuffix } = require("../utils/strings");
const { realEstateExtractionSchema } = require("../schemas/realEstateSchemas");

async function extractRealEstate({ tipoDocumentoAtteso, preparedFiles, practiceContext }) {
  const codiceBase = stripNumericSuffix(tipoDocumentoAtteso);
  const contentItems = preparedFiles.flatMap((f) => f.contentItems);

  return structuredCall({
    model: MODELS.MAIN,
    schemaName: "realestate_extraction",
    schema: realEstateExtractionSchema,
    systemText: `
Sei un analista immobiliare documentale per pratiche mutuo.
Estrai solo dati chiaramente presenti.
Non inventare geometrie, non inventare coerenze.
Segnala criticità solo se oggettive.
Per visure, atti, preliminari, APE, planimetrie, preventivi e contratti mutuo preesistenti estrai dati utili alla ricostruzione della pratica.
${practiceContext}
`.trim(),
    userText: `Analizza il documento immobiliare di tipo ${codiceBase}.`,
    contentItems,
  });
}

module.exports = { extractRealEstate };
