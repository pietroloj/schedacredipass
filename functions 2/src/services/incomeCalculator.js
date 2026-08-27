const {
  normalizeNumber,
  round2,
} = require("../utils/numbers");


function n(value) {
  const result =
    normalizeNumber(value);

  return Number.isFinite(result)
    ? result
    : null;
}


function zero(value) {
  const result =
    n(value);

  return result === null
    ? 0
    : result;
}


function sumCommunalCU(
  estratti = {}
) {
  return (
    zero(
      estratti
        .addizionale_comunale_acconto_anno
    ) +
    zero(
      estratti
        .addizionale_comunale_saldo_anno
    ) +
    zero(
      estratti
        .addizionale_comunale_acconto_anno_successivo
    )
  );
}


/*
|--------------------------------------------------------------------------
| CU STANDARD / CU CON GIORNI 200-364
|--------------------------------------------------------------------------
|
| Regola ufficiale fornita:
|
| STANDARD:
| (imponibile - IRPEF - add. regionale - add. comunale) / 12
|
| SE GIORNI >= 200 E < 365:
| [(netto annuo / giorni) * 365] / 12
|
| Per giorni < 200 la tabella non autorizza il riproporzionamento.
| Restituiamo quindi review manuale.
|
*/

function calculateIncomeFromCU(
  estratti = {}
) {
  const imponibile =
    n(
      estratti
        .reddito_lordo_annuo
    );

  const irpef =
    n(
      estratti
        .irpef
    );

  const regionale =
    n(
      estratti
        .addizionale_regionale
    );

  const comunale =
    sumCommunalCU(
      estratti
    );

  const giorni =
    n(
      estratti
        .giorni_lavorati
    );

  const missing = [];

  if (
    imponibile === null ||
    imponibile <= 0
  ) {
    missing.push(
      "reddito_lordo_annuo"
    );
  }

  if (irpef === null) {
    missing.push(
      "irpef"
    );
  }

  if (
    regionale === null
  ) {
    missing.push(
      "addizionale_regionale"
    );
  }

  if (missing.length) {
    return {
      ok: false,
      metodo: "CU",
      fonte:
        "Certificazione Unica",
      campiMancanti:
        missing,
      redditoNettoMensile:
        null,
    };
  }

  const nettoPeriodo =
    imponibile -
    irpef -
    regionale -
    comunale;

  if (
    !Number.isFinite(
      nettoPeriodo
    ) ||
    nettoPeriodo <= 0
  ) {
    return {
      ok: false,
      metodo: "CU",
      errore:
        "Reddito netto CU non valido dopo le trattenute.",
      redditoNettoMensile:
        null,
    };
  }

  /*
   * Se i giorni sono indicati e sono inferiori a 200,
   * la regola fornita non prevede un calcolo automatico.
   */
  if (
    giorni !== null &&
    giorni > 0 &&
    giorni < 200
  ) {
    return {
      ok: false,
      metodo:
        "CU_GIORNI_INFERIORI_200",
      fonte:
        "Certificazione Unica",
      campiMancanti: [],
      errore:
        "CU con meno di 200 giorni: la tabella fornita non prevede il riproporzionamento automatico.",
      redditoImponibile:
        round2(
          imponibile
        ),
      redditoNettoPeriodo:
        round2(
          nettoPeriodo
        ),
      giorniLavorati:
        giorni,
      redditoNettoMensile:
        null,
    };
  }

  /*
   * CU con giorni >= 200 e < 365:
   * riproporzionamento a 365 giorni.
   */
  if (
    giorni !== null &&
    giorni >= 200 &&
    giorni < 365
  ) {
    const annualizzato =
      (
        nettoPeriodo /
        giorni
      ) *
      365;

    return {
      ok: true,
      metodo:
        "CU_RIPROPORZIONATA_200_364",
      fonte:
        "Certificazione Unica",
      formula:
        "[(imponibile - IRPEF - add. regionale - add. comunale) / giorni] × 365 / 12",

      redditoImponibile:
        round2(
          imponibile
        ),

      trattenute: {
        irpef:
          round2(irpef),
        addizionaleRegionale:
          round2(
            regionale
          ),
        addizionaleComunale:
          round2(
            comunale
          ),
      },

      redditoNettoPeriodo:
        round2(
          nettoPeriodo
        ),

      giorniLavorati:
        giorni,

      redditoNettoAnnuo:
        round2(
          annualizzato
        ),

      redditoNettoMensile:
        round2(
          annualizzato /
          12
        ),
    };
  }

  /*
   * CU standard:
   * il risultato viene diviso per 12.
   * Se i giorni non sono disponibili, applichiamo comunque
   * la formula standard e segnaliamo l'assenza come nota.
   */
  return {
    ok: true,
    metodo:
      "CU_STANDARD",
    fonte:
      "Certificazione Unica",
    formula:
      "(imponibile - IRPEF - add. regionale - add. comunale) / 12",

    redditoImponibile:
      round2(
        imponibile
      ),

    trattenute: {
      irpef:
        round2(irpef),
      addizionaleRegionale:
        round2(
          regionale
        ),
      addizionaleComunale:
        round2(
          comunale
        ),
    },

    redditoNettoAnnuo:
      round2(
        nettoPeriodo
      ),

    giorniLavorati:
      giorni,

    redditoNettoMensile:
      round2(
        nettoPeriodo /
        12
      ),

    note:
      giorni === null
        ? [
            "Giorni CU non disponibili: applicata formula CU standard /12."
          ]
        : [],
  };
}


