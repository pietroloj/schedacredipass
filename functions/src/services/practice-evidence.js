const { subjectIdFromDocument } = require("./practiceSubjects");

const base = doc => String(doc.tipoDocumentoBase || doc.tipoDocumento || "")
  .replace(/_[rg]\d+$|\d+$/i, "");
const fiscal = doc => doc.estrazione?.dati_estratti || {};
const subject = doc => doc.subjectId || subjectIdFromDocument(doc) || "r1";

function isInformational(reason) {
  const text = String(reason);
  return /compensi.*ann[io] precedent.*tassazione separata/i.test(text) ||
    /(?:addizionale comunale.*acconto|acconto.*addizionale comunale).*(?:non valorizzat|vuot|non compilat)/i.test(text) ||
    /(?:saldi|saldo).*(?:singola operazione|giornalier).*(?:iniziale|finale)|solo saldo iniziale e saldo finale/i.test(text) ||
    /periodo analizzato limitato (?:al|a un) trimestre|non risultano.*(?:sdd|rid|rate\/finanziamenti).*periodo (?:visibile|analizzato)/i.test(text);
}

function pointTwoOnly(doc) {
  const evidence = fiscal(doc);
  if (typeof evidence.cu_solo_punto_2 === "boolean") return evidence.cu_solo_punto_2;
  return (doc.estrazione?.criticita_documentali || []).some(reason =>
    /(?:reddito|compilat|indicat).*punto\s*2.*(?:tempo determinato|punto\s*1.*vuot)/i.test(reason)
  );
}

function contractChecks(documents, practice = {}) {
  const checks = [];
  const latest = new Map();
  for (const doc of documents) {
    if (base(doc) !== "doc_cud" || !["r1", "r2"].includes(subject(doc))) continue;
    const previous = latest.get(subject(doc));
    if (!previous || (doc.createdAt || 0) > (previous.createdAt || 0)) latest.set(subject(doc), doc);
  }
  for (const [id, cu] of latest) {
    if (!pointTwoOnly(cu) || cu.classificazione?.leggibile_umano === false) continue;
    const number = id.slice(1);
    if (!practice["doc_trasformazione_contratto" + number]) {
      const cedolino = documents.filter(doc => base(doc) === "doc_bustepaga" && subject(doc) === id)
        .sort((a, b) => String(fiscal(b).mese_cedolino || "").localeCompare(String(fiscal(a).mese_cedolino || "")))[0];
      const year = String(fiscal(cu).anno_fiscale || "").match(/\b\d{4}\b/)?.[0];
      const month = fiscal(cedolino || {}).mese_cedolino;
      const cutoff = new Date();
      cutoff.setUTCDate(1);
      cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
      const today = new Date().toISOString().slice(0, 7);
      const recent = /^\d{4}-(0[1-9]|1[0-2])$/.test(month || "") && month >= cutoff.toISOString().slice(0, 7) && month <= today;
      const conflict = recent && year && month.slice(0, 4) > year && fiscal(cedolino).contratto_esplicito === "indeterminato" &&
        cedolino.classificazione?.leggibile_umano === true && cedolino.classificazione?.documento_completo_inquadrato === true;
      const required = conflict ? "trasformazione_contratto" + number : null;
      checks.push({
        subject: id,
        required,
        reason: conflict
          ? `${id.toUpperCase()}: CU al punto 2 e cedolino recente a tempo indeterminato. Acquisire la trasformazione del contratto.`
          : `${id.toUpperCase()}: reddito CU al punto 2. Verificare il tipo di contratto sulle buste paga recenti.`,
      });
    }
  }
  return checks;
}

function dateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? +date : null;
}

const DAY = 86400000;
const dateText = time => new Date(time).toISOString().slice(0, 10);
const itDate = value => value.split("-").reverse().join("/");

function bankCoverage(documents, today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date())) {
  const now = dateValue(today);
  const current = new Date(now);
  const lastQuarter = Date.UTC(current.getUTCFullYear(), Math.floor(current.getUTCMonth() / 3) * 3, 1) - DAY;
  const quarterEnd = new Date(lastQuarter);
  const quarterStart = Date.UTC(quarterEnd.getUTCFullYear(), quarterEnd.getUTCMonth() - 2, 1);
  const quarters = documents.filter(doc => base(doc) === "doc_ec");
  const lists = documents.filter(doc => base(doc) === "doc_mov");
  const grouped = new Map();
  for (const doc of quarters) {
    const key = subject(doc) + "|" + (doc.estrazione?.conto_riferimento || "");
    if (!grouped.has(key) || (dateValue(grouped.get(key).estrazione?.periodo_fine) ?? -1) < (dateValue(doc.estrazione?.periodo_fine) ?? -1)) grouped.set(key, doc);
  }
  const missingQuarter = [...new Set(lists.map(subject))]
    .filter(id => !quarters.some(doc => subject(doc) === id))
    .map(id => `${id.toUpperCase()}: acquisire l’ultimo trimestre contabile chiuso fino al ${itDate(dateText(lastQuarter))}.`);
  const coverage = [...grouped.values()].flatMap(doc => {
    const bank = doc.estrazione || {};
    const account = /^\d{4}$/.test(bank.conto_riferimento || "") ? bank.conto_riferimento : "";
    const end = dateValue(bank.periodo_fine);
    const start = dateValue(bank.periodo_inizio);
    const label = subject(doc).toUpperCase() + (account ? " · conto " + account : "");
    if (start === null || end === null || start > end) return [`${label}: verificare le date del trimestre contabile.`];
    if (start > quarterStart || end < lastQuarter) return [`${label}: acquisire l’ultimo trimestre contabile chiuso fino al ${itDate(dateText(lastQuarter))}.`];
    let covered = end;
    const intervals = lists.filter(item => subject(item) === subject(doc) && account &&
      item.estrazione?.conto_riferimento === account)
      .map(item => [dateValue(item.estrazione?.periodo_inizio), dateValue(item.estrazione?.periodo_fine)])
      .filter(([from, to]) => from !== null && to !== null && from <= to).sort(([a], [b]) => a - b);
    for (const [from, to] of intervals) {
      if (from <= covered + DAY && to > covered) covered = to;
    }
    if (covered >= now) return [];
    return [`${label}: lista movimenti da verificare dal ${itDate(dateText(covered + DAY))} al ${itDate(today)}.`];
  });
  return [...missingQuarter, ...coverage];
}

function extraordinaryCredits(bank, legacyMovements) {
  if (Array.isArray(bank.entrate_straordinarie)) {
    return bank.entrate_straordinarie.flatMap(entry => {
      if (!(Number(entry.importo) > 0) || !String(entry.causale || "").trim()) return [];
      return [[entry.data, new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(entry.importo), entry.causale].filter(Boolean).join(" · ")];
    });
  }
  return legacyMovements.filter(text => !/uscita|disposto a favore|addebito/i.test(text) &&
    /entrata straordinaria|bonifico straordinario.*(?:ordinante|ricevuto)|giroconto.*(?:ordinante|ricevuto)|prestito ricevuto/i.test(text));
}

module.exports = { isInformational, contractChecks, bankCoverage, extraordinaryCredits };
