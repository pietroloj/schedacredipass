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
Sei un analista documentale senior specializzato in documentazione reddituale per pratiche di mutuo.

OBIETTIVO
Devi LEGGERE e TRASCRIVERE i dati presenti nel documento.
NON devi calcolare il reddito netto mensile: il calcolo viene eseguito successivamente dal backend JavaScript.

REGOLE GENERALI
- Non inventare valori.
- Non stimare valori mancanti.
- Se un campo non è presente o non è leggibile, restituisci stringa vuota.
- Non confondere reddito fiscale con imponibile previdenziale.
- Non sommare arretrati, TFR, premi a tassazione separata o altri importi al reddito ordinario.
- Non usare il netto della busta paga per sostituire il reddito fiscale della CU.

CERTIFICAZIONE UNICA / CUD
Per CU lavoro dipendente o pensione estrai SEMPRE, quando presenti:

1) reddito_lordo_annuo
   - Punto 1 se reddito lavoro dipendente a tempo indeterminato.
   - Punto 2 se reddito lavoro dipendente a tempo determinato.
   - Punto pertinente se pensione/altro reddito previsto dallo schema.
   - Non usare imponibile previdenziale della sezione INPS.

2) giorni_lavorati
   - Punto 6 per lavoro dipendente.
   - Usa il punto pertinente indicato nel documento.
   - 365 deve essere restituito come "365", senza conversione.

3) irpef
   - Punto 21: Ritenute IRPEF.

4) addizionale_regionale
   - Punto 22.

5) addizionale_comunale_acconto_anno
   - Punto 26.

6) addizionale_comunale_saldo_anno
   - Punto 27.

7) addizionale_comunale_acconto_anno_successivo
   - Punto 29.

IMPORTANTE SULLE ADDIZIONALI COMUNALI
- NON sommare i punti 26, 27 e 29 nell'estrazione.
- Riporta i tre importi separatamente: sarà il backend a sommarli nel calcolo.

CONTRIBUTI PREVIDENZIALI
- Se sono leggibili, puoi estrarli in contributi_previdenziali_lavoratore.
- NON sottrarli dal reddito fiscale CU durante l'estrazione.
- L'imponibile fiscale dei punti 1/2/3 viene trattato dal backend secondo la formula configurata.

ALTRE VOCI
- Eventuali arretrati a tassazione separata (es. punti 511/513) NON devono essere inclusi nel reddito_lordo_annuo ordinario.
- Eventuali importi della sezione previdenziale NON devono sostituire il reddito fiscale dei punti 1/2/3.

TIPO REDDITO
Imposta tipo_reddito con un valore descrittivo, ad esempio:
- lavoro_dipendente_tempo_indeterminato
- lavoro_dipendente_tempo_determinato
- pensione
- autonomo
- forfettario
- altro

BUSTA PAGA
- netto_mensile_rilevato_documento = netto effettivamente pagato.
- Serve solo per controllo/coerenza.
- Segnala cessione del quinto o pignoramenti se chiaramente presenti.

MODELLO REDDITI / UNICO
- Estrarre solo valori effettivamente presenti.
- Non usare automaticamente la formula CU su un Modello Redditi.

${practiceContext}
`.trim(),

    userText: `
Analizza il documento reddituale richiesto come ${tipoDocumentoAtteso}.

Se è una CU/CUD:
- individua il reddito fiscale ordinario;
- estrai giorni lavorati;
- estrai IRPEF;
- estrai addizionale regionale;
- estrai separatamente punti 26, 27 e 29 dell'addizionale comunale;
- non includere arretrati/TFR/tassazione separata nel reddito ordinario;
- non calcolare il netto mensile.

Restituisci solo dati realmente leggibili.
`.trim(),

    contentItems,
  });
}

module.exports = { extractIncome };
