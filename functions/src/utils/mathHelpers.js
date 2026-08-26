function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function calcolaRedditoBancarioMensilePrudenziale(estratti = {}) {
  if (!estratti || typeof estratti !== "object") {
    return null;
  }

  const possibiliValori = [
    estratti.redditoBancarioMensile,
    estratti.reddito_mensile,
    estratti.redditoNettoMensile,
    estratti.reddito_netto_mensile,
    estratti.mediaMensile,
    estratti.media_mensile,
    estratti.nettoMensile,
    estratti.netto_mensile,
  ];

  for (const valore of possibiliValori) {
    const numero = toNumber(valore);

    if (numero !== null && numero > 0) {
      return numero;
    }
  }

  const redditoAnnuale = toNumber(
    estratti.redditoAnnuale ||
    estratti.reddito_annuale ||
    estratti.redditoNettoAnnuale ||
    estratti.reddito_netto_annuale
  );

  if (redditoAnnuale !== null && redditoAnnuale > 0) {
    return redditoAnnuale / 12;
  }

  return null;
}

function calcolaDTI(
  redditoBancarioMensile,
  rataMutuoStimata = 0,
  rateAltriFinanziamenti = 0
) {
  const reddito = toNumber(redditoBancarioMensile);
  const rataMutuo = toNumber(rataMutuoStimata) || 0;
  const altreRate = toNumber(rateAltriFinanziamenti) || 0;

  if (reddito === null || reddito <= 0) {
    return null;
  }

  const totaleRate = rataMutuo + altreRate;

  return Number(((totaleRate / reddito) * 100).toFixed(2));
}

function calcolaLTV(importoMutuo, valoreImmobile) {
  const mutuo = toNumber(importoMutuo);
  const valore = toNumber(valoreImmobile);

  if (
    mutuo === null ||
    valore === null ||
    mutuo < 0 ||
    valore <= 0
  ) {
    return null;
  }

  return Number(((mutuo / valore) * 100).toFixed(2));
}

function formatNumberIT(value, decimals = 2) {
  const numero = toNumber(value);

  if (numero === null) {
    return "N/D";
  }

  return numero.toLocaleString("it-IT", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

module.exports = {
  toNumber,
  calcolaRedditoBancarioMensilePrudenziale,
  calcolaDTI,
  calcolaLTV,
  formatNumberIT,
};
