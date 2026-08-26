const { POLICY } = require("../config/policy");
const {
  DECISION_CODES,
  GAMBLING_KEYWORDS,
  DOC_GROUPS,
} = require("../config/documents");

const {
  normalizeNumber,
  round2,
  formatNumberIT,
} = require("../utils/numbers");

const { notEmpty } = require("../utils/strings");

const {
  calculateIncomeFromCU,
  looksLikeCU,
} = require("./incomeCalculator");


function containsGamblingKeyword(text = "") {
  const lower = String(text || "").toLowerCase();

  return (GAMBLING_KEYWORDS || []).some(
    (k) => lower.includes(String(k).toLowerCase())
  );
}


function calcolaRedditoBancarioMensilePrudenziale(
  estratti = {}
) {
  if (!looksLikeCU(estratti)) {
    return null;
  }

  const result =
    calculateIncomeFromCU(
      estratti
    );

  return result.ok
    ? result.redditoNettoMensile
    : null;
}


function calcolaDTI(
  redditoMensile,
  rataMutuo,
  altreRate
) {
  const reddito =
    normalizeNumber(
      redditoMensile
    );

  const rata =
    normalizeNumber(
      rataMutuo
    );

  const altre =
    normalizeNumber(
      altreRate
    ) || 0;

  /*
   * Se manca la nuova rata non restituiamo 0%.
   * Il DTI non è calcolabile.
   */
  if (
    !Number.isFinite(reddito) ||
    reddito <= 0 ||
    !Number.isFinite(rata) ||
    rata <= 0
  ) {
    return null;
  }

  return round2(
    ((rata + altre) / reddito) * 100
  );
}


function calcolaLTV(
  importoMutuo,
  valoreImmobile
) {
  const importo =
    normalizeNumber(
      importoMutuo
    );

  const valore =
    normalizeNumber(
      valoreImmobile
    );

  if (
    !Number.isFinite(importo) ||
    importo <= 0 ||
    !Number.isFinite(valore) ||
    valore <= 0
  ) {
    return null;
  }

  return round2(
    (importo / valore) * 100
  );
}


function scoreIncomeDecision({
  estrazione,
  data = {},
}) {
  const estratti =
    estrazione?.dati_estratti ||
    {};

  const dettaglioCU =
    looksLikeCU(estratti)
      ? calculateIncomeFromCU(
          estratti
        )
      : {
          ok: false,
          fonte: "NON_CU",
          campiMancanti: [],
        };

  const nettoMensile =
    dettaglioCU.ok
      ? dettaglioCU
          .redditoNettoMensile
      : null;

  const dti =
    calcolaDTI(
      nettoMensile,
      data.rataMutuoStimata,
      data.rateAltriFinanziamenti
    );

  const ltv =
    calcolaLTV(
      data.importoMutuo,
      data.valoreImmobile
    );

  const criticita = [
    ...(
      estrazione
        ?.criticita_documentali ||
      []
    ),
  ];

  const puntiForza = [
    ...(
      estrazione
        ?.punti_forza_documentali ||
      []
    ),
  ];

  if (
    looksLikeCU(estratti) &&
    !dettaglioCU.ok
  ) {
    for (
      const campo of
      dettaglioCU.campiMancanti ||
      []
    ) {
      criticita.push(
        `Calcolo reddito CU non completabile: manca ${campo}`
      );
    }
  }

  if (
    estratti
      .tempo_indeterminato
  ) {
    puntiForza.push(
      "Contratto a tempo indeterminato rilevato"
    );
  }

  if (
    notEmpty(
      estratti
        .data_assunzione
    )
  ) {
    puntiForza.push(
      `Data assunzione rilevata: ${estratti.data_assunzione}`
    );
  }

  if (
    estratti
      .cessione_del_quinto_presente
  ) {
    criticita.push(
      "Cessione del quinto rilevata"
    );
  }

  if (
    estratti
      .pignoramento_presente
  ) {
    criticita.push(
      "Pignoramento rilevato"
    );
  }

  let score = 50;

  if (
    nettoMensile !== null
  ) {
    if (
      nettoMensile >= 2000
    ) {
      score += 14;
    }
    else if (
      nettoMensile >= 1600
    ) {
      score += 10;
    }
    else if (
      nettoMensile >= 1300
    ) {
      score += 6;
    }
    else if (
      nettoMensile >= 1000
    ) {
      score += 3;
    }
  }

  if (
    estratti
      .tempo_indeterminato
  ) {
    score += 12;
  }

  if (
    dti !== null
  ) {
    if (
      dti <= 30
    ) {
      score += 16;
    }
    else if (
      dti <= POLICY.dtiWarning
    ) {
      score += 10;
    }
    else if (
      dti <= 40
    ) {
      score += 4;
    }
    else if (
      dti <= POLICY.dtiCritical
    ) {
      score -= 6;
    }
    else {
      score -= 16;
    }
  }

  score -=
    Math.min(
      criticita.length * 4,
      POLICY.maxCriticitaPenalty
    );

  score =
    Math.max(
      0,
      Math.min(
        100,
        score
      )
    );

  const fascia =
    score >= 85
      ? "A"
      : score >= 70
      ? "B"
      : score >= 55
      ? "C"
      : "D";

  return {
    redditoBancarioMensile:
      nettoMensile,

    dettaglioCalcoloRedditoCU:
      dettaglioCU,

    fonteReddito:
      dettaglioCU.ok
        ? "CU_VERIFICATA"
        : "DOCUMENTO_NON_CALCOLABILE",

    dti,
    ltv,
    score,
    fascia,
    criticita,
    puntiForza,

    report: [
      "📄 REPORT REDDITUALE",

      `Reddito bancario mensile: ${
        nettoMensile !== null
          ? `€ ${formatNumberIT(nettoMensile)}`
          : "N/D"
      }`,

      dettaglioCU.ok
        ? `Reddito lordo CU: € ${formatNumberIT(dettaglioCU.redditoLordoAnnuo)}`
        : "Reddito lordo CU: N/D",

      dettaglioCU.ok
        ? `Netto annuo CU dopo trattenute: € ${formatNumberIT(dettaglioCU.redditoNettoAnnuo)}`
        : "Netto annuo CU dopo trattenute: N/D",

      dettaglioCU.ok
        ? `Giorni lavorati: ${dettaglioCU.giorniLavorati}`
        : "Giorni lavorati: N/D",

      dettaglioCU.ok
        ? `Mensilità considerate: ${dettaglioCU.mensilitaConsiderate}`
        : "Mensilità considerate: N/D",

      `Score: ${score}/100`,
      `Fascia: ${fascia}`,

      `DTI: ${
        dti !== null
          ? `${formatNumberIT(dti)}%`
          : "N/D"
      }`,

      `LTV: ${
        ltv !== null
          ? `${formatNumberIT(ltv)}%`
          : "N/D"
      }`,
    ].join("\n"),
  };
}


