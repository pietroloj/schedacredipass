const { normalizeNumber } = require("../utils/numbers");
const { safeString } = require("../utils/strings");


function baseDocumentType(doc = {}) {
  return String(
    doc.tipoDocumentoBase ||
    doc.tipoDocumento ||
    ""
  )
    .replace(/\d+$/, "")
    .toLowerCase();
}


function inferTipoCliente(
  snapshot = {},
  documentAnalyses = []
) {
  const incomeDoc =
    documentAnalyses.find(
      d => [
        "doc_cud",
        "doc_unici",
        "doc_bustepaga",
      ].includes(
        baseDocumentType(d)
      )
    );

  const data =
    incomeDoc
      ?.estrazione
      ?.dati_estratti ||
    {};

  const explicit =
    safeString(
      data.tipo_lavoratore ||
      data.tipologia_lavoratore ||
      data.categoria_reddituale ||
      data.tipo_reddito
    )
      .toLowerCase();

  if (
    explicit.includes("pension")
  ) {
    return "pensionato";
  }

  if (
    explicit.includes("forfett")
  ) {
    return "forfettario";
  }

  if (
    explicit.includes("autonom")
    ||
    explicit.includes("profession")
    ||
    explicit.includes("artigian")
    ||
    explicit.includes("commerci")
  ) {
    return "autonomo";
  }

  if (
    data.tempo_indeterminato
    ||
    data.data_assunzione
    ||
    snapshot?.reddito?.dataAssunzione
  ) {
    return "dipendente";
  }

  if (
    snapshot?.reddito?.isee
  ) {
    return "privato";
  }

  return "generico";
}


function evaluateRequiredDocuments(
  policy,
  documentTypesPresent
) {
  const required =
    (policy.requiredDocuments || [])
      .map(
        x =>
          String(x || "")
            .replace(/\d+$/, "")
            .toLowerCase()
      );

  const present =
    new Set(
      (documentTypesPresent || [])
        .map(
          x =>
            String(x || "")
              .replace(/\d+$/, "")
              .toLowerCase()
        )
    );

  const missing =
    required.filter(
      doc =>
        !present.has(doc)
    );

  return {
    required,
    missing,
    ok:
      missing.length === 0,
  };
}


function evaluateThresholds(
  policy,
  ctx
) {
  const thresholds =
    policy.thresholds ||
    {};

  const reasons = [];
  const warnings = [];
  const unknown = [];

  const ltv =
    normalizeNumber(
      ctx.ltv
    );

  const dti =
    normalizeNumber(
      ctx.dti
    );

  const reddito =
    normalizeNumber(
      ctx.redditoBancarioMensile
    );

  if (
    thresholds.ltvMax !==
    undefined
  ) {
    if (
      ltv === null
    ) {
      unknown.push(
        "LTV non disponibile"
      );
    }
    else if (
      ltv >
      thresholds.ltvMax
    ) {
      reasons.push(
        `LTV superiore alla soglia policy (${ltv}% > ${thresholds.ltvMax}%)`
      );
    }
  }

  if (
    thresholds.dtiMax !==
    undefined
  ) {
    if (
      dti === null
    ) {
      unknown.push(
        "DTI non disponibile"
      );
    }
    else if (
      dti >
      thresholds.dtiMax
    ) {
      reasons.push(
        `DTI superiore alla soglia policy (${dti}% > ${thresholds.dtiMax}%)`
      );
    }
    else if (
      thresholds.dtiWarning !==
      undefined
      &&
      dti >
      thresholds.dtiWarning
    ) {
      warnings.push(
        `DTI in area warning (${dti}% > ${thresholds.dtiWarning}%)`
      );
    }
  }

  if (
    thresholds.redditoMinNettoMensile !==
    undefined
  ) {
    if (
      reddito === null
    ) {
      unknown.push(
        "Reddito netto mensile non disponibile"
      );
    }
    else if (
      reddito <
      thresholds
        .redditoMinNettoMensile
    ) {
      reasons.push(
        `Reddito netto mensile inferiore al minimo policy (${reddito} < ${thresholds.redditoMinNettoMensile})`
      );
    }
  }

  return {
    reasons,
    warnings,
    unknown,
  };
}


function evaluateHardRules(
  policy,
  ctx
) {
  const rules =
    policy.hardRules ||
    {};

  const reasons = [];

  if (
    rules.requireIdentityMatch
    &&
    ctx.identityMismatch
  ) {
    reasons.push(
      "Mismatch identitario non ammesso dalla policy"
    );
  }

  if (
    rules.requireCatastoMatch
    &&
    ctx.catastoMismatch
  ) {
    reasons.push(
      "Mismatch catastale non ammesso dalla policy"
    );
  }

  if (
    rules.requireAttoPreliminareMatch
    &&
    ctx.attoPreliminareMismatch
  ) {
    reasons.push(
      "Mismatch tra atto e preliminare non ammesso dalla policy"
    );
  }

  if (
    rules.requireApeIfAcquisto
    &&
    ctx.finalita ===
      "acquisto"
    &&
    !ctx.hasApe
  ) {
    reasons.push(
      "APE richiesto dalla policy ma non presente"
    );
  }

  if (
    rules.allowRistrutturazione ===
      false
    &&
    ctx.hasLavori
  ) {
    reasons.push(
      "Policy non adatta a pratica con lavori/ristrutturazione"
    );
  }

  if (
    rules.allowSurroga ===
      false
    &&
    ctx.finalita ===
      "surroga"
  ) {
    reasons.push(
      "Policy non adatta a surroga"
    );
  }

  return reasons;
}


