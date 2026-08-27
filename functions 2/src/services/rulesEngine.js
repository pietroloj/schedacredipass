const { normalizeNumber } = require("../utils/numbers");
const { safeString } = require("../utils/strings");

function inferTipoCliente(snapshot = {}) {
  if (snapshot?.reddito?.dataAssunzione) return "dipendente";
  if (snapshot?.reddito?.isee && !snapshot?.reddito?.dataAssunzione) return "privato";
  return "generico";
}

function evaluateRequiredDocuments(policy, documentTypesPresent) {
  const required = policy.requiredDocuments || [];
  const missing = required.filter((doc) => !documentTypesPresent.includes(doc));
  return {
    required,
    missing,
    ok: missing.length === 0,
  };
}

function evaluateThresholds(policy, ctx) {
  const thresholds = policy.thresholds || {};
  const reasons = [];
  const warnings = [];

  const ltv = normalizeNumber(ctx.ltv);
  const dti = normalizeNumber(ctx.dti);
  const reddito = normalizeNumber(ctx.redditoBancarioMensile);

  if (thresholds.ltvMax !== undefined && ltv !== null && ltv > thresholds.ltvMax) {
    reasons.push(`LTV superiore alla soglia policy (${ltv}% > ${thresholds.ltvMax}%)`);
  }

  if (thresholds.dtiMax !== undefined && dti !== null && dti > thresholds.dtiMax) {
    reasons.push(`DTI superiore alla soglia policy (${dti}% > ${thresholds.dtiMax}%)`);
  } else if (thresholds.dtiWarning !== undefined && dti !== null && dti > thresholds.dtiWarning) {
    warnings.push(`DTI in area warning (${dti}% > ${thresholds.dtiWarning}%)`);
  }

  if (thresholds.redditoMinNettoMensile !== undefined && reddito !== null && reddito < thresholds.redditoMinNettoMensile) {
    reasons.push(`Reddito netto mensile inferiore al minimo policy (${reddito} < ${thresholds.redditoMinNettoMensile})`);
  }

  return { reasons, warnings };
}

function evaluateHardRules(policy, ctx) {
  const rules = policy.hardRules || {};
  const reasons = [];

  if (rules.requireIdentityMatch && ctx.identityMismatch) {
    reasons.push("Mismatch identitario non ammesso dalla policy");
  }

  if (rules.requireCatastoMatch && ctx.catastoMismatch) {
    reasons.push("Mismatch catastale non ammesso dalla policy");
  }

  if (rules.requireAttoPreliminareMatch && ctx.attoPreliminareMismatch) {
    reasons.push("Mismatch tra atto e preliminare non ammesso dalla policy");
  }

  if (rules.requireApeIfAcquisto && ctx.finalita === "acquisto" && !ctx.hasApe) {
    reasons.push("APE richiesto dalla policy ma non presente");
  }

  if (rules.allowRistrutturazione === false && ctx.hasLavori) {
    reasons.push("Policy non adatta a pratica con lavori/ristrutturazione");
  }

  if (rules.allowSurroga === false && ctx.finalita === "surroga") {
    reasons.push("Policy non adatta a surroga");
  }

  return reasons;
}

function scorePolicyFit(policy, ctx, requiredDocsEval, thresholdsEval, hardRuleReasons) {
  const w = policy.scoringWeights || {};
  let score = w.base ?? 50;

  if (hardRuleReasons.length) score -= (w.blockingAnomalyPenalty ?? 100);
  if (requiredDocsEval.missing.length) score -= (w.missingRequiredDocumentPenalty ?? 20);

  if (ctx.ltv !== null) {
    if (ctx.ltv < 60) score += (w.ltvBonusUnder60 ?? 10);
    else if (ctx.ltv < 80) score += (w.ltvBonusUnder80 ?? 5);
  }

  if (ctx.dti !== null) {
    if (ctx.dti < 30) score += (w.dtiBonusUnder30 ?? 12);
    else if (ctx.dti < 35) score += (w.dtiBonusUnder35 ?? 6);
  }

  if (ctx.tempoIndeterminato) score += (w.tempoIndeterminatoBonus ?? 8);
  if (ctx.anzianitaOver5) score += (w.anzianitaBonusOver5 ?? 6);
  if (ctx.bankClean) score += (w.bankCleanBonus ?? 8);
  if (ctx.hasCessioneQuinto) score -= (w.cessioneQuintoPenalty ?? 10);
  if (ctx.hasPignoramento) score -= (w.pignoramentoPenalty ?? 40);
  if (ctx.hasGambling) score -= (w.gamblingPenalty ?? 30);

  score = Math.max(0, Math.min(100, score));
  return score;
}

