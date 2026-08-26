const { POLICY } = require("../config/policy");
const { DECISION_CODES, GAMBLING_KEYWORDS, DOC_GROUPS } = require("../config/documents");
const { normalizeNumber, round2, formatNumberIT } = require("../utils/numbers");
const { notEmpty } = require("../utils/strings");

function containsGamblingKeyword(text = "") {
  const lower = text.toLowerCase();
  return GAMBLING_KEYWORDS.some((k) => lower.includes(k));
}

// IL TUO CALCOLO CUD ESATTO
function calcolaRedditoBancarioMensilePrudenziale(estratti) {
  const lordo = normalizeNumber(estratti.reddito_lordo_annuo); // CUD Punti 1, 2, 3
  const irpef = normalizeNumber(estratti.irpef) || 0; // CUD Punto 21
  const reg = normalizeNumber(estratti.addizionale_regionale) || 0; // CUD Punto 22
  const com = normalizeNumber(estratti.addizionale_comunale) || 0; // CUD Punti 26+27+29

  const giorniLavorati = normalizeNumber(estratti.giorni_lavorati); // CUD Punto 6 o 7

  if (!lordo) return null;

  // Il reddito lordo nel CUD (Imponibile Fiscale) è GIÀ al netto dei contributi INPS.
  // Quindi la formula esatta è: Lordo - Irpef - Add.Reg - Add.Com
  const nettoAnnuo = lordo - irpef - reg - com;

  if (!Number.isFinite(nettoAnnuo) || nettoAnnuo <= 0) return null;

  // Trasformiamo i giorni in mesi (es. 365 -> 12 mesi, 120 -> 4 mesi)
  let mesiLavorati = 12; // Default per un anno intero
  if (giorniLavorati && giorniLavorati > 0 && giorniLavorati <= 365) {
    mesiLavorati = Math.round(giorniLavorati / 30.416); // 365 / 12 = 30.416 (giorni medi mese)
    if (mesiLavorati === 0) mesiLavorati = 1; // Evita divisioni impossibili
  }

  return round2(nettoAnnuo / mesiLavorati);
}

function calcolaDTI(redditoMensile, rataMutuo, altreRate) {
  const r = normalizeNumber(redditoMensile);
  const rm = normalizeNumber(rataMutuo);
  const ar = normalizeNumber(altreRate) || 0;
  if (!r || !rm) return null;
  return round2(((rm + ar) / r) * 100);
}

function calcolaLTV(importoMutuo, valoreImmobile) {
  const im = normalizeNumber(importoMutuo);
  const vi = normalizeNumber(valoreImmobile);
  if (!im || !vi) return null;
  return round2((im / vi) * 100);
}

function scoreIncomeDecision({ estrazione, data }) {
  const estratti = estrazione?.dati_estratti || {};
  const nettoMensile = calcolaRedditoBancarioMensilePrudenziale(estratti);
  const dti = calcolaDTI(nettoMensile, data.rataMutuoStimata, data.rateAltriFinanziamenti);
  const ltv = calcolaLTV(data.importoMutuo, data.valoreImmobile);

  const criticita = [...(estrazione.criticita_documentali || [])];
  const puntiForza = [...(estrazione.punti_forza_documentali || [])];

  if (estratti.tempo_indeterminato) puntiForza.push("Contratto a tempo indeterminato rilevato");
  if (notEmpty(estratti.data_assunzione)) puntiForza.push(`Data assunzione rilevata: ${estratti.data_assunzione}`);
  if (estratti.cessione_del_quinto_presente) criticita.push("Cessione del quinto rilevata");
  if (estratti.pignoramento_presente) criticita.push("Pignoramento rilevato");

  let score = 50;
  if (nettoMensile !== null) {
    if (nettoMensile >= 2000) score += 14;
    else if (nettoMensile >= 1600) score += 10;
    else if (nettoMensile >= 1300) score += 6;
    else if (nettoMensile >= 1000) score += 3;
  }
  if (estratti.tempo_indeterminato) score += 12;

  if (dti !== null) {
    if (dti <= 30) score += 16;
    else if (dti <= POLICY.dtiWarning) score += 10;
    else if (dti <= 40) score += 4;
    else if (dti <= POLICY.dtiCritical) score -= 6;
    else score -= 16;
  }

  score -= Math.min(criticita.length * 4, POLICY.maxCriticitaPenalty);
  score = Math.max(0, Math.min(100, score));

  const fascia = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D";

  return {
    redditoBancarioMensile: nettoMensile,
    dti,
    ltv,
    score,
    fascia,
    criticita,
    puntiForza,
    report: [
      "📄 REPORT DELIBERANTE",
      `Reddito bancario mensile prudenziale: ${nettoMensile !== null ? `€ ${formatNumberIT(nettoMensile)}` : "N/D"}`,
      `Score: ${score}/100`,
      `Fascia: ${fascia}`,
      `DTI: ${dti !== null ? `${formatNumberIT(dti)}%` : "N/D"}`,
      `LTV: ${ltv !== null ? `${formatNumberIT(ltv)}%` : "N/D"}`,
    ].join("\n"),
  };
}

function normalizeTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => {
      if (typeof x === "string") return x.trim();
      if (x && typeof x === "object") {
        return [
          x.descrizione,
          x.causale,
          x.controparte,
          x.importo,
          x.data,
          x.note,
        ].filter(Boolean).join(" - ");
      }
      return "";
    })
    .filter(Boolean);
}

function containsAnyKeyword(text = "", keywords = []) {
  const lower = String(text || "").toLowerCase();
  return keywords.some((k) => lower.includes(String(k).toLowerCase()));
}

function scoreBankDecision({ estrazione }) {
  const bank = estrazione || {};

  const gamblingRaw = normalizeTextArray(bank.movimenti_gambling_rilevati);
  const recurring = normalizeTextArray(bank.movimenti_ricorrenti);
  const rates = normalizeTextArray(bank.rate_rilevate);
  const salaries = normalizeTextArray(bank.stipendi_rilevati);

  // Manteniamo il filtro tramite GAMBLING_KEYWORDS, ma se l'estrattore ha
  // già classificato esplicitamente un movimento come gambling non lo perdiamo.
  const gambling = gamblingRaw.filter(
    (x) =>
      containsGamblingKeyword(x) ||
      containsAnyKeyword(x, [
        "snai", "sisal", "lottomatica", "eurobet", "bet365",
        "pokerstars", "planetwin", "goldbet", "betfair",
        "william hill", "bwin", "admiralbet", "better",
        "scommessa", "scommesse", "gaming", "gioco"
      ])
  );

  const cashKeywords = [
    "versamento contanti",
    "versamento di contanti",
    "versamento cash",
    "prelievo contanti",
    "prelievo atm",
    "prelievo bancomat",
    "sportello contanti",
    "cash"
  ];

  const cashMovements = recurring.filter((x) =>
    containsAnyKeyword(x, cashKeywords)
  );

  const extraordinaryKeywords = [
    "entrata straordinaria",
    "bonifico straordinario",
    "vendita preziosi",
    "vendita oro",
    "vendita bene",
    "prestito ricevuto",
    "giroconto",
    "trasferimento da altro conto"
  ];

  const extraordinaryMovements = recurring.filter((x) =>
    containsAnyKeyword(x, extraordinaryKeywords)
  );

  const debtCollectionKeywords = [
    "agenzia entrate",
    "agenzia delle entrate",
    "riscossione",
    "ader",
    "pignor",
    "precetto"
  ];

  const collectionMovements = recurring.filter((x) =>
    containsAnyKeyword(x, debtCollectionKeywords)
  );

  const cryptoKeywords = [
    "binance", "coinbase", "crypto.com", "kraken", "bitstamp",
    "bitpanda", "criptovalut", "crypto"
  ];

  const cryptoMovements = recurring.filter((x) =>
    containsAnyKeyword(x, cryptoKeywords)
  );

  const criticita = [];
  const puntiForza = [];

  if (bank.saldo_negativo_o_scoperti) {
    criticita.push("Saldo negativo, scoperto, insoluto o utilizzo anomalo del fido rilevato");
  }

  if (rates.length > 0) {
    criticita.push(`Rilevati ${rates.length} movimenti potenzialmente riconducibili a rate/finanziamenti da verificare`);
  }

  if (gambling.length > 0) {
    criticita.push(`Rilevati ${gambling.length} movimenti riconducibili a gioco/scommesse`);
  }

  if (cashMovements.length > 0) {
    criticita.push(`Rilevati ${cashMovements.length} movimenti in contanti/prelievi ATM meritevoli di verifica`);
  }

  if (extraordinaryMovements.length > 0) {
    criticita.push("Rilevate entrate o movimentazioni straordinarie da non assimilare automaticamente a risparmio ordinario");
  }

  if (collectionMovements.length > 0) {
    criticita.push("Rilevati movimenti verso enti di riscossione o causali assimilabili da approfondire");
  }

  if (cryptoMovements.length > 0) {
    criticita.push("Rilevati movimenti verso operatori crypto/exchange da contestualizzare");
  }

  if (salaries.length > 0) {
    puntiForza.push(`Rilevati ${salaries.length} accrediti riconducibili a stipendio/pensione`);
  }

  if (!bank.saldo_negativo_o_scoperti) {
    puntiForza.push("Nessun saldo negativo/scoperto esplicitamente rilevato nel documento analizzato");
  }

  let score = 82;

  if (bank.saldo_negativo_o_scoperti) score -= 22;
  score -= Math.min(rates.length * 4, 16);
  score -= Math.min(gambling.length * 10, 35);
  score -= Math.min(cashMovements.length * 4, 16);
  score -= Math.min(extraordinaryMovements.length * 4, 12);
  score -= Math.min(collectionMovements.length * 10, 20);
  score -= Math.min(cryptoMovements.length * 3, 9);

  if (salaries.length >= 2) score += 4;

  score = Math.max(0, Math.min(100, score));

  const severita =
    bank.saldo_negativo_o_scoperti ||
    collectionMovements.length > 0 ||
    gambling.length >= 3
      ? "alta"
      : gambling.length > 0 ||
        cashMovements.length > 0 ||
        rates.length > 0 ||
        extraordinaryMovements.length > 0
      ? "media"
      : "bassa";

  const reviewManuale =
    criticita.length > 0;

  return {
    scoreComportamentoBancario: score,
    severitaComportamentoBancario: severita,
    reviewManualeBanca: reviewManuale,

    alertScommesse: gambling,
    alertContanti: cashMovements,
    alertRateFinanziamenti: rates,
    alertEntrateStraordinarie: extraordinaryMovements,
    alertRiscossione: collectionMovements,
    alertCrypto: cryptoMovements,
    accreditiStipendioPensione: salaries,

    criticita,
    puntiForza,

    reportBancario: [
      "ANALISI COMPORTAMENTO BANCARIO",
      `Score comportamento bancario: ${score}/100`,
      `Severità: ${severita}`,
      `Saldo negativo/scoperti: ${bank.saldo_negativo_o_scoperti ? "Sì" : "No"}`,
      `Movimenti gioco/scommesse: ${gambling.length}`,
      `Movimenti contanti/ATM da verificare: ${cashMovements.length}`,
      `Rate/finanziamenti rilevati: ${rates.length}`,
      `Entrate straordinarie: ${extraordinaryMovements.length}`,
      `Movimenti riscossione: ${collectionMovements.length}`,
      `Movimenti crypto/exchange: ${cryptoMovements.length}`,
      `Accrediti stipendio/pensione: ${salaries.length}`,
    ].join("\n"),
  };
}