/*
|--------------------------------------------------------------------------
| MODELLO UNICO ORDINARIO - SINGOLO ANNO
|--------------------------------------------------------------------------
|
| RN1 - RN3 - RN26 - RV2 - RV10
|
*/

function calculateUnicoOrdinaryAnnual(
  estratti = {}
) {
  const rn1 =
    n(estratti.rn1);

  const rn3 =
    n(estratti.rn3);

  const rn26 =
    n(estratti.rn26);

  const rv2 =
    n(estratti.rv2);

  const rv10 =
    n(estratti.rv10);

  const missing = [];

  if (rn1 === null) {
    missing.push("RN1");
  }

  if (rn3 === null) {
    missing.push("RN3");
  }

  if (rn26 === null) {
    missing.push("RN26");
  }

  if (rv2 === null) {
    missing.push("RV2");
  }

  if (rv10 === null) {
    missing.push("RV10");
  }

  if (missing.length) {
    return {
      ok: false,
      metodo:
        "UNICO_ORDINARIO",
      campiMancanti:
        missing,
      redditoNettoAnnuo:
        null,
    };
  }

  const netto =
    rn1 -
    rn3 -
    rn26 -
    rv2 -
    rv10;

  if (
    !Number.isFinite(
      netto
    ) ||
    netto <= 0
  ) {
    return {
      ok: false,
      metodo:
        "UNICO_ORDINARIO",
      errore:
        "Reddito netto annuo Modello Redditi non valido.",
      redditoNettoAnnuo:
        null,
    };
  }

  return {
    ok: true,
    metodo:
      "UNICO_ORDINARIO",
    formula:
      "RN1 - RN3 - RN26 - RV2 - RV10",
    annoFiscale:
      String(
        estratti
          .anno_fiscale ||
        ""
      ),
    valori: {
      rn1: round2(rn1),
      rn3: round2(rn3),
      rn26:
        round2(rn26),
      rv2: round2(rv2),
      rv10:
        round2(rv10),
    },
    redditoNettoAnnuo:
      round2(netto),
    redditoNettoMensileSingoloAnno:
      round2(
        netto / 12
      ),
  };
}


/*
|--------------------------------------------------------------------------
| MEDIA ULTIMI DUE MODELLI UNICI ORDINARI
|--------------------------------------------------------------------------
|
| (netto precedente + netto ultimo) / 2 / 12
| equivalente a somma / 24.
|
*/

