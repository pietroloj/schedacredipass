const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { OpenAI } = require("openai");

admin.initializeApp();
const db = admin.firestore();

// Inizializza OpenAI (la chiave verrà nascosta nelle variabili d'ambiente di Firebase per sicurezza)
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * FUNZIONE 1: Valida il documento e cerca anomalie (Gioco d'azzardo, stipendio)
 * Questa funzione verrà chiamata dal tuo HTML (frontend) quando il cliente clicca "Salva"
 */
exports.analizzaDocumentoAI = functions.https.onCall(async (data, context) => {
    // Riceviamo i dati dal frontend
    const { urlFileBase64, tipoDocumentoAteso, idCliente } = data;

    if (!urlFileBase64) {
        throw new functions.https.HttpsError("invalid-argument", "Nessun file inviato.");
    }

    try {
        // Prepariamo le istruzioni per l'AI in base a cosa stiamo analizzando
        let promptAI = "";

        if (tipoDocumentoAteso === "doc_ci" || tipoDocumentoAteso === "doc_ts") {
            promptAI = `Analizza questa immagine. Il cliente doveva caricare: ${tipoDocumentoAteso === 'doc_ci' ? "Carta d'Identità" : "Tessera Sanitaria"}. 
            1. Verifica che il documento sia quello corretto.
            2. Verifica che sia a fuoco e leggibile.
            Rispondi in JSON stretto: {"valido": true/false, "motivo_errore": "solo se non valido, spiega brevemente perché (es. Immagine sfocata o Documento errato)"}`;
        } 
        else if (tipoDocumentoAteso === "doc_ec" || tipoDocumentoAteso === "doc_mov") {
            promptAI = `Analizza questo estratto conto bancario.
            1. È leggibile ed è un estratto conto? (valido: true/false)
            2. Cerca bonifici in entrata con causale 'Stipendio' o 'Emolumenti'.
            3. Cerca transazioni in uscita verso siti di scommesse/gioco d'azzardo (Sisal, Lottomatica, Bet365, Snai, Pokerstars, ecc.).
            Rispondi in JSON stretto: {"valido": true/false, "motivo_errore": "...", "note_prefattibilita": "Riassumi qui se hai trovato stipendi o se ci sono ALLARMI per gioco d'azzardo."}`;
        } else {
            // Per gli altri documenti fa solo un controllo visivo base
            promptAI = `Verifica che questo documento sia leggibile e sembri un documento ufficiale. 
            Rispondi in JSON: {"valido": true/false, "motivo_errore": "..."}`;
        }

        // Chiamata API a GPT-4o Vision
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: promptAI },
                        { type: "image_url", image_url: { url: urlFileBase64 } }
                    ]
                }
            ],
            response_format: { type: "json_object" } // Forza la risposta in JSON
        });

        // Estrai la risposta dell'AI
        const risultatoAI = JSON.parse(response.choices[0].message.content);

        // Se l'AI ha trovato note di prefattibilità (es. gioco d'azzardo), salvale nel Database Segreto del Consulente
        if (risultatoAI.note_prefattibilita) {
            await db.collection("alert_prefattibilita").doc(idCliente).set({
                [tipoDocumentoAteso]: risultatoAI.note_prefattibilita,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }

        // Ritorna il risultato al frontend (upload.html)
        return risultatoAI;

    } catch (error) {
        console.error("Errore AI:", error);
        throw new functions.https.HttpsError("internal", "Errore durante l'analisi del documento.");
    }
});
