const {
  normalizeNumber,
  round2,
} = require("../utils/numbers");


function n(value) {
  const parsed = normalizeNumber(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}


function upper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}


function isYes(value) {
  return [
    "SI",
    "SÌ",
    "YES",
    "TRUE",
    "1",
  ].includes(
    upper(value)
  );
}


function isPassiveMaintenance(
  practiceData,
  applicant
) {
  const suffix =
    applicant === "r2"
      ? "r2"
      : "r1";

  const numero =
    applicant === "r2"
      ? "2"
      : "1";

  const presenza =
    practiceData[
      `mantenimento_presenza_${suffix}`
    ]
    ??
    practiceData[
      `mantenimento${numero}_presenza`
    ];

  if (
    presenza !== undefined
    &&
    presenza !== null
    &&
    presenza !== ""
    &&
    !isYes(presenza)
  ) {
    return false;
  }

  const tipo =
    upper(
      practiceData[
        `mantenimento_tipo_${suffix}`
      ]
      ??
      practiceData[
        `mantenimento_${suffix}`
      ]
      ??
      practiceData[
        `mantenimento${numero}`
      ]
    );

  return tipo === "PASSIVO";
}


function maintenanceAmount(
  practiceData,
  applicant
) {
  const suffix =
    applicant === "r2"
      ? "r2"
      : "r1";

  const numero =
    applicant === "r2"
      ? "2"
      : "1";

  return n(
    practiceData[
      `mantenimento_importo_${suffix}`
    ]
    ??
    practiceData[
      `mantenimento${numero}_importo`
    ]
  );
}


function calculateFinancialCommitments(
  practiceData = {},
  {
    fallbackOtherRates = null,
  } = {}
) {
  const finanziamenti =
    Array.isArray(
      practiceData
        .finanziamenti_dettaglio
    )
      ? practiceData
          .finanziamenti_dettaglio
      : [];

  const finanziamentiDettaglio =
    finanziamenti.map(
      (item, index) => {
        const rata =
          n(
            item?.rata
          );

        const gestione =
          upper(
            item?.gestione ||
            "MANTENERE"
          );

        return {
          index:
            index + 1,

          istituto:
            String(
              item?.istituto ||
              ""
            ).trim(),

          finalita:
            String(
              item?.finalita ||
              ""
            ).trim(),

          rata,

          gestione:
            gestione ===
              "ESTINGUERE"
              ? "ESTINGUERE"
              : "MANTENERE",
        };
      }
    )
    .filter(
      item =>
        item.rata > 0
        ||
        item.istituto
    );

  const rateFinanziamentiPre =
    finanziamentiDettaglio.reduce(
      (sum, item) =>
        sum + item.rata,
      0
    );

  const rateFinanziamentiPost =
    finanziamentiDettaglio.reduce(
      (sum, item) =>
        sum +
        (
          item.gestione ===
            "MANTENERE"
            ? item.rata
            : 0
        ),
      0
    );

  const rateFinanziamentiDaEstinguere =
    Math.max(
      0,
      rateFinanziamentiPre -
      rateFinanziamentiPost
    );

  const rataMutuoPre =
    n(
      practiceData
        .rata_mutuo_pre
      ??
      practiceData
        .mutuo_pre_rata
    );

  const mutuoPreGestione =
    upper(
      practiceData
        .mutuo_pre_gestione ||
      "MANTENERE"
    );

  const mutuoPrePost =
    mutuoPreGestione ===
      "ESTINGUERE"
      ? 0
      : rataMutuoPre;

  /*
   * Compatibilità con le pratiche storiche:
   * se non esiste finanziamenti_dettaglio, usiamo il vecchio totale.
   */
  const fallback =
    finanziamentiDettaglio.length === 0
      ? n(
          fallbackOtherRates
          ??
          practiceData
            .totale_rate_finanziamenti
          ??
          practiceData
            .rata_fin_pre
        )
      : 0;

  const mantenimentoPassivoR1 =
    isPassiveMaintenance(
      practiceData,
      "r1"
    )
      ? maintenanceAmount(
          practiceData,
          "r1"
        )
      : 0;

  const mantenimentoPassivoR2 =
    isPassiveMaintenance(
      practiceData,
      "r2"
    )
      ? maintenanceAmount(
          practiceData,
          "r2"
        )
      : 0;

  const mantenimentiPassivi =
    mantenimentoPassivoR1
    +
    mantenimentoPassivoR2;

  /*
   * Il canone di affitto viene trattato come impegno non finanziario
   * solo quando è valorizzato. Non viene sommato al DTI finanziario:
   * incide sul reddito residuo.
   */
  const canoneAffitto =
    n(
      practiceData
        .canone_affitto
      ??
      practiceData
        .affitto_canone
    );

  const altriImpegniNonFinanziari =
    n(
      practiceData
        .altri_impegni_non_finanziari
    );

  const impegniNonFinanziari =
    mantenimentiPassivi
    +
    canoneAffitto
    +
    altriImpegniNonFinanziari;

  const impegniFinanziariPre =
    rateFinanziamentiPre
    +
    fallback
    +
    rataMutuoPre;

  const impegniFinanziariPost =
    rateFinanziamentiPost
    +
    fallback
    +
    mutuoPrePost;

  return {
    finanziamentiDettaglio,

    rateFinanziamentiPre:
      round2(
        rateFinanziamentiPre
        +
        fallback
      ),

    rateFinanziamentiPost:
      round2(
        rateFinanziamentiPost
        +
        fallback
      ),

    rateFinanziamentiDaEstinguere:
      round2(
        rateFinanziamentiDaEstinguere
      ),

    rataMutuoPre:
      round2(
        rataMutuoPre
      ),

    mutuoPreGestione:
      mutuoPreGestione ===
        "ESTINGUERE"
        ? "ESTINGUERE"
        : "MANTENERE",

    rataMutuoPrePost:
      round2(
        mutuoPrePost
      ),

    impegniFinanziariPre:
      round2(
        impegniFinanziariPre
      ),

    impegniFinanziariPost:
      round2(
        impegniFinanziariPost
      ),

    mantenimentoPassivoR1:
      round2(
        mantenimentoPassivoR1
      ),

    mantenimentoPassivoR2:
      round2(
        mantenimentoPassivoR2
      ),

    mantenimentiPassivi:
      round2(
        mantenimentiPassivi
      ),

    canoneAffitto:
      round2(
        canoneAffitto
      ),

    altriImpegniNonFinanziari:
      round2(
        altriImpegniNonFinanziari
      ),

    impegniNonFinanziari:
      round2(
        impegniNonFinanziari
      ),
  };
}


