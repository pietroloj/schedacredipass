const { normalizeNumber, round2 } = require("../utils/numbers");

function valueOrZero(value) {
  const n = normalizeNumber(value);
  return Number.isFinite(n) ? n : 0;
}

/*
 * Regola concordata:
 * 365 giorni => 12 mesi
 * 120 giorni => 4 mesi
 * 180 giorni => circa 6 mesi
 *
 * Usiamo 365/12 come durata media di un mese e arrotondiamo.
 */
function mesiDaGiorni(giorni) {
  const g = normalizeNumber(giorni);

  if (!Number.isFinite(g) || g <= 0 || g > 366) {
    return null;
  }

  let mesi = Math.round(g / (365 / 12));

  if (mesi < 1) mesi = 1;
  if (mesi > 12) mesi = 12;

  return mesi;
}

function calculateIncomeFromCU(estratti = {}) {
  const lordo = normalizeNumber(estratti.reddito_lordo_annuo);
  const irpef = normalizeNumber(estratti.irpef);
  const regionale = normalizeNumber(estratti.addizionale_regionale);
  const giorni = normalizeNumber(estratti.giorni_lavorati);

  const accontoComunaleAnno =
    valueOrZero(estratti.addizionale_comunale_acconto_anno);

  const saldoComunaleAnno =
    valueOrZero(estratti.addizionale_comunale_saldo_anno);

  const accontoComunaleAnnoSuccessivo =
    valueOrZero(estratti.addizionale_comunale_acconto_anno_successivo);

  const missing = [];

  if (!Number.isFinite(lordo) || lordo <= 0) {
    missing.push("reddito_lordo_annuo");
  }

  if (!Number.isFinite(irpef)) {
    missing.push("irpef");
  }

  if (!Number.isFinite(regionale)) {
    missing.push("addizionale_regionale");
  }

  const mesi = mesiDaGiorni(giorni);

  if (!mesi) {
    missing.push("giorni_lavorati");
  }

  if (missing.length) {
    return {
      ok: false,
      fonte: "CU",
      campiMancanti: missing,
      redditoLordoAnnuo: Number.isFinite(lordo) ? lordo : null,
      redditoNettoAnnuo: null,
      redditoNettoMensile: null,
      giorniLavorati: Number.isFinite(giorni) ? giorni : null,
      mensilitaConsiderate: mesi,
    };
  }

  const totaleTrattenute =
    irpef +
    regionale +
    accontoComunaleAnno +
    saldoComunaleAnno +
    accontoComunaleAnnoSuccessivo;

  const nettoAnnuo = lordo - totaleTrattenute;

  if (!Number.isFinite(nettoAnnuo) || nettoAnnuo <= 0) {
    return {
      ok: false,
      fonte: "CU",
      campiMancanti: [],
      errore: "Netto annuo CU non valido dopo la sottrazione delle trattenute.",
      redditoLordoAnnuo: round2(lordo),
      redditoNettoAnnuo: null,
      redditoNettoMensile: null,
      giorniLavorati: giorni,
      mensilitaConsiderate: mesi,
    };
  }

  return {
    ok: true,
    fonte: "CU",
    formula:
      "reddito fiscale CU - IRPEF - addizionale regionale - addizionale comunale punti 26, 27 e 29",
    redditoLordoAnnuo: round2(lordo),

    trattenute: {
      irpef: round2(irpef),
      addizionaleRegionale: round2(regionale),
      addizionaleComunaleAccontoAnno: round2(accontoComunaleAnno),
      addizionaleComunaleSaldoAnno: round2(saldoComunaleAnno),
      addizionaleComunaleAccontoAnnoSuccessivo:
        round2(accontoComunaleAnnoSuccessivo),
      totale: round2(totaleTrattenute),
    },

    redditoNettoAnnuo: round2(nettoAnnuo),
    giorniLavorati: giorni,
    mensilitaConsiderate: mesi,
    redditoNettoMensile: round2(nettoAnnuo / mesi),
  };
}

function looksLikeCU(estratti = {}) {
  const tipo = String(estratti.tipo_reddito || "").toLowerCase();

  return Boolean(
    estratti.reddito_lordo_annuo ||
    estratti.giorni_lavorati ||
    tipo.includes("dipendente") ||
    tipo.includes("pensione")
  );
}

module.exports = {
  mesiDaGiorni,
  calculateIncomeFromCU,
  looksLikeCU,
};
