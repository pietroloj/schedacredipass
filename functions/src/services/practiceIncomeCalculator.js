const {
  normalizeNumber,
  round2,
} = require("../utils/numbers");

const {
  calculateIncomeFromCU,
  calculateUnicoOrdinaryAnnual,
  calculateUnicoOrdinaryTwoYears,
  calculateSingleUnico,
  calculateForfettarioTwoYears,
  calculateForfettarioCPBTwoYears,
  calculateOrdinaryCPBAnnual,
  calculateOrdinaryCPBTwoYears,
  calculateIncomeFromBP,
  calculateIncomeWithTrasferta,
  calculateQuadroDirigente,
  isForfettario,
  isCPB,
} = require("./incomeCalculator");


function baseType(
  doc = {}
) {
  return String(
    doc.tipoDocumentoBase ||
    doc.tipoDocumento ||
    ""
  )
    .replace(/\d+$/, "")
    .toLowerCase();
}


function applicantKey(
  doc = {}
) {
  const raw =
    String(
      doc.tipoDocumento ||
      ""
    );

  const match =
    raw.match(/(\d+)$/);

  return match
    ? `r${match[1]}`
    : "r1";
}


function yearOf(
  estratti = {}
) {
  return Number(
    String(
      estratti
        .anno_fiscale ||
      ""
    ).match(/\d{4}/)?.[0] ||
    0
  );
}


function sortLatestFirst(
  docs = []
) {
  return [...docs]
    .sort(
      (a, b) =>
        yearOf(
          b
            .estrazione
            ?.dati_estratti ||
          {}
        ) -
        yearOf(
          a
            .estrazione
            ?.dati_estratti ||
          {}
        )
    );
}


function scoreIncome(
  monthly,
  verified = true
) {
  const value =
    normalizeNumber(
      monthly
    );

  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return null;
  }

  let score = 55;

  if (value >= 3000) {
    score += 25;
  }
  else if (value >= 2200) {
    score += 20;
  }
  else if (value >= 1700) {
    score += 14;
  }
  else if (value >= 1300) {
    score += 8;
  }
  else if (value >= 1000) {
    score += 3;
  }

  if (verified) {
    score += 10;
  }

  return Math.max(
    0,
    Math.min(
      100,
      score
    )
  );
}