function calculatePracticeRatios({
  redditoMensile,
  rataNuovoMutuo,
  impegni,
}) {
  const reddito =
    n(
      redditoMensile
    );

  const nuovaRata =
    n(
      rataNuovoMutuo
    );

  if (
    reddito <= 0
  ) {
    return {
      dtiPre:
        null,

      dtiPost:
        null,

      redditoResiduoPre:
        null,

      redditoResiduoPost:
        null,

      disponibilitaPostNuovaRata:
        null,
    };
  }

  const pre =
    n(
      impegni
        ?.impegniFinanziariPre
    );

  const post =
    n(
      impegni
        ?.impegniFinanziariPost
    );

  const nonFin =
    n(
      impegni
        ?.impegniNonFinanziari
    );

  return {
    dtiPre:
      round2(
        (
          pre /
          reddito
        )
        *
        100
      ),

    dtiPost:
      nuovaRata > 0
        ? round2(
            (
              (
                nuovaRata
                +
                post
              )
              /
              reddito
            )
            *
            100
          )
        : null,

    redditoResiduoPre:
      round2(
        reddito
        -
        pre
        -
        nonFin
      ),

    redditoResiduoPost:
      nuovaRata > 0
        ? round2(
            reddito
            -
            nuovaRata
            -
            post
            -
            nonFin
          )
        : null,

    disponibilitaPostNuovaRata:
      nuovaRata > 0
        ? round2(
            reddito
            -
            nuovaRata
            -
            post
            -
            nonFin
          )
        : null,
  };
}


module.exports = {
  calculateFinancialCommitments,
  calculatePracticeRatios,
};
