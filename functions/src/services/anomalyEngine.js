const { notEmpty } = require("../utils/strings");

function detectPracticeAnomalies(snapshot) {
  const anomalie = [];
  const warnings = [];

  const docs = snapshot.documenti || [];

  // --- 1. CONTROLLI IMMOBILIARI (CATASTO E TITOLI) ---
  const immobili = docs
    .map((d) => d?.estrazione?.dati_estratti || {})
    .filter((x) => notEmpty(x.foglio) || notEmpty(x.particella) || notEmpty(x.subalterno));

  const keys = new Set(
    immobili.map((x) => `${x.foglio || ""}|${x.particella || ""}|${x.subalterno || ""}`)
  );
  if (keys.size > 1) anomalie.push("Dati catastali non coerenti tra i documenti immobiliari (Es. Visura vs Atto vs Preliminare).");

  const prezzi = docs
    .map((d) => d?.estrazione?.dati_estratti?.prezzo_compravendita)
    .filter(Boolean);
  if (new Set(prezzi).size > 1) warnings.push("Prezzi di compravendita non uniformi tra i documenti.");

  const intestatariList = docs
    .flatMap((d) => d?.estrazione?.dati_estratti?.intestatari || [])
    .filter(Boolean);
  if (intestatariList.length > 1 && new Set(intestatariList).size > 1) warnings.push("Intestatari non perfettamente allineati tra visura, atto o preliminare.");

  const classiEnergetiche = docs
    .map((d) => d?.estrazione?.dati_estratti?.classe_energetica)
    .filter(Boolean);
  if (classiEnergetiche.length > 1 && new Set(classiEnergetiche).size > 1) warnings.push("Classe energetica non coerente tra i vari documenti tecnici.");

  const importiLavori = docs
    .map((d) => d?.estrazione?.dati_estratti?.importo_lavori)
    .filter(Boolean);
  if (importiLavori.length > 1 && new Set(importiLavori).size > 1) warnings.push("Importi lavori non coerenti tra i vari preventivi e computi.");


  // --- 2. CONTROLLO ANTIFRODE INCROCIATO: REDDITO VS BANCA ---
  const incomeDocs = docs.filter(d => ["doc_bustepaga", "doc_cud"].includes(d.tipoDocumento));
  const bankDocs = docs.filter(d => ["doc_ec", "doc_mov"].includes(d.tipoDocumento));

  if (incomeDocs.length > 0 && bankDocs.length > 0) {
    const nettoBusta = incomeDocs[0]?.estrazione?.dati_estratti?.netto_mensile_rilevato_documento;
    const stipendiBank = bankDocs[0]?.estrazione?.stipendi_rilevati || [];
    
    if (nettoBusta && stipendiBank.length > 0) {
      const stipendiBankString = stipendiBank.join(" ");
      const nettoCercato = nettoBusta.replace('€', '').trim();
      
      // Controlla se la cifra esatta rilevata nella busta paga appare nelle righe dell'estratto conto
      if (!stipendiBankString.includes(nettoCercato)) {
        warnings.push(`SOSPETTO MISMATCH STIPENDIO: Il netto mensile letto in busta paga (${nettoBusta}) non coincide chiaramente con gli accrediti rilevati nell'estratto conto. Richiesta revisione manuale per possibile falso.`);
      }
    } else if (nettoBusta && stipendiBank.length === 0) {
      anomalie.push("BLOCCO ANTIFRODE: Busta paga presente, ma nessun accredito stipendio è stato trovato nell'estratto conto fornito!");
    }
  }

  return {
    anomalieBloccanti: anomalie,
    anomalieWarning: warnings,
    hasBlocking: anomalie.length > 0,
  };
}

module.exports = { detectPracticeAnomalies };