function calculateUnicoOrdinaryTwoYears(
  annualResults = []
) {
  const valid =
    annualResults
      .filter(
        (x) =>
          x &&
          x.ok &&
          Number.isFinite(
            n(
              x
                .redditoNettoAnnuo
            )
          )
      )
      .sort(
        (a, b) =>
          Number(
            b.annoFiscale ||
            0
          ) -
          Number(
            a.annoFiscale ||
            0
          )
      );

  if (valid.length < 2) {
    return {
      ok: false,
      metodo:
        "UNICO_ORDINARIO_MEDIA_2_ANNI",
      campiMancanti: [
        "secondo_modello_unico",
      ],
      redditoNettoMensile:
        null,
    };
  }

  const latest =
    valid[0];

  const previous =
    valid[1];

  /*
   * Regola singolo Modello Unico:
   * se il precedente è un anno di attività incompleto,
   * utilizzare il solo ultimo modello /12.
   */
  if (
    previous
      .annoAttivitaIncompleto ===
    true
  ) {
    return {
      ok: true,
      metodo:
        "SINGOLO_MODELLO_UNICO_ANNO_PRECEDENTE_INCOMPLETO",
      formula:
        "(RN1 - RN3 - RN26 - RV2 - RV10) / 12",
      anniUsati: [
        latest.annoFiscale
      ],
      redditoNettoAnnuo:
        latest
          .redditoNettoAnnuo,
      redditoNettoMensile:
        round2(
          latest
            .redditoNettoAnnuo /
          12
        ),
    };
  }

  const total =
    latest
      .redditoNettoAnnuo +
    previous
      .redditoNettoAnnuo;

  return {
    ok: true,
    metodo:
      "UNICO_ORDINARIO_MEDIA_2_ANNI",
    formula:
      "[(RN1-RN3-RN26-RV2-RV10)p + (RN1-RN3-RN26-RV2-RV10)a] / 2 / 12",
    anniUsati: [
      previous.annoFiscale,
      latest.annoFiscale,
    ],
    redditoNettoBiennale:
      round2(total),
    redditoNettoMensile:
      round2(
        total /
        24
      ),
  };
}


/*
|--------------------------------------------------------------------------
| SINGOLO MODELLO UNICO
|--------------------------------------------------------------------------
|
| Applicabile SOLO quando viene attestata una delle condizioni
| previste dalla tabella.
|
*/

function calculateSingleUnico(
  annualResult,
  explicitlyAllowed = false
) {
  if (
    !annualResult?.ok
  ) {
    return {
      ok: false,
      metodo:
        "SINGOLO_MODELLO_UNICO",
      redditoNettoMensile:
        null,
    };
  }

  if (!explicitlyAllowed) {
    return {
      ok: false,
      metodo:
        "SINGOLO_MODELLO_UNICO",
      errore:
        "Uso del singolo Modello Unico non autorizzato dalle evidenze disponibili.",
      redditoNettoMensile:
        null,
    };
  }

  return {
    ok: true,
    metodo:
      "SINGOLO_MODELLO_UNICO",
    formula:
      "(RN1 - RN3 - RN26 - RV2 - RV10) / 12",
    anniUsati: [
      annualResult
        .annoFiscale
    ],
    redditoNettoAnnuo:
      annualResult
        .redditoNettoAnnuo,
    redditoNettoMensile:
      round2(
        annualResult
          .redditoNettoAnnuo /
        12
      ),
  };
}


/*
|--------------------------------------------------------------------------
| FORFETTARIO
|--------------------------------------------------------------------------
|
| [(LM36p + LM36a) × 85%] / 2 / 12
|
*/

