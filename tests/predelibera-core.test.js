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

const { calcolaDTI, calcolaLTV, reviewPolicy } = require("../functions/src/services/decisionEngine");

assert.strictEqual(calcolaDTI(3000, 500.50, 200.25), 23.36);
assert.strictEqual(calcolaDTI(3000, "500,50", "1.200,25"), 56.69);
assert.strictEqual(calcolaDTI(3000, null, 200), null);
assert.strictEqual(calcolaLTV(120000.50, 200000), 60);


const estrazione = {
  dati_estratti: { tipo_reddito: "dipendente", netto_mensile_rilevato_documento: "1850,50" },
};
const verificaBusta = reviewPolicy({ tipoDocumentoAtteso: "doc_bustepaga", estrazione });
assert.deepStrictEqual(verificaBusta.motiviReview, []);
const verificaCU = reviewPolicy({ tipoDocumentoAtteso: "doc_cud", estrazione });
assert(verificaCU.motiviReview.includes("CU: campo necessario non estratto (reddito_lordo_annuo)"));


const { calculatePracticeIncome } = require("../functions/src/services/practiceIncomeCalculator");
const fiscalDoc = (tipoDocumento, dati_estratti) => ({
  tipoDocumento,
  estrazione: { dati_estratti },
});
const cu = fiscalDoc("doc_cud1", {
  reddito_lordo_annuo: "36.000,00", irpef: "6.000,00", addizionale_regionale: "0", giorni_lavorati: "365",
});
const cuDirigente = fiscalDoc("doc_cud1", {
  ...cu.estrazione.dati_estratti, giorni_lavorati: "300", qualifica_quadro_dirigente: true,
});
const cedolino = fiscalDoc("doc_bustepaga1", {
  stipendio_lordo_mensile_ordinario: "2000", numero_mensilita: "13",
  irpef_annua_calcolata_bp: "3000", addizionale_regionale_annua_bp: "0",
  addizionale_comunale_annua_bp: "0",
});
assert.strictEqual(calculatePracticeIncome([cuDirigente, cedolino], {
  lav1: "INDETERMINATO",
}).redditoNettoMensile, 3041.67);
const pf2024 = fiscalDoc("doc_unici1", { anno_fiscale: "2024", tipo_reddito: "forfettario", lm36: "24.000,00" });
const pf2023 = fiscalDoc("doc_unici1", { anno_fiscale: "2023", tipo_reddito: "forfettario", lm36: "12.000,00" });
assert.strictEqual(calculatePracticeIncome([cu, pf2024, pf2023], { lav1: "INDETERMINATO" }).redditoNettoMensile, 2500);
assert.strictEqual(calculatePracticeIncome([cu, pf2024, pf2023], { lav1: "AUTONOMO" }).redditoNettoMensile, 1275);
const pfDuplicato = calculatePracticeIncome([cu, pf2024, pf2024], { lav1: "AUTONOMO", reddito_richiedente_1: 1700 });
assert.strictEqual(pfDuplicato.fonteReddito, "parzialmente_o_totalmente_non_verificato");
assert(pfDuplicato.criticita.some(reason => reason.includes("Modello Redditi PF")));
const senzaCU = calculatePracticeIncome([pf2024, pf2023], { lav1: "INDETERMINATO" });
assert.strictEqual(senzaCU.redditoNettoMensile, null);
const senzaCUSecondoRichiedente = calculatePracticeIncome([cu], { cliente2_nome: "Collaudo" });
assert.strictEqual(senzaCUSecondoRichiedente.fonteReddito, "parzialmente_o_totalmente_non_verificato");


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
