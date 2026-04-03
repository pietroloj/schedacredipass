const { notEmpty } = require("../utils/strings");

function detectPracticeAnomalies(snapshot) {
  const anomalie = [];
  const warnings = [];

  const docs = snapshot.documenti || [];
  const immobili = docs
    .map((d) => d?.estrazione?.dati_estratti || {})
    .filter((x) => notEmpty(x.foglio) || notEmpty(x.particella) || notEmpty(x.subalterno));

  const keys = new Set(
    immobili.map((x) => `${x.foglio || ""}|${x.particella || ""}|${x.subalterno || ""}`)
  );
  if (keys.size > 1) anomalie.push("Dati catastali non coerenti tra i documenti immobiliari");

  const prezzi = docs
    .map((d) => d?.estrazione?.dati_estratti?.prezzo_compravendita)
    .filter(Boolean);
  if (new Set(prezzi).size > 1) warnings.push("Prezzi di compravendita non uniformi tra i documenti");

  const intestatariList = docs
    .flatMap((d) => d?.estrazione?.dati_estratti?.intestatari || [])
    .filter(Boolean);
  if (intestatariList.length > 1 && new Set(intestatariList).size > 1) warnings.push("Intestatari non perfettamente allineati tra visura/atto/preliminare");

  const classiEnergetiche = docs
    .map((d) => d?.estrazione?.dati_estratti?.classe_energetica)
    .filter(Boolean);
  if (classiEnergetiche.length > 1 && new Set(classiEnergetiche).size > 1) warnings.push("Classe energetica non coerente tra documenti");

  const importiLavori = docs
    .map((d) => d?.estrazione?.dati_estratti?.importo_lavori)
    .filter(Boolean);
  if (importiLavori.length > 1 && new Set(importiLavori).size > 1) warnings.push("Importi lavori non coerenti tra preventivi/computi");

  return {
    anomalieBloccanti: anomalie,
    anomalieWarning: warnings,
    hasBlocking: anomalie.length > 0,
  };
}

module.exports = { detectPracticeAnomalies };
