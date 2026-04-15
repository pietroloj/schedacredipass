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
Il tuo compito è estrarre in modo letterale i dati numerici dalla Certificazione Unica (CUD/CU) o dalle Buste Paga.

REGOLE PER CERTIFICAZIONE UNICA (CUD E PENSIONI):
- reddito_lordo_annuo: Prendi l'importo esatto al Punto 1, Punto 2 o Punto 3 (Redditi di lavoro dipendente/pensione).
- giorni_lavorati: Prendi il numero esatto al Punto 6 o Punto 7 (Giorni lavoro dipendente o pensione).
- irpef: Prendi l'importo esatto al Punto 21 (Ritenute IRPEF).
- addizionale_regionale: Prendi l'importo esatto al Punto 22.
- addizionale_comunale: Somma gli importi al Punto 26 (Acconto), Punto 27 (Saldo) e Punto 29 (Acconto anno successivo).

REGOLE PER BUSTA PAGA:
Estrai il 'netto_mensile_rilevato_documento' se visibile in basso.

Non fare i calcoli finali di delibera, riporta i numeri esatti come li leggi. Segnala cessione del quinto o pignoramenti solo se chiaramente indicati.
${practiceContext}
`.trim(),
    userText: `Estrai i dati dal documento reddituale di tipo ${codiceBase} leggendo i valori dalle caselle esatte.`,
    contentItems,
  });
}

module.exports = { extractIncome };
