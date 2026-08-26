const { normalizeNumber, round2 } = require("../utils/numbers");

function mesiDaGiorni(giorni) {
  const g = normalizeNumber(giorni);

  if (!g || g <= 0 || g > 366) return null;

  // Regola concordata:
  // 365 giorni -> 12 mesi
  // 120 giorni -> 4 mesi
  // ecc.
  let mesi = Math.round(g / (365 / 12));

  if (mesi < 1) mesi = 1;
  if (mesi > 12) mesi = 12;

  return mesi;
}

function calculateIncomeFromCU(estratti = {}) {
  const lordo = normalizeNumber(estratti.reddito_lordo_annuo);
  const irpef = normalizeNumber(estratti.irpef);
  const regionale = normalizeNumber(estratti.addizionale_regionale);

  const comunaleAccontoAnno =
    normalizeNumber(estratti.addizionale_comunale_acconto_anno) || 0;

  const comunaleSaldoAnno =
    normalizeNumber(estratti.addizionale_comunale_saldo_anno) || 0;

  const comunaleAccontoAnnoSuccessivo =
    normalizeNumber(estratti.addizionale_comunale_acconto_anno_successivo) || 0;

  const giorni = normalizeNumber(estratti.giorni_lavorati);
  const mesi = mesiDaGiorni(giorni);

  const campiMancanti = [];

  if (!lordo) campiMancanti.push("reddito_lordo_annuo");
  if (irpef === null || irpef === undefined || Number.isNaN(irpef)) {
    campiMancanti.push("irpef");
  }
  if (regionale === null || regionale === undefined || Number.isNaN(regionale)) {
    campiMancanti.push("addizionale_regionale");
  }
  if (!giorni || !mesi) campiMancanti.push("giorni_lavorati");

  if (campiMancanti.length > 0) {
    return {
      ok: false,
      fonte: "CU",
      campiMancanti,
      redditoLordoAnnuo: lordo || null,
      giorniLavorati: giorni || null,
      mensilitaConsiderate: mesi || null,
      redditoNettoAnnuo: null,
      redditoNettoMensile: null,
      dettaglioTrattenute: {
        irpef: irpef ?? null,
        addizionaleRegionale: regionale ?? null,
        addizionaleComunaleAccontoAnno: comunaleAccontoAnno,
        addizionaleComunaleSaldoAnno: comunaleSaldoAnno,
        addizionaleComunaleAccontoAnnoSuccessivo: comunaleAccontoAnnoSuccessivo,
      },
    };
  }

  const totaleTrattenuteFiscali =
    irpef +
    regionale +
    comunaleAccontoAnno +
    comunaleSaldoAnno +
    comunaleAccontoAnnoSuccessivo;

  const nettoAnnuo = lordo - totaleTrattenuteFiscali;

  if (!Number.isFinite(nettoAnnuo) || nettoAnnuo <= 0) {
    return {
      ok: false,
      fonte: "CU",
      campiMancanti: [],
      errore: "Il netto annuo calcolato non è valido.",
      redditoLordoAnnuo: lordo,
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
      "reddito lordo - IRPEF - addizionale regionale - addizionale comunale punto 26 - punto 27 - punto 29",
    redditoLordoAnnuo: round2(lordo),
    dettaglioTrattenute: {
      irpef: round2(irpef),
      addizionaleRegionale: round2(regionale),
      addizionaleComunaleAccontoAnno: round2(comunaleAccontoAnno),
      addizionaleComunaleSaldoAnno: round2(comunaleSaldoAnno),
      addizionaleComunaleAccontoAnnoSuccessivo: round2(comunaleAccontoAnnoSuccessivo),
      totaleTrattenuteFiscali: round2(totaleTrattenuteFiscali),
    },
    redditoNettoAnnuo: round2(nettoAnnuo),
    giorniLavorati: giorni,
    mensilitaConsiderate: mesi,
    redditoNettoMensile: round2(nettoAnnuo / mesi),
  };
}

module.exports = {
  mesiDaGiorni,
  calculateIncomeFromCU,
};