function calculateForfettarioTwoYears(
  docs = []
) {
  const valid =
    docs
      .map(
        (e) => ({
          annoFiscale:
            String(
              e.anno_fiscale ||
              ""
            ),
          lm36:
            n(e.lm36),
        })
      )
      .filter(
        (x) =>
          x.lm36 !== null &&
          x.lm36 > 0
      )
      .sort(
        (a, b) =>
          Number(
            b.annoFiscale ||
            0
          ) -
          Number(
            a.annoFiscale ||
            0
          )
      );

  if (valid.length < 2) {
    return {
      ok: false,
      metodo:
        "FORFETTARIO_LM36_MEDIA_2_ANNI",
      campiMancanti: [
        "LM36_secondo_modello",
      ],
      redditoNettoMensile:
        null,
    };
  }

  const latest =
    valid[0];

  const previous =
    valid[1];

  const total =
    (
      latest.lm36 +
      previous.lm36
    ) *
    0.85;

  return {
    ok: true,
    metodo:
      "FORFETTARIO_LM36_MEDIA_2_ANNI",
    formula:
      "[(LM36p + LM36a) × 85%] / 2 / 12",
    anniUsati: [
      previous.annoFiscale,
      latest.annoFiscale,
    ],
    redditoNettoBiennaleDopoDecurtazione:
      round2(total),
    redditoNettoMensile:
      round2(
        total /
        24
      ),
  };
}


/*
|--------------------------------------------------------------------------
| CPB FORFETTARIO
|--------------------------------------------------------------------------
|
| [((LM34p-LM35p)+(LM34a-LM35a)) × 85%] / 2 / 12
|
*/

function calculateForfettarioCPBTwoYears(
  docs = []
) {
  const annual =
    docs
      .map(
        (e) => {
          const lm34 =
            n(e.lm34);

          const lm35 =
            n(e.lm35);

          if (
            lm34 === null ||
            lm35 === null
          ) {
            return null;
          }

          return {
            annoFiscale:
              String(
                e.anno_fiscale ||
                ""
              ),
            nettoBase:
              lm34 -
              lm35,
          };
        }
      )
      .filter(
        (x) =>
          x &&
          Number.isFinite(
            x.nettoBase
          ) &&
          x.nettoBase > 0
      )
      .sort(
        (a, b) =>
          Number(
            b.annoFiscale ||
            0
          ) -
          Number(
            a.annoFiscale ||
            0
          )
      );

  if (annual.length < 2) {
    return {
      ok: false,
      metodo:
        "CPB_FORFETTARIO",
      campiMancanti: [
        "LM34_LM35_secondo_modello",
      ],
      redditoNettoMensile:
        null,
    };
  }

  const latest =
    annual[0];

  const previous =
    annual[1];

  const total =
    (
      latest.nettoBase +
      previous.nettoBase
    ) *
    0.85;

  return {
    ok: true,
    metodo:
      "CPB_FORFETTARIO",
    formula:
      "[((LM34p-LM35p)+(LM34a-LM35a)) × 85%] / 2 / 12",
    anniUsati: [
      previous.annoFiscale,
      latest.annoFiscale,
    ],
    redditoNettoMensile:
      round2(
        total /
        24
      ),
  };
}


/*
|--------------------------------------------------------------------------
| CPB ORDINARIO - SINGO ANNO
|--------------------------------------------------------------------------
|
| Seguiamo la descrizione completa della tabella:
| CP10 - oneri deducibili - imposta netta
|      - addizionale regionale - addizionale comunale
|
*/

function calculateOrdinaryCPBAnnual(
  estratti = {}
) {
  const cp10 =
    n(estratti.cp10);

  const oneri =
    n(
      estratti
        .cp_oneri_deducibili
    );

  const imposta =
    n(
      estratti
        .cp_imposta_netta
    );

  const regionale =
    n(
      estratti
        .cp_addizionale_regionale
    );

  const comunale =
    n(
      estratti
        .cp_addizionale_comunale
    );

  const missing = [];

  if (cp10 === null) {
    missing.push("CP10");
  }

  if (oneri === null) {
    missing.push(
      "oneri_deducibili_CPB"
    );
  }

  if (imposta === null) {
    missing.push(
      "imposta_netta_CPB"
    );
  }

  if (regionale === null) {
    missing.push(
      "addizionale_regionale_CPB"
    );
  }

  if (comunale === null) {
    missing.push(
      "addizionale_comunale_CPB"
    );
  }

  if (missing.length) {
    return {
      ok: false,
      metodo:
        "CPB_ORDINARIO",
      campiMancanti:
        missing,
      redditoNettoAnnuo:
        null,
    };
  }

  const netto =
    cp10 -
    oneri -
    imposta -
    regionale -
    comunale;

  if (
    !Number.isFinite(
      netto
    ) ||
    netto <= 0
  ) {
    return {
      ok: false,
      metodo:
        "CPB_ORDINARIO",
      errore:
        "Reddito netto CPB ordinario non valido.",
      redditoNettoAnnuo:
        null,
    };
  }

  return {
    ok: true,
    metodo:
      "CPB_ORDINARIO",
    formula:
      "CP10 - oneri deducibili - imposta netta - add. regionale - add. comunale",
    annoFiscale:
      String(
        estratti
          .anno_fiscale ||
        ""
      ),
    redditoNettoAnnuo:
      round2(netto),
  };
}