function buildPolicyContext({ practiceSummary, documentAnalyses, anomalies, mergedFinancials, finalitaMutuo }) {
  const docTypes = documentAnalyses.map((d) => d.tipoDocumento);
  const incomeDoc = documentAnalyses.find((d) => ["doc_cud", "doc_unici", "doc_bustepaga"].includes(d.tipoDocumento));
  const bankDoc = documentAnalyses.find((d) => ["doc_ec", "doc_mov"].includes(d.tipoDocumento));

  const incomeData = incomeDoc?.estrazione?.dati_estratti || {};
  const bankDecision = bankDoc?.decisioneBackend || {};

  const dataAssunzione = safeString(incomeData.data_assunzione);
  const year = Number(String(dataAssunzione).slice(0, 4));
  const anzianitaOver5 = Number.isFinite(year) ? (new Date().getFullYear() - year >= 5) : false;

  const blocking = anomalies?.anomalieBloccanti || [];
  const warning = anomalies?.anomalieWarning || [];

  return {
    finalita: safeString(finalitaMutuo).toLowerCase(),
    documentTypesPresent: docTypes,
    ltv: mergedFinancials?.ltv ?? null,
    dti: mergedFinancials?.dti ?? null,
    redditoBancarioMensile: mergedFinancials?.redditoBancarioMensile ?? null,
    tempoIndeterminato: !!incomeData.tempo_indeterminato,
    anzianitaOver5,
    bankClean: !bankDecision.alertScommesse?.length && !warning.includes("Contratto di finanziamento presente ma rata non rilevata nei movimenti bancari"),
    hasCessioneQuinto: !!incomeData.cessione_del_quinto_presente,
    hasPignoramento: !!incomeData.pignoramento_presente,
    hasGambling: !!bankDecision.alertScommesse?.length,
    hasApe: docTypes.includes("doc_ape"),
    hasLavori: docTypes.includes("doc_preventivo") || !!practiceSummary?.riepilogo?.operazione?.importoLavori,
    identityMismatch: blocking.includes("Codice fiscale non coerente tra i documenti identitari"),
    catastoMismatch: blocking.some((x) => x.toLowerCase().includes("catast")),
    attoPreliminareMismatch: blocking.some((x) => x.toLowerCase().includes("atto di provenienza e preliminare")),
    tipoCliente: inferTipoCliente(practiceSummary?.riepilogo || {}),
  };
}

function evaluatePolicy(policy, ctx) {
  const documentTypesPresent = ctx.documentTypesPresent || [];
  const requiredDocsEval = evaluateRequiredDocuments(policy, documentTypesPresent);
  const thresholdsEval = evaluateThresholds(policy, ctx);
  const hardRuleReasons = evaluateHardRules(policy, ctx);

  const targetClienti = policy.targetClienti || [];
  const targetClienteMismatch = targetClienti.length && !targetClienti.includes(ctx.tipoCliente) && !targetClienti.includes("generico");

  const extraReasons = [];
  if (targetClienteMismatch) {
    extraReasons.push(`Prodotto non ottimizzato per tipo cliente ${ctx.tipoCliente}`);
  }

  const allReasons = [
    ...hardRuleReasons,
    ...thresholdsEval.reasons,
    ...extraReasons,
  ];

  const score = scorePolicyFit(policy, ctx, requiredDocsEval, thresholdsEval, hardRuleReasons);

  const eligible = allReasons.length === 0;

  return {
    policyId: policy.id,
    bancaKey: policy.bancaKey,
    bancaNome: policy.bancaNome,
    prodottoKey: policy.prodottoKey,
    prodottoNome: policy.prodottoNome,
    eligible,
    score,
    priority: policy.priorita ?? 0,
    missingDocuments: requiredDocsEval.missing,
    blockingReasons: allReasons,
    warnings: thresholdsEval.warnings,
    strengths: policy.notesTemplate?.strengths || [],
    weaknesses: policy.notesTemplate?.weaknesses || [],
    policySource: policy.policySource || null,
  };
}

function rankPolicyResults(results = []) {
  return [...results].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return (b.priority || 0) - (a.priority || 0);
  });
}

module.exports = {
  buildPolicyContext,
  evaluatePolicy,
  rankPolicyResults,
};
