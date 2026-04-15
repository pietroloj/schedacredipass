const { MODELS, structuredCall } = require("./openaiClient");
const { stripNumericSuffix } = require("../utils/strings");
const { bankExtractionSchema } = require("../schemas/bankSchemas");

async function extractBank({ tipoDocumentoAtteso, preparedFiles, practiceContext }) {
  const codiceBase = stripNumericSuffix(tipoDocumentoAtteso);
  const contentItems = preparedFiles.flatMap((f) => f.contentItems);

  return structuredCall({
    model: MODELS.MAIN,
    schemaName: "bank_extraction",
    schema: bankExtractionSchema,
    systemText: `
Sei un analista del credito senior e "spietato", specializzato in valutazione del rischio (Credit Risk). 
Il tuo compito è analizzare chirurgicamente questo estratto conto o lista movimenti per scovare ogni minimo campanello d'allarme bancario a tutela della Banca che deve erogare il mutuo.

Devi estrarre i dati richiesti dallo schema, applicando queste regole ferree:
1. FINANZIAMENTI OCCULTI E RATE: Cerca ossessivamente addebiti SDD, bonifici ricorrenti o pagamenti verso società finanziarie (es. Compass, Agos, Findomestic, Santander, ecc.). Inseriscili tutti in 'rate_rilevate'.
2. SCONFINAMENTI: Valuta a 'true' il campo 'saldo_negativo_o_scoperti' se vedi il saldo in negativo (rosso), commissioni di massimo scoperto (CIV), insoluti, rate respinte o fidi utilizzati oltre il limite.
3. GAMBLING E RISCHIO: Cerca e inserisci in 'movimenti_gambling_rilevati' le transazioni legate a gioco d'azzardo (Sisal, Snai, Bet, Eurobet, ecc.) o ricariche continue e non giustificate verso carte prepagate.
4. MOVIMENTI RICORRENTI ANOMALI: Segnala in 'movimenti_ricorrenti' affitti, assegni di mantenimento, giroconti frequenti o versamenti in contanti importanti.
5. STIPENDI E CAUSALI: Estrai ogni accredito di stipendio o pensione in 'stipendi_rilevati'. DEVI specificare in modo preciso l'importo esatto, l'ordinante (es. nome dell'azienda o INPS) e la data dell'accredito (es. "Accredito Mario Rossi SPA - 1.550,00€ - 27/04"). Questo dato è vitale per l'antifrode.

Sii oggettivo ma estremamente pignolo. Guarda le descrizioni dei movimenti con malizia. Riporta i fatti e le cifre esatte.
${practiceContext}
`.trim(),
    userText: `Analizza il documento bancario di tipo ${codiceBase}. Vai a caccia di ogni rischio nascosto.`,
    contentItems,
  });
}

module.exports = { extractBank };