function calculateApplicantIncome(
  docs = [],
  practiceData = {},
  applicant = "r1"
) {
  const incomeDocs =
    docs.filter(
      (doc) => {
        const base =
          baseType(doc);

        return (
          base.includes(
            "doc_cud"
          ) ||
          base.includes(
            "doc_bustepaga"
          ) ||
          base.includes(
            "doc_unici"
          )
        );
      }
    );

  const cuDocs =
    incomeDocs.filter(
      (doc) =>
        baseType(doc)
          .includes(
            "doc_cud"
          )
    );

  const bpDocs =
    incomeDocs.filter(
      (doc) =>
        baseType(doc)
          .includes(
            "doc_bustepaga"
          )
    );

  const unicoDocs =
    sortLatestFirst(
      incomeDocs.filter(
        (doc) =>
          baseType(doc)
            .includes(
              "doc_unici"
            )
      )
    );

  const criticita = [];
  const dettagli = [];


  /*
   * 1) QUADRI / DIRIGENTI:
   * richiedono confronto CU + BP.
   */
  const latestCU =
    sortLatestFirst(
      cuDocs
    )[0];

  const latestBP =
    sortLatestFirst(
      bpDocs
    )[0];

  const cuData =
    latestCU
      ?.estrazione
      ?.dati_estratti ||
    null;

  const bpData =
    latestBP
      ?.estrazione
      ?.dati_estratti ||
    null;

  if (
    cuData &&
    cuData
      .qualifica_quadro_dirigente
  ) {
    const cuResult =
      calculateIncomeFromCU(
        cuData
      );

    const bpResult =
      bpData
        ? calculateIncomeFromBP(
            bpData
          )
        : {
            ok: false,
          };

    const quadro =
      calculateQuadroDirigente(
        cuResult,
        bpResult
      );

    if (quadro.ok) {
      return {
        ok: true,
        applicant,
        metodo:
          quadro.metodo,
        fonte:
          "CU + Busta Paga",
        redditoNettoMensile:
          quadro
            .redditoNettoMensile,
        dettagli: [
          cuResult,
          bpResult,
          quadro,
        ],
        criticita: [],
      };
    }

    criticita.push(
      "Quadro/Dirigente: impossibile applicare la regola perché servono sia CU sia calcolo BP completo."
    );
  }


  /*
   * 2) CU - DIPENDENTI / PENSIONATI
   */
  if (cuData) {
    const cu =
      calculateIncomeFromCU(
        cuData
      );

    dettagli.push(cu);

    if (cu.ok) {
      return {
        ok: true,
        applicant,
        metodo:
          cu.metodo,
        fonte:
          "Certificazione Unica",
        redditoNettoMensile:
          cu
            .redditoNettoMensile,
        dettagli,
        criticita,
      };
    }

    criticita.push(
      cu.errore ||
      `CU non calcolabile: ${(cu.campiMancanti || []).join(", ")}`
    );
  }


  /*
   * 3) MODELLO REDDITI / UNICO
   */
  if (unicoDocs.length) {
    const estratti =
      unicoDocs.map(
        (doc) =>
          doc
            .estrazione
            ?.dati_estratti ||
          {}
      );

    const latestData =
      estratti[0] ||
      {};

    /*
     * CPB FORFETTARIO
     */
    if (
      isForfettario(
        latestData
      ) &&
      isCPB(
        latestData
      )
    ) {
      const result =
        calculateForfettarioCPBTwoYears(
          estratti
        );

      if (result.ok) {
        return {
          ok: true,
          applicant,
          metodo:
            result.metodo,
          fonte:
            "Modelli Redditi - CPB forfettario",
          redditoNettoMensile:
            result
              .redditoNettoMensile,
          dettagli: [
            result,
          ],
          criticita,
        };
      }

      criticita.push(
        "CPB forfettario: servono gli ultimi due Modelli Redditi con LM34 e LM35."
      );
    }

    /*
     * FORFETTARIO STANDARD
     */
    else if (
      isForfettario(
        latestData
      )
    ) {
      const result =
        calculateForfettarioTwoYears(
          estratti
        );

      if (result.ok) {
        return {
          ok: true,
          applicant,
          metodo:
            result.metodo,
          fonte:
            "Modelli Redditi - Forfettario",
          redditoNettoMensile:
            result
              .redditoNettoMensile,
          dettagli: [
            result,
          ],
          criticita,
        };
      }

      criticita.push(
        "Forfettario: servono gli ultimi due Modelli Redditi con LM36."
      );
    }

    /*
     * CPB ORDINARIO
     */
    else if (
      isCPB(
        latestData
      )
    ) {
      const annual =
        estratti.map(
          calculateOrdinaryCPBAnnual
        );

      const result =
        calculateOrdinaryCPBTwoYears(
          annual
        );

      if (result.ok) {
        return {
          ok: true,
          applicant,
          metodo:
            result.metodo,
          fonte:
            "Modelli Redditi - CPB ordinario",
          redditoNettoMensile:
            result
              .redditoNettoMensile,
          dettagli: [
            ...annual,
            result,
          ],
          criticita,
        };
      }

      criticita.push(
        "CPB ordinario: servono due Modelli Redditi completi con CP10 e le imposte/addizionali riferibili."
      );
    }

    /*
     * ORDINARIO STANDARD
     */
    else {
      const annual =
        estratti.map(
          (e) => {
            const result =
              calculateUnicoOrdinaryAnnual(
                e
              );

            return {
              ...result,
              annoAttivitaIncompleto:
                Boolean(
                  e
                    .anno_attivita_incompleto
                ),
              singoloAmmissibile:
                Boolean(
                  e
                    .modello_unico_singolo_ammissibile
                ),
            };
          }
        );

      if (annual.length >= 2) {
        const result =
          calculateUnicoOrdinaryTwoYears(
            annual
          );

        if (result.ok) {
          return {
            ok: true,
            applicant,
            metodo:
              result.metodo,
            fonte:
              "Modelli Redditi - Ordinario",
            redditoNettoMensile:
              result
                .redditoNettoMensile,
            dettagli: [
              ...annual,
              result,
            ],
            criticita,
          };
        }
      }

      /*
       * Singolo modello solo se espressamente ammesso.
       */
      const latestAnnual =
        annual[0];

      const allowed =
        Boolean(
          latestAnnual
            ?.singoloAmmissibile
        ) ||
        Boolean(
          practiceData[
            applicant === "r2"
              ? "usa_singolo_modello_unico_r2"
              : "usa_singolo_modello_unico_r1"
          ]
        );

      const single =
        calculateSingleUnico(
          latestAnnual,
          allowed
        );

      if (single.ok) {
        return {
          ok: true,
          applicant,
          metodo:
            single.metodo,
          fonte:
            "Singolo Modello Redditi",
          redditoNettoMensile:
            single
              .redditoNettoMensile,
          dettagli: [
            latestAnnual,
            single,
          ],
          criticita,
        };
      }

      criticita.push(
        "Autonomo ordinario: non risultano disponibili due Modelli Redditi completi e non è dimostrata una condizione per utilizzare il singolo modello."
      );
    }
  }


  /*
   * 4) BUSTA PAGA - SOLO QUANDO NON SI PUÒ PROCEDERE DA CU
   */
  if (bpData) {
    const bp =
      calculateIncomeFromBP(
        bpData
      );

    dettagli.push(bp);

    if (bp.ok) {
      /*
       * Trasferta: se presente, applica il 70% della media.
       */
      const hasTrasferta =
        normalizeNumber(
          bpData
            .importo_trasferte_periodo
        ) >
        0;

      if (hasTrasferta) {
        const withTrasferta =
          calculateIncomeWithTrasferta(
            bp,
            bpData
          );

        if (
          withTrasferta.ok
        ) {
          return {
            ok: true,
            applicant,
            metodo:
              withTrasferta
                .metodo,
            fonte:
              "Busta Paga + Trasferta",
            redditoNettoMensile:
              withTrasferta
                .redditoNettoMensile,
            dettagli: [
              bp,
              withTrasferta,
            ],
            criticita,
          };
        }
      }

      return {
        ok: true,
        applicant,
        metodo:
          bp.metodo,
        fonte:
          "Busta Paga",
        redditoNettoMensile:
          bp
            .redditoNettoMensile,
        dettagli,
        criticita,
      };
    }

    criticita.push(
      bp.errore ||
      `Busta paga non calcolabile: ${(bp.campiMancanti || []).join(", ")}`
    );
  }


  /*
   * 5) FALLBACK SCHEDA CONSULENZA
   */
  const declared =
    applicant === "r2"
      ? normalizeNumber(
          practiceData
            .reddito_richiedente_2 ??
          practiceData
            .cliente2_reddito
        )
      : normalizeNumber(
          practiceData
            .reddito_richiedente_1 ??
          practiceData
            .cliente_reddito
        );

  if (
    Number.isFinite(
      declared
    ) &&
    declared > 0
  ) {
    return {
      ok: true,
      applicant,
      metodo:
        "SCHEDA_CONSULENZA_NON_VERIFICATA",
      fonte:
        "Scheda consulenza",
      redditoNettoMensile:
        declared,
      dettagli,
      criticita: [
        ...criticita,
        "Reddito utilizzato dalla scheda consulenza: da verificare con documentazione reddituale.",
      ],
      nonVerificato:
        true,
    };
  }


  return {
    ok: false,
    applicant,
    metodo:
      "NON_DISPONIBILE",
    fonte:
      "N/D",
    redditoNettoMensile:
      null,
    dettagli,
    criticita,
  };
}


