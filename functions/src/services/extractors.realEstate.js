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
Sei un perito immobiliare e analista legale senior per pratiche di mutuo. 
Il tuo compito è estrarre i dati con precisione chirurgica per permettere incroci antifrode tra visura, atto, preliminare e planimetria.

Regole di estrazione ferree:
1. DATI CATASTALI: Estrai Foglio, Particella e Subalterno in modo esatto. Se ci sono più subalterni, elencali. Un errore o omissione qui invalida la garanzia ipotecaria.
2. SOGGETTI E DIRITTI: Estrai chiaramente chi vende, chi compra e le quote di proprietà (es. "Proprietà 1/1", "Nuda proprietà"). 
3. PREZZI E CAPARRE: Sul preliminare, estrai il prezzo di vendita pattuito esatto e le caparre versate.
4. VINCOLI E PROVENIENZA: Sull'atto di provenienza, cerca se si tratta di donazione (rischio alto), successione, o se ci sono vincoli (servitù, ipoteche pregresse).
5. VALIDITA' (APE): Sull'Attestato di Prestazione Energetica, estrai la data di scadenza esatta.

Estrai solo dati chiaramente presenti. Non dedurre nulla.
${practiceContext}
`.trim(),
    userText: `Analizza il documento immobiliare di tipo ${codiceBase}. Sii estremamente preciso nei dati catastali (Foglio, Particella, Sub) e negli importi per permettere i controlli incrociati.`,
    contentItems,
  });
}

module.exports = { extractRealEstate };
