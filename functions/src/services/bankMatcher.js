const {
  listActiveBankPolicies,
} = require("../repositories/bankPolicyRepository");

const {
  buildPolicyContext,
  evaluatePolicy,
  rankPolicyResults,
} = require("./rulesEngine");


async function matchBanksForPractice({
  practiceSummary,
  documentAnalyses,
  anomalies,
  mergedFinancials,
  finalitaMutuo,
}) {
  const policies =
    await listActiveBankPolicies();

  const ctx =
    buildPolicyContext({
      practiceSummary,
      documentAnalyses,
      anomalies,
      mergedFinancials,
      finalitaMutuo,
    });

  const filtered =
    policies.filter(
      p => {
        if (
          !Array.isArray(
            p.finalita
          )
          ||
          p.finalita.length ===
            0
        ) {
          return true;
        }

        return p.finalita.includes(
          ctx.finalita
        );
      }
    );

  const evaluated =
    filtered.map(
      policy =>
        evaluatePolicy(
          policy,
          ctx
        )
    );

  const ranked =
    rankPolicyResults(
      evaluated
    );

  const compatibili =
    ranked.filter(
      x =>
        x.compatibilityStatus ===
        "COMPATIBILE"
    );

  const conCondizioni =
    ranked.filter(
      x =>
        x.compatibilityStatus ===
        "COMPATIBILE_CON_CONDIZIONI"
    );

  const datiInsufficienti =
    ranked.filter(
      x =>
        x.compatibilityStatus ===
        "DATI_INSUFFICIENTI"
    );

  const nonCompatibili =
    ranked.filter(
      x =>
        x.compatibilityStatus ===
        "NON_COMPATIBILE"
    );

  return {
    context:
      ctx,

    totalPolicies:
      policies.length,

    evaluatedPolicies:
      ranked,

    /*
     * Retrocompatibilità dashboard storica.
     */
    consigliate:
      [
        ...compatibili,
        ...conCondizioni,
      ]
        .slice(
          0,
          5
        ),

    alternative:
      [
        ...datiInsufficienti,
        ...nonCompatibili,
      ]
        .slice(
          0,
          5
        ),

    compatibili:
      compatibili.slice(
        0,
        5
      ),

    compatibiliConCondizioni:
      conCondizioni.slice(
        0,
        5
      ),

    datiInsufficienti:
      datiInsufficienti.slice(
        0,
        5
      ),

    nonCompatibili:
      nonCompatibili.slice(
        0,
        5
      ),
  };
}


module.exports = {
  matchBanksForPractice,
};
