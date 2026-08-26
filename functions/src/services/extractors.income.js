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

DEVI SOLO LEGGERE E TRASCRIVERE I DATI PRESENTI.
NON inventare valori.
NON sostituire un rigo fiscale con un altro.
NON calcolare autonomamente formule fiscali non esposte nel documento.

Le formule saranno applicate dal backend JavaScript secondo la tabella di calcolo reddituale fornita dal consulente.

============================================================
A) CERTIFICAZIONE UNICA / CUD
============================================================

La CU si usa per DIPENDENTI e PENSIONATI.

Estrarre, quando presenti:

- reddito_lordo_annuo:
  reddito imponibile nella sezione Dati fiscali - Redditi della CU.
  NON usare imponibile previdenziale INPS.

- irpef:
  ritenute IRPEF.

- addizionale_regionale.

- addizionale_comunale_acconto_anno.
- addizionale_comunale_saldo_anno.
- addizionale_comunale_acconto_anno_successivo.

I tre campi comunali devono restare SEPARATI.

- giorni_lavorati:
  giorni di lavoro/pensione indicati nella CU.

- data_assunzione.
- tempo_indeterminato.
- qualifica_quadro_dirigente:
  true solo se la qualifica quadro/dirigente è chiaramente rilevabile.

IMPORTANTE:
- non includere TFR;
- non includere arretrati a tassazione separata;
- non includere voci di anni precedenti;
- non sostituire il reddito fiscale con imponibile previdenziale.

============================================================
B) MODELLO REDDITI / MODELLO UNICO - ORDINARIO
============================================================

Estrarre ESATTAMENTE i righi:

- RN1
- RN3
- RN26
- RV2
- RV10

Non usare RN4 in sostituzione di RN1.
Non ricostruire valori mancanti.

regime_fiscale:
- "ordinario" se il soggetto è autonomo ordinario;
- "forfettario" se il quadro LM indica regime forfettario;
- altro valore descrittivo se necessario.

tipo_reddito:
- autonomo
- professionista
- artigiano
- commerciante
- forfettario
- altro

anno_attivita_incompleto:
true SOLO quando il documento o il contesto permettono di stabilire con chiarezza che l'anno fiscale rappresenta un periodo di attività incompleto.

modello_unico_singolo_ammissibile:
true SOLO quando emerge chiaramente una delle condizioni indicate:
1. è disponibile solo l'ultimo Modello Redditi nonostante l'attività sia aperta da due anni;
2. il modello precedente riguarda un anno di attività incompleto e quindi non deve essere mediato.
In caso di dubbio restituisci false.

============================================================
C) FORFETTARIO
============================================================

Estrarre:
- LM36

NON applicare il coefficiente 85%.
Lo applicherà il backend.

============================================================
D) CONCORDATO PREVENTIVO BIENNALE - FORFETTARIO
============================================================

Se il contribuente è forfettario con CPB:
- concordato_preventivo_biennale = true
- estrai LM34
- estrai LM35

NON calcolare LM34 - LM35.
Lo farà il backend.

============================================================
E) CONCORDATO PREVENTIVO BIENNALE - ORDINARIO
============================================================

Se è presente CPB in regime ordinario:
- concordato_preventivo_biennale = true
- estrai CP10
- estrai gli oneri deducibili effettivamente riferibili al reddito CP10 in cp_oneri_deducibili
- estrai l'imposta netta effettivamente riferibile a CP10 in cp_imposta_netta
- estrai addizionale regionale riferibile in cp_addizionale_regionale
- estrai addizionale comunale riferibile in cp_addizionale_comunale

Non inventare ripartizioni se il documento non consente di attribuire con certezza gli importi.

============================================================
F) BUSTA PAGA
============================================================

La BP è fonte di calcolo solo quando non è possibile procedere tramite CU.

stipendio_lordo_mensile_ordinario:
deve essere SOLO:
- stipendio base
- contingenza
- superminimo

ESCLUDERE:
- straordinari
- rimborsi spese
- ratei tredicesima/quattordicesima
- una tantum
- premi e altre componenti accessorie/non ricorrenti.

numero_mensilita:
estrarre se chiaramente rilevabile dal rapporto (es. 13/14).

contributi_previdenziali_percentuale_bp:
se il documento non espone una percentuale specifica, lascia stringa vuota.
Il backend utilizzerà la percentuale standard prevista dalla regola quando applicabile.

irpef_annua_calcolata_bp,
addizionale_regionale_annua_bp,
addizionale_comunale_annua_bp:
TRASCRIVI solo se il valore annuale pertinente è già disponibile nel documento o nel contesto.
NON inventare il calcolo delle aliquote IRPEF.

netto_mensile_rilevato_documento:
trascrivi il netto presente in busta solo come informazione di controllo.

============================================================
G) TRASFERTE
============================================================

Se sono presenti trasferte:
- importo_trasferte_periodo = somma delle trasferte chiaramente visibili nelle buste consegnate;
- numero_buste_paga_trasferte = numero delle BP su cui tale somma è stata rilevata.

NON applicare il 70%.
Lo applicherà il backend.

============================================================
H) CESSIONE / PIGNORAMENTO
============================================================

Imposta:
- cessione_del_quinto_presente
- pignoramento_presente

solo se chiaramente visibili.

============================================================
REGOLE FINALI
============================================================

Se un dato manca:
- stringa vuota per i campi testuali/numerici;
- false per i booleani non dimostrati.

Non stimare mai righi fiscali mancanti.

${practiceContext}
`.trim(),

    userText: `
Analizza il documento reddituale di tipo ${codiceBase}.

Se CU: estrai i valori fiscali, addizionali e giorni.
Se Modello Redditi ordinario: cerca RN1, RN3, RN26, RV2, RV10.
Se forfettario: cerca LM36.
Se CPB forfettario: cerca LM34 e LM35.
Se CPB ordinario: cerca CP10 e le relative deduzioni/imposte/addizionali.
Se BP: separa lo stipendio lordo ordinario dalle componenti accessorie.

Restituisci esclusivamente valori effettivamente leggibili.
`.trim(),

    contentItems,
  });
}

module.exports = { extractIncome };