function calculatePracticeIncome(
  documentAnalyses = [],
  practiceData = {}
) {
  const byApplicant = {
    r1: [],
    r2: [],
  };

  for (
    const doc of
    documentAnalyses
  ) {
    const applicant =
      applicantKey(doc);

    if (
      !byApplicant[
        applicant
      ]
    ) {
      byApplicant[
        applicant
      ] = [];
    }

    byApplicant[
      applicant
    ].push(doc);
  }

  const r1 =
    calculateApplicantIncome(
      byApplicant.r1 || [],
      practiceData,
      "r1"
    );

  const r2HasData =
    (
      byApplicant.r2 ||
      []
    ).length >
    0 ||
    normalizeNumber(
      practiceData
        .reddito_richiedente_2 ??
      practiceData
        .cliente2_reddito
    ) >
    0;

  const r2 =
    r2HasData
      ? calculateApplicantIncome(
          byApplicant.r2 || [],
          practiceData,
          "r2"
        )
      : null;

  const valid =
    [r1, r2]
      .filter(
        (x) =>
          x &&
          x.ok &&
          Number.isFinite(
            normalizeNumber(
              x
                .redditoNettoMensile
            )
          )
      );

  const total =
    valid.reduce(
      (sum, item) =>
        sum +
        normalizeNumber(
          item
            .redditoNettoMensile
        ),
      0
    );

  const anyUnverified =
    valid.some(
      (x) =>
        x.nonVerificato
    );

  const criticita =
    Array.from(
      new Set(
        [r1, r2]
          .filter(Boolean)
          .flatMap(
            (x) =>
              x
                .criticita ||
              []
          )
      )
    );

  return {
    ok:
      total > 0,

    redditoNettoMensile:
      total > 0
        ? round2(total)
        : null,

    fonteReddito:
      anyUnverified
        ? "parzialmente_o_totalmente_non_verificato"
        : valid.length
        ? "documentazione_verificata"
        : "non_disponibile",

    redditiPerRichiedente: {
      r1,
      ...(r2
        ? { r2 }
        : {}),
    },

    score:
      total > 0
        ? scoreIncome(
            total,
            !anyUnverified
          )
        : null,

    criticita,
  };
}


module.exports = {
  calculateApplicantIncome,
  calculatePracticeIncome,
};
