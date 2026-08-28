const assert = require("assert");

const {
  calculateFinancialCommitments,
  calculatePracticeRatios,
} = require("../functions/src/services/practiceFinancialCalculator");

const {
  evaluatePolicy,
  buildPolicyContext,
} = require("../functions/src/services/rulesEngine");

const { POLICY } = require("../functions/src/config/policy");


assert.strictEqual(
  POLICY.classificationConfidenceReject,
  0.74
);

assert.strictEqual(
  POLICY.classificationConfidenceReview,
  0.80
);


const impegni =
  calculateFinancialCommitments({
    finanziamenti_dettaglio: [
      {
        istituto: "Compass",
        rata: "400",
        gestione: "ESTINGUERE",
      },
      {
        istituto: "Agos",
        rata: "200",
        gestione: "MANTENERE",
      },
    ],

    rata_mutuo_pre: "500",
    mutuo_pre_gestione: "ESTINGUERE",

    mantenimento_presenza_r1: "Si",
    mantenimento_tipo_r1: "PASSIVO",
    mantenimento_importo_r1: "300",

    canone_affitto: "700",
  });

assert.strictEqual(
  impegni.impegniFinanziariPre,
  1100
);

assert.strictEqual(
  impegni.impegniFinanziariPost,
  200
);

assert.strictEqual(
  impegni.impegniNonFinanziari,
  1000
);


const ratios =
  calculatePracticeRatios({
    redditoMensile: 3000,
    rataNuovoMutuo: 800,
    impegni,
  });

assert.strictEqual(
  ratios.dtiPost,
  33.33
);

assert.strictEqual(
  ratios.redditoResiduoPost,
  1000
);


const policy = {
  id: "test",
  bancaKey: "TEST",
  bancaNome: "Test Bank",
  prodottoKey: "mutuo",
  prodottoNome: "Mutuo Test",

  requiredDocuments: [
    "doc_cud",
    "doc_ec",
  ],

  thresholds: {
    ltvMax: 80,
    dtiMax: 40,
    redditoMinNettoMensile: 1200,
  },
};


const insufficient =
  evaluatePolicy(
    policy,
    {
      documentTypesPresent: [],
      ltv: null,
      dti: null,
      redditoBancarioMensile: null,
      tipoCliente: "generico",
    }
  );

assert.strictEqual(
  insufficient.eligible,
  false
);

assert.strictEqual(
  insufficient.compatibilityStatus,
  "DATI_INSUFFICIENTI"
);


const compatible =
  evaluatePolicy(
    policy,
    {
      documentTypesPresent: [
        "doc_cud",
        "doc_ec",
      ],
      ltv: 60,
      dti: 33,
      redditoBancarioMensile: 3000,
      tipoCliente: "generico",
    }
  );

assert.strictEqual(
  compatible.compatibilityStatus,
  "COMPATIBILE"
);

assert.strictEqual(
  compatible.eligible,
  true
);

console.log("AI PREDELIBERA 2.0 - test core OK");
