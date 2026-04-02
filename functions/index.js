const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { OpenAI } = require("openai");

admin.initializeApp();
const db = admin.firestore();

// MODIFICA CHIAVE: runWith({ secrets: ["OPENAI_API_KEY"] }) dice a Google di caricare la chiave prima di eseguire
exports.analizzaDocumentoAI = functions.runWith({ secrets: ["OPENAI_API_KEY"] }).https.onCall(async (data, context) => {
    
    // Inizializza OpenAI QUI DENTRO, così può leggere la chiave segreta caricata da Firebase
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const {
        urlFileBase64,
        tipoDocumentoAtteso,
        idCliente,
        importoMutuo = null,
        valoreImmobile = null,
        rataMutuoStimata = null,
        rateAltriFinanziamenti = null,
        durataAnni = null,
        prodottoBancario = null,
        finalitaMutuo = null,
        notePratica = null
    } = data || {};

    if (!urlFileBase64) {
        throw new functions.https.HttpsError("invalid-argument", "Nessun file inviato.");
    }

    if (!tipoDocumentoAtteso) {
        throw new functions.https.HttpsError("invalid-argument", "Tipo documento mancante.");
    }

    if (!idCliente) {
        throw new functions.https.HttpsError("invalid-argument", "ID cliente mancante.");
    }

    try {
        const NOMI_DOCUMENTI = {
            doc_ci: "Carta d'Identità",
            doc_ts: "Tessera Sanitaria / Codice Fiscale",
            doc_residenza: "Certificato Cumulativo / Residenza",
            doc_bustepaga: "Busta Paga",
            doc_cud: "Certificazione Unica (CU/CUD)",
            doc_unici: "Modello Redditi / Unico",
            doc_visura: "Visura Camerale",
            doc_f24: "Modello F24 Pagato",
            doc_ec: "Estratto Conto Bancario",
            doc_mov: "Lista Movimenti Bancari",
            doc_matrimonio: "Atto di Matrimonio",
            doc_atto: "Atto di Provenienza Immobile",
            doc_planimetria: "Planimetria / Visura Catastale",
            doc_preliminare: "Preliminare di Acquisto",
            doc_preventivo: "Preventivo Lavori",
            doc_mutuo_pre: "Atto di Mutuo in Corso",
            doc_prestiti: "Conteggi Estintivi / Finanziamenti",
            doc_ape: "Attestato di Prestazione Energetica (APE)",
            doc_isee: "Attestazione ISEE"
        };

        const codiceBase = String(tipoDocumentoAtteso).replace(/[0-9]/g, "");
        const nomeDocumentoAtteso = NOMI_DOCUMENTI[codiceBase] || "Documento Pratica Mutuo";

        const contestoMutuo = `
CONTESTO PRATICA MUTUO (se disponibili):
- Importo mutuo richiesto: ${importoMutuo ?? "NON RILEVATO"}
- Valore immobile: ${valoreImmobile ?? "NON RILEVATO"}
- Rata mutuo stimata: ${rataMutuoStimata ?? "NON RILEVATO"}
- Rate altri finanziamenti: ${rateAltriFinanziamenti ?? "NON RILEVATO"}
- Durata anni: ${durataAnni ?? "NON RILEVATO"}
- Prodotto bancario: ${prodottoBancario ?? "NON RILEVATO"}
- Finalità mutuo: ${finalitaMutuo ?? "NON RILEVATO"}
- Note pratica: ${notePratica ?? "NON RILEVATO"}
`;

        let promptAI = `
Analizza questa immagine/documento.

Il cliente doveva caricare ESATTAMENTE questo documento:
"${nomeDocumentoAtteso}"

REGOLE GENERALI OBBLIGATORIE:
1. Verifica che il documento sia coerente con il tipo atteso.
2. Verifica che sia leggibile e sufficientemente completo.
3. NON inventare MAI dati mancanti.
4. Se un dato non è presente o non è leggibile, scrivi "NON RILEVATO".
5. Se il documento è tagliato, incompleto, sfocato o non coerente, imposta "valido": false.
6. Se il documento non è valido, spiega il motivo in modo chiaro e breve per il cliente.
`;

        if (["doc_cud", "doc_unici", "doc_bustepaga"].includes(codiceBase)) {
            promptAI += `
${contestoMutuo}

AGISCI come un DELIBERANTE CREDITIZIO SENIOR di una banca italiana specializzato in MUTUI IMMOBILIARI.

Devi ragionare come un ufficio deliberante reale:
- prudente
- tecnico
- realistico
- non commerciale

OBIETTIVI:
1. Riconoscere il tipo documento
2. Estrarre i dati reddituali utili
3. Calcolare il REDDITO BANCARIO MENSILE
4. Valutare criticità reddituali
5. Calcolare SCORING BANCARIO 0-100
6. Restituire una PRE-DELIBERA MUTUO

REGOLE REDDITUALI:
- Se BUSTA PAGA:
  - individua netto mensile
  - segnala cessioni del quinto, pignoramenti, trattenute anomale, variabili
  - usa approccio prudenziale sulle voci variabili
- Se CUD / CU:
  - individua anno fiscale, reddito complessivo, imponibile, eventuali dati utili
  - stima il reddito bancario mensile in modo prudenziale
- Se MODELLO REDDITI / UNICO:
  - individua reddito complessivo / imponibile / reddito professionale o impresa
  - applica approccio prudenziale con riduzione 20%-30% se opportuno
  - segnala instabilità o oscillazioni se emergono
- NON usare logica da commercialista: usa logica bancaria

SCORING BANCARIO:
Calcola uno score da 0 a 100 considerando:
- qualità e stabilità del reddito
- tipologia contrattuale
- eventuali trattenute
- rata mutuo stimata vs reddito
- presenza di altri finanziamenti
- LTV se calcolabile
- rischio complessivo percepito

SOGLIE ORIENTATIVE:
- 85-100 = APPROVATO
- 70-84 = APPROVATO CON RISERVE
- 50-69 = RISCHIO
- sotto 50 = NON FINANZIABILE

CALCOLI:
- Se disponibili dati sufficienti, calcola:
  - DTI = (rata mutuo stimata + rate altri finanziamenti) / reddito bancario mensile
  - LTV = importo mutuo / valore immobile
- Se i dati non bastano, dichiaralo.

RESTITUISCI TASSATIVAMENTE un JSON con questa struttura ESATTA:
{
  "valido": true,
  "motivo_errore": "",
  "tipo_documento_rilevato": "",
  "dati_estratti": {
    "anno_fiscale": "",
    "reddito_complessivo": "",
    "reddito_imponibile": "",
    "reddito_netto_mensile_rilevato": "",
    "altri_dati_rilevanti": []
  },
  "reddito_bancario_mensile": "",
  "metodo_calcolo": "",
  "criticita": [],
  "punti_forza": [],
  "valutazione_rischio": "",
  "score": 0,
  "fascia": "",
  "dti": "",
  "ltv": "",
  "esito_pre_delibera": "",
  "correttivi_consigliati": [],
  "conclusioni": "",
  "report_delibera": ""
}

Il campo "report_delibera" deve contenere un report testuale ben formattato con questo schema:

🔎 TIPO DOCUMENTO:
...
📊 DATI ESTRATTI:
...
💰 REDDITO BANCARIO MENSILE:
...
🧮 METODO DI CALCOLO:
...
⚠️ CRITICITÀ:
...
✅ PUNTI DI FORZA:
...
📊 VALUTAZIONE RISCHIO:
...
📈 CREDIT SCORE:
...
📊 FASCIA:
...
🏦 ESITO PRE-DELIBERA:
...
🛠️ CORRETTIVI CONSIGLIATI:
...
📌 CONCLUSIONI:
...
`;
        } else if (["doc_ec", "doc_mov"].includes(codiceBase)) {
            promptAI += `
${contestoMutuo}

AGISCI come analista bancario di prefattibilità mutui.

Analizza i movimenti bancari e cerca:
- accrediti stipendio o compensi ricorrenti
- uscite tipiche di rate prestiti / leasing / finanziamenti
- utilizzo frequente di scommesse, gioco online, casinò, lotto, slot, Sisal, Snai, Better, Eurobet o simili
- scoperti frequenti, saldo fragile, comportamenti anomali
- coerenza tra reddito dichiarato e flussi rilevati

RESTITUISCI TASSATIVAMENTE un JSON con questa struttura:
{
  "valido": true,
  "motivo_errore": "",
  "stipendi_rilevati": [],
  "rate_rilevate": [],
  "alert_scommesse": [],
  "altre_criticita_bancarie": [],
  "note_prefattibilita": "",
  "score_comportamento_bancario": 0
}
`;
        } else {
            promptAI += `
RESTITUISCI TASSATIVAMENTE un JSON con questa struttura:
{
  "valido": true,
  "motivo_errore": "",
  "tipo_documento_rilevato": "",
  "note_documento": ""
}
`;
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: promptAI },
                        {
                            type: "image_url",
                            image_url: {
                                url: urlFileBase64
                            }
                        }
                    ]
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0.2
        });

        let risultatoAI;
        try {
            risultatoAI = JSON.parse(response.choices[0].message.content);
        } catch (err) {
            console.error("Errore parsing JSON:", err);
            throw new functions.https.HttpsError("internal", "Risposta AI non valida");
        }

        if (typeof risultatoAI.valido !== "boolean") {
            risultatoAI.valido = false;
        }

        if (!risultatoAI.valido && !risultatoAI.motivo_errore) {
            risultatoAI.motivo_errore = "Documento non valido o non leggibile.";
        }

        console.log("RISULTATO AI:", JSON.stringify(risultatoAI, null, 2));

        const datiDaSalvare = {
            aggiornatoIl: admin.firestore.FieldValue.serverTimestamp(),
            tipoDocumento: tipoDocumentoAtteso,
            esitoValido: risultatoAI.valido
        };

        let salvaNelDB = false;

        // Gestione Salvataggio Documenti Reddituali
        if (risultatoAI.report_delibera) {
            datiDaSalvare[`delibera_${tipoDocumentoAtteso}`] = risultatoAI.report_delibera;
            datiDaSalvare.score = risultatoAI.score ?? null;
            datiDaSalvare.fascia = risultatoAI.fascia ?? null;
            datiDaSalvare.valutazioneRischio = risultatoAI.valutazione_rischio ?? null;
            datiDaSalvare.esitoPreDelibera = risultatoAI.esito_pre_delibera ?? null;
            datiDaSalvare.redditoBancarioMensile = risultatoAI.reddito_bancario_mensile ?? null;
            datiDaSalvare.dti = risultatoAI.dti ?? null;
            datiDaSalvare.ltv = risultatoAI.ltv ?? null;
            datiDaSalvare.criticita = Array.isArray(risultatoAI.criticita) ? risultatoAI.criticita : [];
            datiDaSalvare.puntiForza = Array.isArray(risultatoAI.punti_forza) ? risultatoAI.punti_forza : [];
            datiDaSalvare.correttiviConsigliati = Array.isArray(risultatoAI.correttivi_consigliati) ? risultatoAI.correttivi_consigliati : [];
            salvaNelDB = true;
        }

        // Gestione Salvataggio Estratti Conto
        if (risultatoAI.note_prefattibilita) {
            datiDaSalvare[`estrattoconto_${tipoDocumentoAtteso}`] = risultatoAI.note_prefattibilita;
            datiDaSalvare.scoreComportamentoBancario = risultatoAI.score_comportamento_bancario ?? null;
            datiDaSalvare.stipendiRilevati = Array.isArray(risultatoAI.stipendi_rilevati) ? risultatoAI.stipendi_rilevati : [];
            datiDaSalvare.rateRilevate = Array.isArray(risultatoAI.rate_rilevate) ? risultatoAI.rate_rilevate : [];
            datiDaSalvare.alertScommesse = Array.isArray(risultatoAI.alert_scommesse) ? risultatoAI.alert_scommesse : [];
            datiDaSalvare.altreCriticitaBancarie = Array.isArray(risultatoAI.altre_criticita_bancarie) ? risultatoAI.altre_criticita_bancarie : [];
            salvaNelDB = true;
        }

        // Gestione Salvataggio Altri Documenti
        if (risultatoAI.note_documento) {
            datiDaSalvare[`documento_${tipoDocumentoAtteso}`] = risultatoAI.note_documento;
            salvaNelDB = true;
        }

        if (salvaNelDB && risultatoAI.valido === true) {
            await db.collection("analisi_deliberante").doc(idCliente).set(datiDaSalvare, { merge: true });
        }

        return risultatoAI;
    } catch (error) {
        console.error("Errore AI:", error);
        throw new functions.https.HttpsError("internal", "Errore nell'elaborazione AI");
    }
});