function reviewPolicy({ classificazione, estrazione, tipoDocumentoAtteso, practiceAnomalies }) {
  const reasons = [];
  if (classificazione.confidenza_classificazione < POLICY.classificationConfidenceReview) reasons.push("Confidenza classificazione inferiore alla soglia professionale");
  if (POLICY.requireManualReviewOnPartialDocument && classificazione.leggibile_umano && !classificazione.documento_completo_inquadrato) reasons.push("Documento leggibile ma parzialmente tagliato");

  if (DOC_GROUPS.income.includes(tipoDocumentoAtteso)) {
    const d = estrazione?.dati_estratti || {};
    if (POLICY.requireManualReviewOnMissingIncomeCoreFields) {
      if (!notEmpty(d.reddito_lordo_annuo)) reasons.push("Reddito lordo annuo non estratto");
      if (!notEmpty(d.irpef)) reasons.push("IRPEF non estratta");
    }
  }

  if (DOC_GROUPS.identity.includes(tipoDocumentoAtteso)) {
    const d = estrazione?.dati_estratti || {};
    if (POLICY.requireManualReviewOnMissingIdentityCoreFields) {
      if (!notEmpty(d.nome) || !notEmpty(d.cognome)) reasons.push("Dati anagrafici principali incompleti");
    }
  }

  if (DOC_GROUPS.bank.includes(tipoDocumentoAtteso)) {
    const bankDecision = scoreBankDecision({ estrazione });

    if (bankDecision.reviewManualeBanca) {
      reasons.push(...bankDecision.criticita);
    }
  }

  if (practiceAnomalies?.hasBlocking) reasons.push(...practiceAnomalies.anomalieBloccanti);
  if (practiceAnomalies?.anomalieWarning?.length) reasons.push(...practiceAnomalies.anomalieWarning);

  return { reviewManuale: reasons.length > 0, motiviReview: reasons };
}

