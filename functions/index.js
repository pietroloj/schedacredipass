const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { OpenAI } = require("openai");

admin.initializeApp();
const db = admin.firestore();

// CONFIGURAZIONE V2: Massima potenza (1GB RAM e 5 minuti di attesa)
setGlobalOptions({ 
    region: "us-central1", 
    memory: "1GiB", 
    timeoutSeconds: 300 
});

exports.analizzaDocumentoAI = onCall({ secrets: ["OPENAI_API_KEY"] }, async (request) => {
    
    // Nelle V2 i dati sono dentro request.data
    const data = request.data;
    
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

    if (!urlFileBase64) throw new HttpsError("invalid-argument", "Nessun file inviato.");
    if (!idCliente) throw new HttpsError("invalid-argument", "ID cliente mancante.");

    try {
        const NOMI_DOCUMENTI = {
            doc_ci: "Carta d'Identità", doc_ts: "Tessera Sanitaria / Codice Fiscale",
            doc_residenza: "Certificato Cumulativo / Residenza", doc_bustepaga: "Busta Paga",
            doc_cud: "Certificazione Unica (CU/CUD)", doc_unici: "Modello Redditi / Unico",
            doc_visura: "Visura Camerale", doc_f24: "Modello F24 Pagato",
            doc_ec: "Estratto Conto Bancario", doc_mov: "Lista Movimenti Bancari",
            doc_matrimonio: "Atto di Matrimonio", doc_atto: "Atto di Provenienza Immobile",
            doc_planimetria: "Planimetria / Visura Catastale", doc_preliminare: "Preliminare di Acquisto",
            doc_preventivo: "Preventivo Lavori", doc_mutuo_pre: "Atto di Mutuo in Corso",
            doc_prestiti: "Conteggi Estintivi / Finanziamenti", doc_ape: "APE", doc_isee: "ISEE"
        };

        const codiceBase = String(tipoDocumentoAtteso).replace(/[0-9]/g, "");
        const nomeDocumentoAtteso = NOMI_DOCUMENTI[codiceBase] || "Documento Pratica Mutuo";

        const contestoMutuo = `
CONTESTO PRATICA MUTUO:
- Importo mutuo: ${importoMutuo ?? "N/D"}
- Valore immobile: ${valoreImmobile ?? "N/D"}
- Rata stimata: ${rataMutuoStimata ?? "N/D"}
- Altri finanziamenti (rate): ${rateAltriFinanziamenti ?? "N/D"}
- Durata anni: ${durataAnni ?? "N/D"}
- Prodotto: ${prodottoBancario ?? "N/D"}
- Finalità: ${finalitaMutuo ?? "N/D"}
- Note: ${notePratica ?? "N/D"}
`;

        let promptAI = `
Analizza questa immagine. Il cliente deve caricare: "${nomeDocumentoAtteso}".
REGOLE:
1. Verifica coerenza. 2. Leggibilità. 3. NON inventare dati. 4. Se errato, "valido": false.
`;

        if (["doc_cud", "doc_unici", "doc_bustepaga"].includes(codiceBase)) {
            promptAI += `
${contestoMutuo}
AGISCI COME DELIBERANTE CREDITIZIO SENIOR.
OBIETTIVI:
- Calcola il REDDITO BANCARIO MENSILE NETTO (prudenziale).
- Segnala pignoramenti, cessioni del quinto o anomalie.
- Calcola SCORING 0-100 basato su stabilità e rapporto rata/reddito.
- Calcola DTI e LTV se i dati lo permettono.

RESTITUISCI JSON:
{
  "valido": true,
  "motivo_errore": "",
  "tipo_documento_rilevato": "",
  "dati_estratti": { "reddito_netto_mensile_rilevato": "", "anno_fiscale": "" },
  "reddito_bancario_mensile": "",
  "metodo_calcolo": "",
  "criticita": [],
  "punti_forza": [],
  "score": 0,
  "fascia": "",
  "dti": "",
  "ltv": "",
  "report_delibera": "REPORT TESTUALE DETTAGLIATO CON ICONE"
}
`;
        } else if (["doc_ec", "doc_mov"].includes(codiceBase)) {
            promptAI += `
${contestoMutuo}
AGISCI COME ANALISTA BANCARIO.
Cerca: stipendi, rate prestiti nascoste, transazioni verso SCOMMESSE/GAMBLING (Snai, Sisal, Pokerstars, ecc.), scoperti.
RESTITUISCI JSON:
{
  "valido": true,
  "motivo_errore": "",
  "stipendi_rilevati": [],
  "rate_rilevate": [],
  "alert_scommesse": [],
  "note_prefattibilita": "Analisi flussi...",
  "score_comportamento_bancario": 0
}
`;
        } else {
            promptAI += `RESTITUISCI JSON: { "valido": true, "motivo_errore": "", "note_documento": "OK" }`;
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: [{ type: "text", text: promptAI }, { type: "image_url", image_url: { url: urlFileBase64 } }] }],
            response_format: { type: "json_object" },
            temperature: 0.1
        });

        const risultatoAI = JSON.parse(response.choices[0].message.content);

        // LOGICA DI SALVATAGGIO SU FIRESTORE
        const datiDaSalvare = {
            aggiornatoIl: admin.firestore.FieldValue.serverTimestamp(),
            tipoDocumento: tipoDocumentoAtteso,
            esitoValido: risultatoAI.valido
        };

        if (risultatoAI.report_delibera) {
            datiDaSalvare[`delibera_${tipoDocumentoAtteso}`] = risultatoAI.report_delibera;
            datiDaSalvare.score = risultatoAI.score ?? null;
            datiDaSalvare.fascia = risultatoAI.fascia ?? null;
        }

        if (risultatoAI.note_prefattibilita) {
            datiDaSalvare[`analisi_bancaria_${tipoDocumentoAtteso}`] = risultatoAI.note_prefattibilita;
            datiDaSalvare.alertScommesse = risultatoAI.alert_scommesse || [];
        }

        if (risultatoAI.valido === true) {
            await db.collection("analisi_deliberante").doc(idCliente).set(datiDaSalvare, { merge: true });
        }

        return risultatoAI;

    } catch (error) {
        console.error("ERRORE:", error);
        throw new HttpsError("internal", "Errore del server AI.");
    }
});
