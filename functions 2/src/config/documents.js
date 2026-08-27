const DOCS = {
  doc_ci: "Carta d'Identità",
  doc_ts: "Tessera Sanitaria / Codice Fiscale",
  doc_residenza: "Certificato Cumulativo / Residenza",
  doc_bustepaga: "Busta Paga",
  doc_cud: "Certificazione Unica (CU/CUD)",
  doc_unici: "Modello Redditi / Unico",
  doc_visura: "Visura Catastale",
  doc_planimetria: "Planimetria Catastale",
  doc_atto: "Atto di Provenienza",
  doc_preliminare: "Preliminare di Compravendita",
  doc_ape: "APE",
  doc_isee: "ISEE",
  doc_preventivo: "Preventivo Lavori / Computo Metrico",
  doc_ec: "Estratto Conto Bancario",
  doc_mov: "Lista Movimenti Bancari",
  doc_prestiti: "Contratti di Finanziamento / Conteggi Estintivi",
  doc_f24: "Modello F24 Pagato",
  doc_mutuo_pre: "Atto di Mutuo in Corso",
  doc_matrimonio: "Atto di Matrimonio",
};

const DOC_TYPES = Object.keys(DOCS);

const DOC_GROUPS = {
  identity: ["doc_ci", "doc_ts", "doc_residenza"],
  income: ["doc_cud", "doc_unici", "doc_bustepaga", "doc_isee"],
  bank: ["doc_ec", "doc_mov", "doc_prestiti"],
  realEstate: [
    "doc_visura",
    "doc_planimetria",
    "doc_atto",
    "doc_preliminare",
    "doc_ape",
    "doc_preventivo",
    "doc_mutuo_pre",
  ],
  generic: ["doc_f24", "doc_matrimonio"],
};

const DECISION_CODES = {
  PRECHECK_FAILED: "PRECHECK_FAILED",
  DOC_WRONG_TYPE: "DOC_WRONG_TYPE",
  DOC_UNREADABLE: "DOC_UNREADABLE",
  DOC_REJECTED: "DOC_REJECTED",
  IDENTITY_OK: "IDENTITY_OK",
  IDENTITY_REVIEW: "IDENTITY_REVIEW",
  INCOME_OK: "INCOME_OK",
  INCOME_REVIEW: "INCOME_REVIEW",
  BANK_OK: "BANK_OK",
  BANK_ALERT_GAMBLING: "BANK_ALERT_GAMBLING",
  REALESTATE_OK: "REALESTATE_OK",
  REALESTATE_REVIEW: "REALESTATE_REVIEW",
  PRACTICE_OK: "PRACTICE_OK",
  PRACTICE_REVIEW: "PRACTICE_REVIEW",
  PRACTICE_BLOCKING_ANOMALY: "PRACTICE_BLOCKING_ANOMALY",
  TECHNICAL_ERROR: "TECHNICAL_ERROR",
};

const GAMBLING_KEYWORDS = [
  "snai", "sisal", "eurobet", "planetwin", "bet365", "betflag",
  "goldbet", "pokerstars", "admiral", "better", "bwin", "lottomatica", "scommesse"
];

module.exports = { DOCS, DOC_TYPES, DOC_GROUPS, DECISION_CODES, GAMBLING_KEYWORDS };