function calculateOrdinaryCPBTwoYears(
  annualResults = []
) {
  const valid =
    annualResults
      .filter(
        (x) =>
          x &&
          x.ok &&
          Number.isFinite(
            n(
              x
                .redditoNettoAnnuo
            )
          )
      )
      .sort(
        (a, b) =>
          Number(
            b.annoFiscale ||
            0
          ) -
          Number(
            a.annoFiscale ||
            0
          )
      );

  if (valid.length < 2) {
    return {
      ok: false,
      metodo:
        "CPB_ORDINARIO_MEDIA_2_ANNI",
      campiMancanti: [
        "secondo_modello_CPB",
      ],
      redditoNettoMensile:
        null,
    };
  }

  const total =
    valid[0]
      .redditoNettoAnnuo +
    valid[1]
      .redditoNettoAnnuo;

  return {
    ok: true,
    metodo:
      "CPB_ORDINARIO_MEDIA_2_ANNI",
    formula:
      "(netto CP10 precedente + netto CP10 ultimo) / 2 / 12",
    anniUsati: [
      valid[1]
        .annoFiscale,
      valid[0]
        .annoFiscale,
    ],
    redditoNettoMensile:
      round2(
        total /
        24
      ),
  };
}


/*
|--------------------------------------------------------------------------
| BUSTA PAGA
|--------------------------------------------------------------------------
|
| Regola:
| (lordo mensile × n mensilità)
| - contributi previdenziali medi 9,19%
| - IRPEF ordinaria
| - add. regionale
| - add. comunale
| /12
|
| La tabella non fornisce gli scaglioni IRPEF.
| Per evitare formule inventate, il backend richiede
| irpef_annua_calcolata_bp già disponibile da fonte/configurazione esterna.
|
*/

function calculateIncomeFromBP(
  estratti = {}
) {
  const lordoMensile =
    n(
      estratti
        .stipendio_lordo_mensile_ordinario
    );

  const mensilita =
    n(
      estratti
        .numero_mensilita
    );

  const irpefAnnua =
    n(
      estratti
        .irpef_annua_calcolata_bp
    );

  const regionaleAnnua =
    n(
      estratti
        .addizionale_regionale_annua_bp
    );

  const comunaleAnnua =
    n(
      estratti
        .addizionale_comunale_annua_bp
    );

  const contributiPercentuale =
    n(
      estratti
        .contributi_previdenziali_percentuale_bp
    );

  const contributionRate =
    contributiPercentuale === null
      ? 9.19
      : contributiPercentuale;

  const missing = [];

  if (
    lordoMensile === null ||
    lordoMensile <= 0
  ) {
    missing.push(
      "stipendio_lordo_mensile_ordinario"
    );
  }

  if (
    mensilita === null ||
    mensilita <= 0
  ) {
    missing.push(
      "numero_mensilita"
    );
  }

  if (irpefAnnua === null) {
    missing.push(
      "irpef_annua_calcolata_bp"
    );
  }

  if (
    regionaleAnnua === null
  ) {
    missing.push(
      "addizionale_regionale_annua_bp"
    );
  }

  if (
    comunaleAnnua === null
  ) {
    missing.push(
      "addizionale_comunale_annua_bp"
    );
  }

  if (missing.length) {
    return {
      ok: false,
      metodo:
        "BUSTA_PAGA",
      campiMancanti:
        missing,
      errore:
        "Per il calcolo BP servono IRPEF e addizionali annuali; la tabella fornita non contiene gli scaglioni per calcolarli autonomamente.",
      redditoNettoMensile:
        null,
    };
  }

  const lordoAnnuo =
    lordoMensile *
    mensilita;

  const contributi =
    lordoAnnuo *
    (
      contributionRate /
      100
    );

  const nettoAnnuo =
    lordoAnnuo -
    contributi -
    irpefAnnua -
    regionaleAnnua -
    comunaleAnnua;

  if (
    !Number.isFinite(
      nettoAnnuo
    ) ||
    nettoAnnuo <= 0
  ) {
    return {
      ok: false,
      metodo:
        "BUSTA_PAGA",
      errore:
        "Reddito netto BP non valido.",
      redditoNettoMensile:
        null,
    };
  }

  return {
    ok: true,
    metodo:
      "BUSTA_PAGA",
    formula:
      "(lordo mensile × n mensilità - contributi 9,19% - IRPEF - addizionali) / 12",
    lordoAnnuo:
      round2(
        lordoAnnuo
      ),
    contributi:
      round2(
        contributi
      ),
    contributiPercentuale:
      contributionRate,
    redditoNettoAnnuo:
      round2(
        nettoAnnuo
      ),
    redditoNettoMensile:
      round2(
        nettoAnnuo /
        12
      ),
  };
}


