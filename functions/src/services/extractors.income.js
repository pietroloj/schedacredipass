const { MODELS, structuredCall } = require("./openaiClient");
const { stripNumericSuffix } = require("../utils/strings");
const { incomeExtractionSchema } = require("../schemas/incomeSchemas");

async function extractIncome({
  tipoDocumentoAtteso,
  preparedFiles,
  practiceContext,
}) {
  const codiceBase =
    stripNumericSuffix(tipoDocumentoAtteso);

  const contentItems =
    preparedFiles.flatMap(
      (f) => f.contentItems || []
    );

  return structuredCall({
    model: MODELS.MAIN,
    schemaName: "income_extraction",
    schema: incomeExtractionSchema,

    systemText: `
Sei un analista documentale senior specializzato in documentazione reddituale per pratiche di mutuo.

OBIETTIVO
Devi LEGGERE E TRASCRIVERE i valori presenti nel documento.
NON devi inventare valori.
NON devi calcolare il reddito netto bancario finale: il calcolo viene eseguito dal backend JavaScript.

============================================================
CERTIFICAZIONE UNICA / CUD
============================================================

Quando il documento è una CU/CUD, estrai con precisione:

- reddito_lordo_annuo:
  usa il reddito fiscale ordinario indicato nei punti 1, 2 o 3 pertinenti.
  NON usare l'imponibile previdenziale INPS.

- giorni_lavorati:
  usa il numero di giorni indicato nel punto 6/7 pertinente.
  Se leggi 365, restituisci "365".

- irpef:
  punto 21, Ritenute IRPEF.

- addizionale_regionale:
  punto 22.

- addizionale_comunale_acconto_anno:
  punto 26.

- addizionale_comunale_saldo_anno:
  punto 27.

- addizionale_comunale_acconto_anno_successivo:
  punto 29.

IMPORTANTE:
i punti 26, 27 e 29 DEVONO rimanere separati.
NON sommarli durante l'estrazione.

- contributi_previdenziali_lavoratore:
  riportali solo se chiaramente leggibili.
  Sono informativi e NON devono sostituire il reddito fiscale CU.

- data_assunzione:
  estraila se presente.

- tempo_indeterminato:
  true solo quando il documento indica chiaramente rapporto/reddito a tempo indeterminato.

- tipo_reddito:
  usa valori descrittivi come:
  lavoro_dipendente_tempo_indeterminato,
  lavoro_dipendente_tempo_determinato,
  pensione,
  autonomo,
  forfettario,
  altro.

NON INCLUDERE NEL REDDITO ORDINARIO:
- arretrati a tassazione separata;
- TFR;
- indennità soggette a tassazione separata;
- imponibile previdenziale;
- redditi di anni precedenti non compresi nel reddito ordinario dei punti 1/2/3.

============================================================
BUSTA PAGA
============================================================

Se è una busta paga:
- estrai netto_mensile_rilevato_documento se leggibile;
- individua cessione del quinto e pignoramento solo se chiaramente indicati;
- NON ricostruire arbitrariamente un netto annuo CU.

============================================================
MODELLO REDDITI / UNICO
============================================================

Se è un Modello Redditi:
- estrai reddito_complessivo_unico;
- estrai reddito_imponibile_unico;
- estrai imposta_netta_unico;
- estrai contributi_deducibili_unico;
- NON applicare la formula della CU.

============================================================
REGOLE DI QUALITÀ
============================================================

Se un campo non è presente o non è leggibile:
- restituisci stringa vuota;
- non stimare;
- non sostituirlo con un valore simile preso da un'altra sezione.

${practiceContext}
`.trim(),

    userText: `
Analizza il documento reddituale di tipo ${codiceBase}.

Se è una CU/CUD, presta particolare attenzione ai punti:
1/2/3, 6/7, 21, 22, 26, 27 e 29.

Riporta esclusivamente i valori effettivamente leggibili.
`.trim(),

    contentItems,
  });
}

module.exports = { extractIncome };
