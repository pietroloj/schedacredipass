const { listActiveBankPolicies } = require("../repositories/bankPolicyRepository");
const { buildPolicyContext, evaluatePolicy, rankPolicyResults } = require("./rulesEngine");

async function matchBanksForPractice({ practiceSummary, documentAnalyses, anomalies, mergedFinancials, finalitaMutuo }) {
  const policies = await listActiveBankPolicies();

  const ctx = buildPolicyContext({
    practiceSummary,
    documentAnalyses,
    anomalies,
    mergedFinancials,
    finalitaMutuo,
  });

  const filtered = policies.filter((p) => {
    if (!Array.isArray(p.finalita) || p.finalita.length === 0) return true;
    return p.finalita.includes(ctx.finalita);
  });

  const evaluated = filtered.map((policy) => evaluatePolicy(policy, ctx));
  const ranked = rankPolicyResults(evaluated);

  const consigliate = ranked.filter((x) => x.eligible).slice(0, 5);
  const alternative = ranked.filter((x) => !x.eligible).slice(0, 5);

  return {
    context: ctx,
    totalPolicies: policies.length,
    evaluatedPolicies: ranked,
    consigliate,
    alternative,
  };
}

module.exports = { matchBanksForPractice };