function scorePolicyFit(
  policy,
  ctx,
  requiredDocsEval,
  thresholdsEval,
  hardRuleReasons
) {
  const w =
    policy.scoringWeights ||
    {};

  let score =
    w.base ??
    50;

  if (
    hardRuleReasons.length
  ) {
    score -=
      (
        w.blockingAnomalyPenalty ??
        100
      );
  }

  if (
    requiredDocsEval
      .missing
      .length
  ) {
    score -=
      (
        w.missingRequiredDocumentPenalty ??
        20
      );
  }

  score -=
    Math.min(
      thresholdsEval
        .unknown
        .length
      *
      8,
      24
    );

  if (
    ctx.ltv !== null
  ) {
    if (
      ctx.ltv < 60
    ) {
      score +=
        (
          w.ltvBonusUnder60 ??
          10
        );
    }
    else if (
      ctx.ltv < 80
    ) {
      score +=
        (
          w.ltvBonusUnder80 ??
          5
        );
    }
  }

  if (
    ctx.dti !== null
  ) {
    if (
      ctx.dti < 30
    ) {
      score +=
        (
          w.dtiBonusUnder30 ??
          12
        );
    }
    else if (
      ctx.dti < 35
    ) {
      score +=
        (
          w.dtiBonusUnder35 ??
          6
        );
    }
  }

  if (
    ctx.tempoIndeterminato
  ) {
    score +=
      (
        w.tempoIndeterminatoBonus ??
        8
      );
  }

  if (
    ctx.anzianitaOver5
  ) {
    score +=
      (
        w.anzianitaBonusOver5 ??
        6
      );
  }

  if (
    ctx.bankClean
  ) {
    score +=
      (
        w.bankCleanBonus ??
        8
      );
  }

  if (
    ctx.hasCessioneQuinto
  ) {
    score -=
      (
        w.cessioneQuintoPenalty ??
        10
      );
  }

  if (
    ctx.hasPignoramento
  ) {
    score -=
      (
        w.pignoramentoPenalty ??
        40
      );
  }

  if (
    ctx.hasGambling
  ) {
    score -=
      (
        w.gamblingPenalty ??
        30
      );
  }

  return Math.max(
    0,
    Math.min(
      100,
      score
    )
  );
}


function buildPolicyContext({
  practiceSummary,
  documentAnalyses,
  anomalies,
  mergedFinancials,
  finalitaMutuo,
}) {
  const docTypes =
    documentAnalyses.map(
      baseDocumentType
    );

  const incomeDoc =
    documentAnalyses.find(
      d =>
        [
          "doc_cud",
          "doc_unici",
          "doc_bustepaga",
        ].includes(
          baseDocumentType(d)
        )
    );

  const bankDoc =
    documentAnalyses.find(
      d =>
        [
          "doc_ec",
          "doc_mov",
        ].includes(
          baseDocumentType(d)
        )
    );

  const incomeData =
    incomeDoc
      ?.estrazione
      ?.dati_estratti ||
    {};

  const bankDecision =
    bankDoc
      ?.decisioneBackend ||
    {};

  const dataAssunzione =
    safeString(
      incomeData
        .data_assunzione
    );

  const year =
    Number(
      String(
        dataAssunzione
      )
        .slice(
          0,
          4
        )
    );

  const anzianitaOver5 =
    Number.isFinite(
      year
    )
      ? (
          new Date()
            .getFullYear()
          -
          year >=
          5
        )
      : false;

  const blocking =
    anomalies
      ?.anomalieBloccanti ||
    [];

  const warning =
    anomalies
      ?.anomalieWarning ||
    [];

  const bankDataAvailable =
    mergedFinancials
      ?.bankDataAvailable ===
    true;

  return {
    finalita:
      safeString(
        finalitaMutuo
      )
        .toLowerCase(),

    documentTypesPresent:
      docTypes,

    ltv:
      mergedFinancials
        ?.ltv ??
      null,

    /*
     * Per la compatibilità bancaria conta il DTI POST-operazione.
     */
    dti:
      mergedFinancials
        ?.dtiPost ??
      mergedFinancials
        ?.dti ??
      null,

    redditoBancarioMensile:
      mergedFinancials
        ?.redditoBancarioMensile ??
      null,

    tempoIndeterminato:
      Boolean(
        incomeData
          .tempo_indeterminato
      ),

    anzianitaOver5,

    bankDataAvailable,

    bankClean:
      bankDataAvailable
      &&
      !bankDecision
        .alertScommesse
        ?.length
      &&
      !bankDecision
        .saldoNegativoOScoperti
      &&
      !warning.includes(
        "Contratto di finanziamento presente ma rata non rilevata nei movimenti bancari"
      ),

    hasCessioneQuinto:
      Boolean(
        incomeData
          .cessione_del_quinto_presente
      ),

    hasPignoramento:
      Boolean(
        incomeData
          .pignoramento_presente
      ),

    hasGambling:
      Boolean(
        bankDecision
          .alertScommesse
          ?.length
      ),

    hasApe:
      docTypes.includes(
        "doc_ape"
      ),

    hasLavori:
      docTypes.includes(
        "doc_preventivo"
      )
      ||
      Boolean(
        practiceSummary
          ?.riepilogo
          ?.operazione
          ?.importoLavori
      ),

    identityMismatch:
      blocking.includes(
        "Codice fiscale non coerente tra i documenti identitari"
      ),

    catastoMismatch:
      blocking.some(
        x =>
          x
            .toLowerCase()
            .includes(
              "catast"
            )
      ),

    attoPreliminareMismatch:
      blocking.some(
        x =>
          x
            .toLowerCase()
            .includes(
              "atto di provenienza e preliminare"
            )
      ),

    tipoCliente:
      inferTipoCliente(
        practiceSummary
          ?.riepilogo ||
        {},
        documentAnalyses
      ),
  };
}