function normalizeTextArray(
  value
) {
  if (
    !Array.isArray(value)
  ) {
    return [];
  }

  return value
    .map((x) => {
      if (
        typeof x ===
        "string"
      ) {
        return x.trim();
      }

      if (
        x &&
        typeof x ===
          "object"
      ) {
        return [
          x.descrizione,
          x.causale,
          x.controparte,
          x.importo,
          x.data,
          x.note,
        ]
          .filter(Boolean)
          .join(" - ");
      }

      return "";
    })
    .filter(Boolean);
}


function containsAnyKeyword(
  text = "",
  keywords = []
) {
  const lower =
    String(
      text || ""
    ).toLowerCase();

  return keywords.some(
    (k) =>
      lower.includes(
        String(k)
          .toLowerCase()
      )
  );
}


function scoreBankDecision({
  estrazione,
}) {
  const bank =
    estrazione || {};

  const gamblingRaw =
    normalizeTextArray(
      bank
        .movimenti_gambling_rilevati
    );

  const recurring =
    normalizeTextArray(
      bank
        .movimenti_ricorrenti
    );

  const rates =
    normalizeTextArray(
      bank
        .rate_rilevate
    );

  const salaries =
    normalizeTextArray(
      bank
        .stipendi_rilevati
    );

  const gambling =
    gamblingRaw.filter(
      (x) =>
        containsGamblingKeyword(
          x
        ) ||
        containsAnyKeyword(
          x,
          [
            "snai",
            "sisal",
            "lottomatica",
            "eurobet",
            "bet365",
            "pokerstars",
            "planetwin",
            "goldbet",
            "betfair",
            "william hill",
            "bwin",
            "admiralbet",
            "better",
            "scommessa",
            "scommesse",
            "gaming",
            "gioco",
          ]
        )
    );

  const cashMovements =
    recurring.filter(
      (x) =>
        containsAnyKeyword(
          x,
          [
            "versamento contanti",
            "versamento di contanti",
            "versamento cash",
            "prelievo contanti",
            "prelievo atm",
            "prelievo bancomat",
            "sportello contanti",
            "cash",
          ]
        )
    );

  const extraordinaryMovements =
    recurring.filter(
      (x) =>
        containsAnyKeyword(
          x,
          [
            "entrata straordinaria",
            "bonifico straordinario",
            "vendita preziosi",
            "vendita oro",
            "vendita bene",
            "prestito ricevuto",
            "giroconto",
            "trasferimento da altro conto",
          ]
        )
    );

  const collectionMovements =
    recurring.filter(
      (x) =>
        containsAnyKeyword(
          x,
          [
            "agenzia entrate",
            "agenzia delle entrate",
            "riscossione",
            "ader",
            "pignor",
            "precetto",
          ]
        )
    );

  const cryptoMovements =
    recurring.filter(
      (x) =>
        containsAnyKeyword(
          x,
          [
            "binance",
            "coinbase",
            "crypto.com",
            "kraken",
            "bitstamp",
            "bitpanda",
            "criptovalut",
            "crypto",
          ]
        )
    );

  const criticita = [
    ...(
      bank
        .criticita_documentali ||
      []
    ),
  ];

  const puntiForza = [
    ...(
      bank
        .punti_forza_documentali ||
      []
    ),
  ];

  if (
    bank
      .saldo_negativo_o_scoperti
  ) {
    criticita.push(
      "Saldo negativo, scoperto, insoluto o utilizzo anomalo del fido rilevato"
    );
  }

  if (
    rates.length > 0
  ) {
    criticita.push(
      `Rilevati ${rates.length} movimenti potenzialmente riconducibili a rate/finanziamenti`
    );
  }

  if (
    gambling.length > 0
  ) {
    criticita.push(
      `Rilevati ${gambling.length} movimenti riconducibili a gioco/scommesse`
    );
  }

  if (
    cashMovements.length > 0
  ) {
    criticita.push(
      `Rilevati ${cashMovements.length} movimenti in contanti/prelievi ATM meritevoli di verifica`
    );
  }

  if (
    extraordinaryMovements
      .length > 0
  ) {
    criticita.push(
      "Rilevate entrate o movimentazioni straordinarie da non assimilare automaticamente a risparmio ordinario"
    );
  }

  if (
    collectionMovements
      .length > 0
  ) {
    criticita.push(
      "Rilevati movimenti verso enti di riscossione o causali assimilabili da approfondire"
    );
  }

  if (
    cryptoMovements.length > 0
  ) {
    criticita.push(
      "Rilevati movimenti verso operatori crypto/exchange da contestualizzare"
    );
  }

  if (
    salaries.length > 0
  ) {
    puntiForza.push(
      `Rilevati ${salaries.length} accrediti riconducibili a stipendio/pensione`
    );
  }

  if (
    !bank
      .saldo_negativo_o_scoperti
  ) {
    puntiForza.push(
      "Nessun saldo negativo/scoperto esplicitamente rilevato"
    );
  }

  let score = 82;

  if (
    bank
      .saldo_negativo_o_scoperti
  ) {
    score -= 22;
  }

  score -=
    Math.min(
      rates.length * 4,
      16
    );

  score -=
    Math.min(
      gambling.length * 10,
      35
    );

  score -=
    Math.min(
      cashMovements.length * 4,
      16
    );

  score -=
    Math.min(
      extraordinaryMovements.length * 4,
      12
    );

  score -=
    Math.min(
      collectionMovements.length * 10,
      20
    );

  score -=
    Math.min(
      cryptoMovements.length * 3,
      9
    );

  if (
    salaries.length >= 2
  ) {
    score += 4;
  }

  score =
    Math.max(
      0,
      Math.min(
        100,
        score
      )
    );

  const severita =
    bank
      .saldo_negativo_o_scoperti ||
    collectionMovements.length >
      0 ||
    gambling.length >= 3
      ? "alta"
      : gambling.length > 0 ||
        cashMovements.length > 0 ||
        rates.length > 0 ||
        extraordinaryMovements
          .length > 0
      ? "media"
      : "bassa";

  return {
    scoreComportamentoBancario:
      score,

    severitaComportamentoBancario:
      severita,

    reviewManualeBanca:
      criticita.length > 0,

    alertScommesse:
      gambling,

    alertContanti:
      cashMovements,

    alertRateFinanziamenti:
      rates,

    alertEntrateStraordinarie:
      extraordinaryMovements,

    alertRiscossione:
      collectionMovements,

    alertCrypto:
      cryptoMovements,

    accreditiStipendioPensione:
      salaries,

    saldoNegativoOScoperti:
      Boolean(
        bank
          .saldo_negativo_o_scoperti
      ),

    criticita,
    puntiForza,

    reportBancario: [
      "🏦 ANALISI COMPORTAMENTO BANCARIO",
      `Score comportamento bancario: ${score}/100`,
      `Severità: ${severita}`,
      `Saldo negativo/scoperti: ${
        bank.saldo_negativo_o_scoperti
          ? "Sì"
          : "No"
      }`,
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


function reviewPolicy({
  classificazione,
  estrazione,
  tipoDocumentoAtteso,
  practiceAnomalies,
}) {
  const reasons = [];

  if (
    classificazione
      ?.confidenza_classificazione <
    POLICY
      .classificationConfidenceReview
  ) {
    reasons.push(
      "Confidenza classificazione inferiore alla soglia professionale"
    );
  }

  if (
    POLICY
      .requireManualReviewOnPartialDocument &&
    classificazione
      ?.leggibile_umano &&
    !classificazione
      ?.documento_completo_inquadrato
  ) {
    reasons.push(
      "Documento leggibile ma parzialmente tagliato"
    );
  }

  if (
    DOC_GROUPS
      .income
      .includes(
        tipoDocumentoAtteso
      )
  ) {
    const d =
      estrazione
        ?.dati_estratti ||
      {};

    if (
      POLICY
        .requireManualReviewOnMissingIncomeCoreFields &&
      looksLikeCU(d)
    ) {
      const result =
        calculateIncomeFromCU(
          d
        );

      if (
        !result.ok
      ) {
        for (
          const campo of
          result
            .campiMancanti ||
          []
        ) {
          reasons.push(
            `CU: campo necessario non estratto (${campo})`
          );
        }
      }
    }
  }

  if (
    DOC_GROUPS
      .identity
      .includes(
        tipoDocumentoAtteso
      )
  ) {
    const d =
      estrazione
        ?.dati_estratti ||
      {};

    if (
      POLICY
        .requireManualReviewOnMissingIdentityCoreFields &&
      (
        !notEmpty(d.nome) ||
        !notEmpty(d.cognome)
      )
    ) {
      reasons.push(
        "Dati anagrafici principali incompleti"
      );
    }
  }

  if (
    DOC_GROUPS
      .bank
      .includes(
        tipoDocumentoAtteso
      )
  ) {
    const bankDecision =
      scoreBankDecision({
        estrazione,
      });

    if (
      bankDecision
        .reviewManualeBanca
    ) {
      reasons.push(
        ...bankDecision
          .criticita
      );
    }
  }

  if (
    practiceAnomalies
      ?.hasBlocking
  ) {
    reasons.push(
      ...(
        practiceAnomalies
          .anomalieBloccanti ||
        []
      )
    );
  }

  if (
    practiceAnomalies
      ?.anomalieWarning
      ?.length
  ) {
    reasons.push(
      ...practiceAnomalies
        .anomalieWarning
    );
  }

  return {
    reviewManuale:
      reasons.length > 0,

    motiviReview:
      Array.from(
        new Set(
          reasons
        )
      ),
  };
}


function getDecisionCode({
  stato,
  codiceBase,
  reviewManuale,
  classificazione,
  decisioneBackend,
  practiceAnomalies,
}) {
  if (
    stato ===
    "precheck_failed"
  ) {
    return DECISION_CODES
      .PRECHECK_FAILED;
  }

  if (
    stato ===
    "classified_rejected"
  ) {
    if (
      classificazione
        ?.tipo_documento_rilevato !==
      codiceBase
    ) {
      return DECISION_CODES
        .DOC_WRONG_TYPE;
    }

    if (
      classificazione
        ?.gravemente_illeggibile
    ) {
      return DECISION_CODES
        .DOC_UNREADABLE;
    }

    return DECISION_CODES
      .DOC_REJECTED;
  }

  if (
    practiceAnomalies
      ?.hasBlocking
  ) {
    return DECISION_CODES
      .PRACTICE_BLOCKING_ANOMALY;
  }

  if (
    DOC_GROUPS
      .identity
      .includes(codiceBase)
  ) {
    return reviewManuale
      ? DECISION_CODES
          .IDENTITY_REVIEW
      : DECISION_CODES
          .IDENTITY_OK;
  }

  if (
    DOC_GROUPS
      .income
      .includes(codiceBase)
  ) {
    return reviewManuale
      ? DECISION_CODES
          .INCOME_REVIEW
      : DECISION_CODES
          .INCOME_OK;
  }

  if (
    DOC_GROUPS
      .bank
      .includes(codiceBase)
  ) {
    if (
      (
        decisioneBackend
          ?.alertScommesse ||
        []
      ).length >
      0
    ) {
      return DECISION_CODES
        .BANK_ALERT_GAMBLING;
    }

    return reviewManuale ||
      decisioneBackend
        ?.reviewManualeBanca
      ? DECISION_CODES
          .PRACTICE_REVIEW
      : DECISION_CODES
          .BANK_OK;
  }

  if (
    DOC_GROUPS
      .realEstate
      .includes(codiceBase)
  ) {
    return reviewManuale
      ? DECISION_CODES
          .REALESTATE_REVIEW
      : DECISION_CODES
          .REALESTATE_OK;
  }

  return reviewManuale
    ? DECISION_CODES
        .PRACTICE_REVIEW
    : DECISION_CODES
        .PRACTICE_OK;
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
