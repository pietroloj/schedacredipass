const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { OpenAI } = require("openai");

admin.initializeApp();
const db = admin.firestore();

// CONFIGURAZIONE POTENZIATA: 1GB RAM e 5 Minuti di attesa
exports.analizzaDocumentoAI = functions
    .runWith({ 
        secrets: ["OPENAI_API_KEY"],
        timeoutSeconds: 300, 
        memory: "1GB" 
    })
    .https.onCall(async (data, context) => {
    
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

    if (!urlFileBase64) throw new functions.https.HttpsError("invalid-argument", "File mancante.");
    if (!tipoDocumentoAtteso) throw new functions.https.HttpsError("invalid-argument", "Tipo doc mancante.");

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
        Dati della Pratica (da usare per i calcoli DTI/LTV):
        - Importo Richiesto: ${importoMutuo || "N/D"}
        - Valore Immobile: ${valoreImmobile || "N/D"}
        - Rata Mutuo Stimata: ${rataMutuoStimata || "N/D"}
        - Altre Rate in corso: ${rateAltriFinanziamenti || "N/D"}
        - Durata: ${durataAnni || "N/D"} anni
        `;

        let promptAI = `Sei un esperto Deliberante Creditizio di una banca. Analizza il documento: "${nomeDocumentoAtteso}".
        
        REGOLE FONDAMENTALI:
        1. Se il documento caricato NON è quello richiesto, dichiara "valido": false.
        2. Se mancano pagine o è illeggibile, dichiara "valido": false.
        3. Estrai dati reali, non inventare nulla.`;

        if (["doc_cud", "doc_unici", "doc_bustepaga"].includes(codiceBase)) {
            promptAI += `
            ${contestoMutuo}
            
            ANALISI REDDITUALE:
            - Calcola il REDDITO MENSILE BANCARIO (Netto).
            - Verifica stabilità (contratto, anzianità).
            - Se Busta Paga: controlla trattenute, cessioni del quinto, pignoramenti.
            - Se Modello Unico: applica prudenza (media ultimi 2 anni se visibile).
            
            REPORT DELIBERA:
            Crea un report testuale formattato con icone che riassuma:
            - Dati estratti (reddito, azienda, data assunzione).
            - Calcolo DTI (Rapporto Rata/Reddito).
            - Giudizio finale (Approvabile, Dubbio, Respinto).
            - Scoring da 0 a 100.
            
            RESTITUISCI JSON:
            {
              "valido": true,
              "motivo_errore": "",
              "tipo_documento_rilevato": "",
              "reddito_bancario_mensile": "",
              "score": 0,
              "fascia": "",
              "report_delibera": "testo..."
            }`;
        } else if (["doc_ec", "doc_mov"].includes(codiceBase)) {
            promptAI += `
            ${contestoMutuo}
            ANALISI BANCARIA:
            - Cerca entrate ricorrenti (stipendi).
            - Cerca uscite per prestiti non dichiarati.
            - CRITICO: Cerca transazioni verso siti di scommesse, gambling, gioco d'azzardo. Se presenti, segnalalo come criticità grave.
            
            RESTITUISCI JSON:
            {
              "valido": true,
              "motivo_errore": "",
              "alert_scommesse": [],
              "note_prefattibilita": "Analisi dei flussi...",
              "score_comportamento_bancario": 0
            }`;
        } else {
            promptAI += `
            RESTITUISCI JSON:
            {
              "valido": true,
              "motivo_errore": "",
              "note_documento": "Documento verificato correttamente."
            }`;
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: [{ type: "text", text: promptAI }, { type: "image_url", image_url: { url: urlFileBase64 } }] }],
            response_format: { type: "json_object" },
            temperature: 0
        });

        const risultatoAI = JSON.parse(response.choices[0].message.content);

        // LOGICA DI SALVATAGGIO UNIVERSALE
        const datiDaSalvare = {
            aggiornatoIl: admin.firestore.FieldValue.serverTimestamp(),
            tipoDocumento: tipoDocumentoAtteso,
            esitoValido: risultatoAI.valido
        };

        if (risultatoAI.report_delibera) datiDaSalvare[`delibera_${tipoDocumentoAtteso}`] = risultatoAI.report_delibera;
        if (risultatoAI.note_prefattibilita) datiDaSalvare[`analisi_bancaria_${tipoDocumentoAtteso}`] = risultatoAI.note_prefattibilita;
        if (risultatoAI.note_documento) datiDaSalvare[`check_${tipoDocumentoAtteso}`] = risultatoAI.note_documento;
        if (risultatoAI.score) datiDaSalvare.ultimoScore = risultatoAI.score;

        if (risultatoAI.valido === true && idCliente) {
            await db.collection("analisi_deliberante").doc(idCliente).set(datiDaSalvare, { merge: true });
        }

        return risultatoAI;

    } catch (error) {
        console.error("ERRORE:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});
