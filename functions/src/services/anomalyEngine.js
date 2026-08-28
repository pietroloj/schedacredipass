const { notEmpty } = require("../utils/strings");
const { normalizeNumber } = require("../utils/numbers");


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


function extractNumbers(
  values = []
) {
  const out = [];

  for (
    const value of
    values
  ) {
    if (
      typeof value ===
      "number"
      &&
      Number.isFinite(value)
    ) {
      out.push(value);
      continue;
    }

    if (
      value
      &&
      typeof value ===
      "object"
    ) {
      for (
        const key of [
          "importo",
          "amount",
          "valore",
          "netto",
        ]
      ) {
        const n =
          normalizeNumber(
            value[key]
          );

        if (
          Number.isFinite(n)
        ) {
          out.push(n);
        }
      }
    }

    const text =
      typeof value ===
        "string"
        ? value
        : "";

    const matches =
      text.match(
        /-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})|-?\d+(?:[.,]\d{1,2})?/g
      )
      ||
      [];

    for (
      const match of
      matches
    ) {
      const n =
        normalizeNumber(
          match
        );

      if (
        Number.isFinite(n)
        &&
        n > 100
      ) {
        out.push(n);
      }
    }
  }

  return out;
}


function amountMatches(
  expected,
  observed,
  tolerancePct = 0.05,
  toleranceAbs = 25
) {
  const exp =
    normalizeNumber(
      expected
    );

  if (
    !Number.isFinite(exp)
    ||
    exp <= 0
  ) {
    return true;
  }

  return observed.some(
    value => {
      const obs =
        normalizeNumber(
          value
        );

      if (
        !Number.isFinite(obs)
      ) {
        return false;
      }

      const tolerance =
        Math.max(
          toleranceAbs,
          exp *
          tolerancePct
        );

      return (
        Math.abs(
          obs -
          exp
        )
        <=
        tolerance
      );
    }
  );
}


function detectPracticeAnomalies(
  snapshot
) {
  const anomalie = [];
  const warnings = [];

  const docs =
    snapshot.documenti ||
    [];

  const immobili =
    docs
      .map(
        d =>
          d
            ?.estrazione
            ?.dati_estratti ||
          {}
      )
      .filter(
        x =>
          notEmpty(x.foglio)
          ||
          notEmpty(
            x.particella
          )
          ||
          notEmpty(
            x.subalterno
          )
      );

  const keys =
    new Set(
      immobili.map(
        x =>
          `${x.foglio || ""}|${x.particella || ""}|${x.subalterno || ""}`
      )
    );

  if (
    keys.size >
    1
  ) {
    anomalie.push(
      "Dati catastali non coerenti tra i documenti immobiliari (Es. Visura vs Atto vs Preliminare)."
    );
  }

  const prezzi =
    docs
      .map(
        d =>
          d
            ?.estrazione
            ?.dati_estratti
            ?.prezzo_compravendita
      )
      .filter(
        Boolean
      );

  if (
    new Set(
      prezzi
    ).size >
    1
  ) {
    warnings.push(
      "Prezzi di compravendita non uniformi tra i documenti."
    );
  }

  const intestatariList =
    docs
      .flatMap(
        d =>
          d
            ?.estrazione
            ?.dati_estratti
            ?.intestatari ||
          []
      )
      .filter(
        Boolean
      );

  if (
    intestatariList.length >
    1
    &&
    new Set(
      intestatariList
    ).size >
    1
  ) {
    warnings.push(
      "Intestatari non perfettamente allineati tra visura, atto o preliminare."
    );
  }

  const classiEnergetiche =
    docs
      .map(
        d =>
          d
            ?.estrazione
            ?.dati_estratti
            ?.classe_energetica
      )
      .filter(
        Boolean
      );

  if (
    classiEnergetiche.length >
    1
    &&
    new Set(
      classiEnergetiche
    ).size >
    1
  ) {
    warnings.push(
      "Classe energetica non coerente tra i vari documenti tecnici."
    );
  }

  const importiLavori =
    docs
      .map(
        d =>
          d
            ?.estrazione
            ?.dati_estratti
            ?.importo_lavori
      )
      .filter(
        Boolean
      );

  if (
    importiLavori.length >
    1
    &&
    new Set(
      importiLavori
    ).size >
    1
  ) {
    warnings.push(
      "Importi lavori non coerenti tra i vari preventivi e computi."
    );
  }


  /*
   * CONTROLLO ANTIFRODE REDDITO VS BANCA
   *
   * Non cerchiamo più la stringa esatta.
   * Confrontiamo gli importi numericamente con una tolleranza del 5%
   * e minimo €25, perché il netto accreditato può differire leggermente.
   */
  const incomeDocs =
    docs.filter(
      d =>
        [
          "doc_bustepaga",
          "doc_cud",
        ].includes(
          baseType(d)
        )
    );

  const bankDocs =
    docs.filter(
      d =>
        [
          "doc_ec",
          "doc_mov",
        ].includes(
          baseType(d)
        )
    );

  if (
    incomeDocs.length >
    0
    &&
    bankDocs.length >
    0
  ) {
    const incomeAmounts =
      incomeDocs
        .map(
          d =>
            normalizeNumber(
              d
                ?.estrazione
                ?.dati_estratti
                ?.netto_mensile_rilevato_documento
              ??
              d
                ?.decisioneBackend
                ?.redditoBancarioMensile
            )
        )
        .filter(
          x =>
            Number.isFinite(x)
            &&
            x >
            0
        );

    const bankValues =
      extractNumbers(
        bankDocs.flatMap(
          d =>
            d
              ?.estrazione
              ?.stipendi_rilevati
            ||
            []
        )
      );

    if (
      incomeAmounts.length
      &&
      bankValues.length
    ) {
      const noMatch =
        incomeAmounts.every(
          income =>
            !amountMatches(
              income,
              bankValues
            )
        );

      if (
        noMatch
      ) {
        warnings.push(
          "Possibile mismatch stipendio: gli accrediti stipendio/pensione rilevati sul conto non risultano compatibili (tolleranza 5%) con il netto mensile disponibile dai documenti reddituali. Verifica manuale consigliata."
        );
      }
    }
    else if (
      incomeAmounts.length
      &&
      bankValues.length ===
      0
    ) {
      warnings.push(
        "Documentazione reddituale presente, ma nell'estratto conto analizzato non sono stati individuati accrediti stipendio/pensione verificabili. Controllare periodo e completezza del documento."
      );
    }
  }

  return {
    anomalieBloccanti:
      anomalie,

    anomalieWarning:
      warnings,

    hasBlocking:
      anomalie.length >
      0,
  };
}


module.exports = {
  detectPracticeAnomalies,
};
