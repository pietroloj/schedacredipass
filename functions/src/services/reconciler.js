function clean(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .trim();
}


function first(...values) {
  for (
    const value of values
  ) {
    const v =
      clean(value);

    if (v) {
      return value;
    }
  }

  return "";
}


function unique(values = []) {
  return Array.from(
    new Set(
      values
        .map(clean)
        .filter(Boolean)
    )
  );
}


function buildPracticeSnapshot(
  allDocs = [],
  practiceData = {}
) {
  const snapshot = {
    soggetti: {
      nominativi: [],
      codiciFiscali: [],

      r1: {
        nome: first(
          practiceData
            .cliente_nome_completo,
          [
            practiceData
              .cliente_nome,
            practiceData
              .cliente_cognome,
          ]
            .filter(Boolean)
            .join(" ")
        ),

        codiceFiscale:
          first(
            practiceData
              .cliente_cf
          ),

        redditoDichiarato:
          first(
            practiceData
              .reddito_richiedente_1,
            practiceData
              .cliente_reddito
          ),
      },

      r2: {
        nome: first(
          practiceData
            .cliente2_nome_completo,
          [
            practiceData
              .cliente2_nome,
            practiceData
              .cliente2_cognome,
          ]
            .filter(Boolean)
            .join(" ")
        ),

        codiceFiscale:
          first(
            practiceData
              .cliente2_cf
          ),

        redditoDichiarato:
          first(
            practiceData
              .reddito_richiedente_2,
            practiceData
              .cliente2_reddito
          ),
      },
    },

    immobile: {
      indirizzo:
        first(
          practiceData
            .indirizzo_immobile,
          practiceData
            .immobile_indirizzo
        ),

      comune:
        first(
          practiceData
            .comune_immobile,
          practiceData
            .immobile_comune
        ),

      foglio: "",
      particella: "",
      subalterno: "",
      categoria: "",
      rendita: "",
      intestatari: [],
      quote: [],
      classeEnergetica: "",
    },

    operazione: {
      prezzoCompravendita:
        first(
          practiceData
            .valore_compravendita,
          practiceData
            .mutuo_compravendita
        ),

      valoreImmobile:
        first(
          practiceData
            .valore_immobile,
          practiceData
            .immobile_valore
        ),

      importoMutuo:
        first(
          practiceData
            .importo_richiesto,
          practiceData
            .mutuo_importo
        ),

      finalita:
        first(
          practiceData
            .finalita,
          practiceData
            .mutuo_finalita
        ),

      caparra: "",
      importoLavori: "",
      provenienzaAttuale: "",
      dataAtto: "",
    },

    reddito: {
      documentiReddituali: [],
      redditoLordoAnnuo: "",
      isee: "",
      dataAssunzione: "",
    },

    banca: {
      documentiBancari: [],
      alertScommesse: [],
      alertContanti: [],
      alertRate: [],
      alertEntrateStraordinarie: [],
      alertRiscossione: [],
      alertCrypto: [],
      accreditiStipendioPensione: [],
      saldoNegativoOScoperti: false,
    },

    esposizioni: {
      rataFinanziamento:
        first(
          practiceData
            .totale_rate_finanziamenti,
          practiceData
            .rata_fin_pre
        ),

      residuoFinanziamento:
        "",
    },

    documenti:
      allDocs,
  };


  for (
    const doc of allDocs
  ) {
    const e =
      doc
        ?.estrazione
        ?.dati_estratti ||
      {};

    const dec =
      doc
        ?.decisioneBackend ||
      {};

    const nome =
      [
        e.nome,
        e.cognome,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

    if (nome) {
      snapshot
        .soggetti
        .nominativi
        .push(nome);
    }

    if (
      e.codice_fiscale
    ) {
      snapshot
        .soggetti
        .codiciFiscali
        .push(
          e.codice_fiscale
        );
    }

    if (
      e.indirizzo_immobile &&
      !snapshot
        .immobile
        .indirizzo
    ) {
      snapshot
        .immobile
        .indirizzo =
        e.indirizzo_immobile;
    }

    if (
      e.comune &&
      !snapshot
        .immobile
        .comune
    ) {
      snapshot
        .immobile
        .comune =
        e.comune;
    }

    if (
      e.foglio &&
      !snapshot
        .immobile
        .foglio
    ) {
      snapshot
        .immobile
        .foglio =
        e.foglio;
    }

    if (
      e.particella &&
      !snapshot
        .immobile
        .particella
    ) {
      snapshot
        .immobile
        .particella =
        e.particella;
    }

    if (
      e.subalterno &&
      !snapshot
        .immobile
        .subalterno
    ) {
      snapshot
        .immobile
        .subalterno =
        e.subalterno;
    }

    if (
      e.categoria_catastale &&
      !snapshot
        .immobile
        .categoria
    ) {
      snapshot
        .immobile
        .categoria =
        e.categoria_catastale;
    }

    if (
      e.rendita_catastale &&
      !snapshot
        .immobile
        .rendita
    ) {
      snapshot
        .immobile
        .rendita =
        e.rendita_catastale;
    }

    if (
      Array.isArray(
        e.intestatari
      ) &&
      e.intestatari.length
    ) {
      snapshot
        .immobile
        .intestatari =
        e.intestatari;
    }

    if (
      Array.isArray(
        e.quote
      ) &&
      e.quote.length
    ) {
      snapshot
        .immobile
        .quote =
        e.quote;
    }

    if (
      e.classe_energetica &&
      !snapshot
        .immobile
        .classeEnergetica
    ) {
      snapshot
        .immobile
        .classeEnergetica =
        e.classe_energetica;
    }

    if (
      e.prezzo_compravendita &&
      !snapshot
        .operazione
        .prezzoCompravendita
    ) {
      snapshot
        .operazione
        .prezzoCompravendita =
        e.prezzo_compravendita;
    }

    if (
      e.caparra &&
      !snapshot
        .operazione
        .caparra
    ) {
      snapshot
        .operazione
        .caparra =
        e.caparra;
    }

    if (
      e.importo_lavori &&
      !snapshot
        .operazione
        .importoLavori
    ) {
      snapshot
        .operazione
        .importoLavori =
        e.importo_lavori;
    }

    if (
      e.tipo_provenienza &&
      !snapshot
        .operazione
        .provenienzaAttuale
    ) {
      snapshot
        .operazione
        .provenienzaAttuale =
        e.tipo_provenienza;
    }

    if (
      e.data_atto &&
      !snapshot
        .operazione
        .dataAtto
    ) {
      snapshot
        .operazione
        .dataAtto =
        e.data_atto;
    }

    if (
      e.reddito_lordo_annuo
    ) {
      if (
        !snapshot
          .reddito
          .redditoLordoAnnuo
      ) {
        snapshot
          .reddito
          .redditoLordoAnnuo =
          e.reddito_lordo_annuo;
      }

      snapshot
        .reddito
        .documentiReddituali
        .push({
          tipoDocumento:
            doc.tipoDocumento,

          tipoDocumentoBase:
            doc.tipoDocumentoBase,

          redditoLordoAnnuo:
            e.reddito_lordo_annuo,

          redditoBancarioMensile:
            dec
              .redditoBancarioMensile ??
            null,

          dettaglioCalcoloRedditoCU:
            dec
              .dettaglioCalcoloRedditoCU ??
            null,
        });
    }

    if (
      e.valore_isee &&
      !snapshot
        .reddito
        .isee
    ) {
      snapshot
        .reddito
        .isee =
        e.valore_isee;
    }

    if (
      e.data_assunzione &&
      !snapshot
        .reddito
        .dataAssunzione
    ) {
      snapshot
        .reddito
        .dataAssunzione =
        e.data_assunzione;
    }

    if (
      dec
        .scoreComportamentoBancario !==
      undefined
    ) {
      snapshot
        .banca
        .documentiBancari
        .push({
          tipoDocumento:
            doc.tipoDocumento,

          score:
            dec
              .scoreComportamentoBancario,

          severita:
            dec
              .severitaComportamentoBancario,
        });

      snapshot
        .banca
        .alertScommesse
        .push(
          ...(
            dec
              .alertScommesse ||
            []
          )
        );

      snapshot
        .banca
        .alertContanti
        .push(
          ...(
            dec
              .alertContanti ||
            []
          )
        );

      snapshot
        .banca
        .alertRate
        .push(
          ...(
            dec
              .alertRateFinanziamenti ||
            []
          )
        );

      snapshot
        .banca
        .alertEntrateStraordinarie
        .push(
          ...(
            dec
              .alertEntrateStraordinarie ||
            []
          )
        );

      snapshot
        .banca
        .alertRiscossione
        .push(
          ...(
            dec
              .alertRiscossione ||
            []
          )
        );

      snapshot
        .banca
        .alertCrypto
        .push(
          ...(
            dec
              .alertCrypto ||
            []
          )
        );

      snapshot
        .banca
        .accreditiStipendioPensione
        .push(
          ...(
            dec
              .accreditiStipendioPensione ||
            []
          )
        );

      if (
        dec
          .saldoNegativoOScoperti
      ) {
        snapshot
          .banca
          .saldoNegativoOScoperti =
          true;
      }
    }

    if (
      e.rata_mensile &&
      !snapshot
        .esposizioni
        .rataFinanziamento
    ) {
      snapshot
        .esposizioni
        .rataFinanziamento =
        e.rata_mensile;
    }

    if (
      e.residuo &&
      !snapshot
        .esposizioni
        .residuoFinanziamento
    ) {
      snapshot
        .esposizioni
        .residuoFinanziamento =
        e.residuo;
    }
  }


  if (
    snapshot
      .soggetti
      .r1
      .nome
  ) {
    snapshot
      .soggetti
      .nominativi
      .unshift(
        snapshot
          .soggetti
          .r1
          .nome
      );
  }

  if (
    snapshot
      .soggetti
      .r2
      .nome
  ) {
    snapshot
      .soggetti
      .nominativi
      .push(
        snapshot
          .soggetti
          .r2
          .nome
      );
  }

  if (
    snapshot
      .soggetti
      .r1
      .codiceFiscale
  ) {
    snapshot
      .soggetti
      .codiciFiscali
      .unshift(
        snapshot
          .soggetti
          .r1
          .codiceFiscale
      );
  }

  if (
    snapshot
      .soggetti
      .r2
      .codiceFiscale
  ) {
    snapshot
      .soggetti
      .codiciFiscali
      .push(
        snapshot
          .soggetti
          .r2
          .codiceFiscale
      );
  }

  snapshot
    .soggetti
    .nominativi =
    unique(
      snapshot
        .soggetti
        .nominativi
    );

  snapshot
    .soggetti
    .codiciFiscali =
    unique(
      snapshot
        .soggetti
        .codiciFiscali
    );

  for (
    const key of [
      "alertScommesse",
      "alertContanti",
      "alertRate",
      "alertEntrateStraordinarie",
      "alertRiscossione",
      "alertCrypto",
      "accreditiStipendioPensione",
    ]
  ) {
    snapshot
      .banca[key] =
      unique(
        snapshot
          .banca[key]
      );
  }

  return snapshot;
}


module.exports = {
  buildPracticeSnapshot,
};