/*
|--------------------------------------------------------------------------
| REDDITO DA TRASFERTA
|--------------------------------------------------------------------------
|
| reddito BP + 70% media trasferte.
|
*/

function calculateIncomeWithTrasferta(
  bpResult,
  estratti = {}
) {
  if (!bpResult?.ok) {
    return {
      ok: false,
      metodo:
        "BP_TRASFERTA",
      errore:
        "Calcolo BP base non disponibile.",
      redditoNettoMensile:
        null,
    };
  }

  const totalTrasferte =
    n(
      estratti
        .importo_trasferte_periodo
    );

  const numeroBP =
    n(
      estratti
        .numero_buste_paga_trasferte
    );

  if (
    totalTrasferte === null ||
    numeroBP === null ||
    numeroBP <= 0
  ) {
    return {
      ok: false,
      metodo:
        "BP_TRASFERTA",
      campiMancanti: [
        "trasferte_periodo_o_numero_BP",
      ],
      redditoNettoMensile:
        null,
    };
  }

  const mediaTrasferte =
    totalTrasferte /
    numeroBP;

  const considerabile =
    mediaTrasferte *
    0.70;

  return {
    ok: true,
    metodo:
      "BP_TRASFERTA",
    formula:
      "reddito netto BP + (media trasferte × 70%)",
    redditoNettoBP:
      bpResult
        .redditoNettoMensile,
    mediaTrasferte:
      round2(
        mediaTrasferte
      ),
    trasfertaConsiderabile:
      round2(
        considerabile
      ),
    redditoNettoMensile:
      round2(
        bpResult
          .redditoNettoMensile +
        considerabile
      ),
  };
}


/*
|--------------------------------------------------------------------------
| QUADRI E DIRIGENTI
|--------------------------------------------------------------------------
|
| Se CU > BP:
| BP + 70% × (CU - BP)
|
| Se CU <= BP:
| CU
|
*/

function calculateQuadroDirigente(
  cuResult,
  bpResult
) {
  if (
    !cuResult?.ok ||
    !bpResult?.ok
  ) {
    return {
      ok: false,
      metodo:
        "QUADRO_DIRIGENTE",
      errore:
        "Servono sia calcolo CU sia calcolo BP.",
      redditoNettoMensile:
        null,
    };
  }

  const cu =
    cuResult
      .redditoNettoMensile;

  const bp =
    bpResult
      .redditoNettoMensile;

  if (cu > bp) {
    const result =
      bp +
      (
        0.70 *
        (
          cu -
          bp
        )
      );

    return {
      ok: true,
      metodo:
        "QUADRO_DIRIGENTE_CU_SUPERIORE_BP",
      formula:
        "BP + [70% × (CU - BP)]",
      redditoNettoCU:
        cu,
      redditoNettoBP:
        bp,
      redditoNettoMensile:
        round2(
          result
        ),
    };
  }

  return {
    ok: true,
    metodo:
      "QUADRO_DIRIGENTE_CU_MINORE_UGUALE_BP",
    formula:
      "Se CU ≤ BP si considera CU",
    redditoNettoCU:
      cu,
    redditoNettoBP:
      bp,
    redditoNettoMensile:
      round2(cu),
  };
}