function getDecisionCode({ stato, codiceBase, reviewManuale, classificazione, decisioneBackend, practiceAnomalies }) {
  if (stato === "precheck_failed") return DECISION_CODES.PRECHECK_FAILED;
  if (stato === "classified_rejected") {
    if (classificazione?.tipo_documento_rilevato !== codiceBase) return DECISION_CODES.DOC_WRONG_TYPE;
    if (classificazione?.gravemente_illeggibile) return DECISION_CODES.DOC_UNREADABLE;
    return DECISION_CODES.DOC_REJECTED;
  }
  if (practiceAnomalies?.hasBlocking) return DECISION_CODES.PRACTICE_BLOCKING_ANOMALY;
  if (DOC_GROUPS.identity.includes(codiceBase)) return reviewManuale ? DECISION_CODES.IDENTITY_REVIEW : DECISION_CODES.IDENTITY_OK;
  if (DOC_GROUPS.income.includes(codiceBase)) return reviewManuale ? DECISION_CODES.INCOME_REVIEW : DECISION_CODES.INCOME_OK;
  if (DOC_GROUPS.bank.includes(codiceBase)) {
    if ((decisioneBackend?.alertScommesse || []).length > 0) return DECISION_CODES.BANK_ALERT_GAMBLING;
    if (reviewManuale || decisioneBackend?.reviewManualeBanca) return DECISION_CODES.PRACTICE_REVIEW;
    return DECISION_CODES.BANK_OK;
  }
  if (DOC_GROUPS.realEstate.includes(codiceBase)) return reviewManuale ? DECISION_CODES.REALESTATE_REVIEW : DECISION_CODES.REALESTATE_OK;
  return reviewManuale ? DECISION_CODES.PRACTICE_REVIEW : DECISION_CODES.PRACTICE_OK;
}

module.exports = {
  calcolaRedditoBancarioMensilePrudenziale,
  calcolaDTI,
  calcolaLTV,
  scoreIncomeDecision,
  scoreBankDecision,
  reviewPolicy,
  getDecisionCode,
};
