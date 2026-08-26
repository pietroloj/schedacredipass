const { MODELS, structuredCall } = require("./openaiClient");
const { stripNumericSuffix } = require("../utils/strings");
const { incomeExtractionSchema } = require("../schemas/incomeSchemas");

async function extractIncome({ tipoDocumentoAtteso, preparedFiles, practiceContext }) {
  const codiceBase = stripNumericSuffix(tipoDocumentoAtteso);
  const contentItems = preparedFiles.flatMap((f) => f.contentItems || []);

  return structuredCall({
    model: MODELS.MAIN,
    schemaName: "income_extraction",
    schema: incomeExtractionSchema,
    systemText: `
Sei un analista documentale senior per pratiche di mutuo.
Devi estrarre in modo letterale e prudente i dati presenti nel documento reddituale, senza inventare valori e senza effettuare la delibera finale.

REGOLE GENERALI:
- Compila tutti i campi previsti dallo schema quando il dato è realmente leggibile.
- Se un valore non è presente o non è leggibile, lascialo vuoto/null secondo lo schema.
- Non trasformare il lordo in netto e non stimare valori mancanti.
- Se sono visibili nome, cognome, codice fiscale, datore di lavoro, qualifica, data assunzione o tipo contratto, estraili nei campi previsti dallo schema.
- Segnala cessione del quinto, delega, pignoramenti o trattenute rilevanti solo se chiaramente presenti.

REGOLE PER CERTIFICAZIONE UNICA (CU/CUD E PENSIONI):
- reddito_lordo_annuo: usa l'importo esatto del Punto 1, Punto 2 o Punto 3 pertinente.
- giorni_lavorati: usa il Punto 6 o Punto 7 pertinente.
- irpef: Punto 21.
- addizionale_regionale: Punto 22.
- addizionale_comunale: somma, se previsti dallo schema e leggibili, Punto 26 + Punto 27 + Punto 29.
- Non confondere imponibile previdenziale, TFR, arretrati o somme soggette a tassazione separata con il reddito ordinario.

REGOLE PER BUSTA PAGA:
- estrai il netto mensile effettivamente pagato nel campo previsto dallo schema (es. netto_mensile_rilevato_documento).
- estrai eventuali trattenute per finanziamenti/cessioni/deleghe se chiaramente indicate.
- non usare il totale competenze come netto.

REGOLE PER MODELLO REDDITI / UNICO:
- estrai i valori fiscali solo dai quadri/campi effettivamente presenti e coerenti con lo schema.
- non sommare automaticamente componenti che potrebbero essere già comprese nel reddito complessivo.

${practiceContext}
`.trim(),
    userText: `Analizza il documento reddituale richiesto come ${tipoDocumentoAtteso} (base ${codiceBase}). Estrai tutti i dati previsti dallo schema che sono realmente visibili. Mantieni separati i dati documentali dalle eventuali informazioni presenti nel contesto pratica.`,
    contentItems,
  });
}

module.exports = { extractIncome };