function evaluatePolicy(
  policy,
  ctx
) {
  const requiredDocsEval =
    evaluateRequiredDocuments(
      policy,
      ctx
        .documentTypesPresent ||
      []
    );

  const thresholdsEval =
    evaluateThresholds(
      policy,
      ctx
    );

  const hardRuleReasons =
    evaluateHardRules(
      policy,
      ctx
    );

  const targetClienti =
    policy.targetClienti ||
    [];

  const targetClienteMismatch =
    targetClienti.length
    &&
    !targetClienti.includes(
      ctx.tipoCliente
    )
    &&
    !targetClienti.includes(
      "generico"
    );

  const extraReasons = [];

  if (
    targetClienteMismatch
  ) {
    extraReasons.push(
      `Prodotto non ottimizzato per tipo cliente ${ctx.tipoCliente}`
    );
  }

  const blockingReasons = [
    ...hardRuleReasons,
    ...thresholdsEval.reasons,
    ...extraReasons,
  ];

  const insufficientReasons = [
    ...requiredDocsEval
      .missing
      .map(
        doc =>
          `Documento richiesto non disponibile: ${doc}`
      ),
    ...thresholdsEval
      .unknown,
  ];

  const warnings = [
    ...thresholdsEval
      .warnings,
  ];

  let compatibilityStatus =
    "COMPATIBILE";

  if (
    blockingReasons.length
  ) {
    compatibilityStatus =
      "NON_COMPATIBILE";
  }
  else if (
    insufficientReasons.length
  ) {
    compatibilityStatus =
      "DATI_INSUFFICIENTI";
  }
  else if (
    warnings.length
  ) {
    compatibilityStatus =
      "COMPATIBILE_CON_CONDIZIONI";
  }

  const score =
    scorePolicyFit(
      policy,
      ctx,
      requiredDocsEval,
      thresholdsEval,
      hardRuleReasons
    );

  return {
    policyId:
      policy.id,

    bancaKey:
      policy.bancaKey,

    bancaNome:
      policy.bancaNome,

    prodottoKey:
      policy.prodottoKey,

    prodottoNome:
      policy.prodottoNome,

    /*
     * eligible rimane per retrocompatibilità, ma è true
     * SOLO quando la compatibilità può essere realmente verificata.
     */
    eligible:
      compatibilityStatus ===
      "COMPATIBILE",

    compatibilityStatus,

    score,

    priority:
      policy.priorita ??
      0,

    missingDocuments:
      requiredDocsEval
        .missing,

    blockingReasons,

    insufficientReasons,

    warnings,

    strengths:
      policy
        .notesTemplate
        ?.strengths ||
      [],

    weaknesses:
      policy
        .notesTemplate
        ?.weaknesses ||
      [],

    policySource:
      policy
        .policySource ||
      null,
  };
}


function rankPolicyResults(
  results = []
) {
  const order = {
    COMPATIBILE:
      0,

    COMPATIBILE_CON_CONDIZIONI:
      1,

    DATI_INSUFFICIENTI:
      2,

    NON_COMPATIBILE:
      3,
  };

  return [
    ...results,
  ].sort(
    (a, b) => {
      const statusDiff =
        (
          order[
            a.compatibilityStatus
          ]
          ??
          99
        )
        -
        (
          order[
            b.compatibilityStatus
          ]
          ??
          99
        );

      if (
        statusDiff !==
        0
      ) {
        return statusDiff;
      }

      if (
        b.score !==
        a.score
      ) {
        return (
          b.score -
          a.score
        );
      }

      return (
        b.priority ||
        0
      )
      -
      (
        a.priority ||
        0
      );
    }
  );
}


module.exports = {
  baseDocumentType,
  buildPolicyContext,
  evaluatePolicy,
  rankPolicyResults,
};
