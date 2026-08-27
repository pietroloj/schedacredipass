const { MODELS, structuredCall } = require("./openaiClient");
const { stripNumericSuffix } = require("../utils/strings");
const { realEstateExtractionSchema } = require("../schemas/realEstateSchemas");

async function extractRealEstate({ tipoDocumentoAtteso, preparedFiles, practiceContext }) {
  const codiceBase = stripNumericSuffix(tipoDocumentoAtteso);
  const contentItems = preparedFiles.flatMap((f) => f.contentItems || []);

  return structuredCall({
    model: MODELS.MAIN,
    schemaName: "realestate_extraction",
    schema: realEstateExtractionSchema,
    systemText: `
Sei un perito immobiliare e analista legale senior per pratiche di mutuo.
Devi estrarre i dati immobiliari in modo letterale e verificabile per consentire controlli incrociati tra preliminare, atto di provenienza, visura, planimetria e APE.

REGOLE GENERALI:
- Compila tutti i campi previsti dallo schema quando il dato è realmente presente.
- Non dedurre né inventare indirizzi, importi, dati catastali, titolarità o vincoli.
- Se il documento contiene più immobili/subalterni, conserva l'informazione completa nei campi consentiti dallo schema.

1. IDENTIFICAZIONE IMMOBILE
- Estrai indirizzo e comune dell'immobile quando espressamente indicati.
- Estrai Foglio, Particella/Mappale, Subalterno, Categoria e Rendita in modo esatto.

2. SOGGETTI E DIRITTI
- Estrai intestatari, venditori, acquirenti e quote/diritti (proprietà, nuda proprietà, usufrutto ecc.) quando previsti dallo schema.

3. PREZZO, CAPARRA E OPERAZIONE
- Sul preliminare/proposta estrai il prezzo pattuito esatto e la caparra versata.
- Non confondere valore catastale, rendita, prezzo di vendita e valore di perizia.

4. PROVENIENZA E VINCOLI
- Sull'atto di provenienza identifica, se presente, compravendita, successione, donazione o altro titolo.
- Evidenzia ipoteche, servitù o vincoli solo quando risultano realmente dal documento e solo nei campi previsti dallo schema.

5. APE
- Estrai classe energetica e data/scadenza se presenti e previsti dallo schema.

${practiceContext}
`.trim(),
    userText: `Analizza il documento immobiliare richiesto come ${tipoDocumentoAtteso} (base ${codiceBase}). Dai priorità a indirizzo/comune, prezzo di compravendita, dati catastali, titolarità/provenienza e APE, usando esclusivamente i campi previsti dallo schema e solo dati realmente leggibili.`,
    contentItems,
  });
}

module.exports = { extractRealEstate };