function isCU(
  estratti = {}
) {
  const tipo =
    String(
      estratti
        .tipo_reddito ||
      ""
    ).toLowerCase();

  return Boolean(
    estratti
      .reddito_lordo_annuo ||
    tipo.includes(
      "dipendente"
    ) ||
    tipo.includes(
      "pensione"
    )
  );
}


function isForfettario(
  estratti = {}
) {
  return (
    String(
      estratti
        .regime_fiscale ||
      ""
    )
      .toLowerCase()
      .includes(
        "forfett"
      ) ||
    String(
      estratti
        .tipo_reddito ||
      ""
    )
      .toLowerCase()
      .includes(
        "forfett"
      )
  );
}


function isCPB(
  estratti = {}
) {
  return Boolean(
    estratti
      .concordato_preventivo_biennale
  );
}


function calculateIncomeFromSingleDocument(
  estratti = {}
) {
  if (isCU(estratti)) {
    return calculateIncomeFromCU(
      estratti
    );
  }

  if (
    isForfettario(
      estratti
    ) &&
    isCPB(
      estratti
    )
  ) {
    const lm34 =
      n(estratti.lm34);

    const lm35 =
      n(estratti.lm35);

    if (
      lm34 !== null &&
      lm35 !== null
    ) {
      return {
        ok: true,
        metodo:
          "CPB_FORFETTARIO_ANNUALE_BASE",
        annoFiscale:
          String(
            estratti
              .anno_fiscale ||
            ""
          ),
        redditoNettoAnnuoBase:
          round2(
            lm34 -
            lm35
          ),
        richiedeDueModelli:
          true,
        redditoNettoMensile:
          null,
      };
    }
  }

  if (
    isForfettario(
      estratti
    )
  ) {
    const lm36 =
      n(estratti.lm36);

    if (
      lm36 !== null &&
      lm36 > 0
    ) {
      return {
        ok: true,
        metodo:
          "FORFETTARIO_LM36_ANNUALE_BASE",
        annoFiscale:
          String(
            estratti
              .anno_fiscale ||
            ""
          ),
        redditoNettoAnnuoBase:
          round2(lm36),
        richiedeDueModelli:
          true,
        redditoNettoMensile:
          null,
      };
    }
  }

  if (
    isCPB(estratti)
  ) {
    const cpb =
      calculateOrdinaryCPBAnnual(
        estratti
      );

    return {
      ...cpb,
      richiedeDueModelli:
        cpb.ok,
      redditoNettoMensile:
        null,
    };
  }

  if (
    estratti.rn1 ||
    estratti.rn26
  ) {
    const unico =
      calculateUnicoOrdinaryAnnual(
        estratti
      );

    return {
      ...unico,
      annoAttivitaIncompleto:
        Boolean(
          estratti
            .anno_attivita_incompleto
        ),
      singoloAmmissibile:
        Boolean(
          estratti
            .modello_unico_singolo_ammissibile
        ),
      richiedeDueModelli:
        unico.ok,
      redditoNettoMensile:
        null,
    };
  }

  if (
    estratti
      .stipendio_lordo_mensile_ordinario
  ) {
    return calculateIncomeFromBP(
      estratti
    );
  }

  return {
    ok: false,
    metodo:
      "NON_RICONOSCIUTO",
    errore:
      "Tipologia reddituale non riconosciuta.",
    redditoNettoMensile:
      null,
  };
}


module.exports = {
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
  calculateIncomeFromSingleDocument,
  isCU,
  isForfettario,
  isCPB,
};
