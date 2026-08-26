function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let s = String(value).trim().replace(/€/g, "").replace(/\s/g, "");
  if (!s) return null;

  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function unique(values = []) {
  return Array.from(new Set(values.filter((v) => v !== undefined && v !== null && String(v).trim() !== "")));
}

function extractionData(doc) {
  const root = doc?.estrazione || {};
  const nested = root?.dati_estratti || {};
  return { ...root, ...nested };
}

function documentCode(doc) {
  return String(doc?.tipoDocumento || doc?.codiceDocumento || "").toLowerCase();
}

function subjectIndexFromCode(code = "") {
  const m = String(code).match(/(?:_|)(1|2)$/);
  return m ? Number(m[1]) : null;
}

function buildDeclaredApplicant(practiceData = {}, index = 1) {
  const p = index === 1 ? "cliente" : "cliente2";
  const suffix = index;

  const nome = firstDefined(practiceData[`${p}_nome`]);
  const cognome = firstDefined(practiceData[`${p}_cognome`]);
  const nomeCompleto = firstDefined(
    practiceData[`${p}_nome_completo`],
    [nome, cognome].filter(Boolean).join(" ").trim()
  );

  return {
    indice: index,
    nome,
    cognome,
    nomeCompleto,
    codiceFiscale: firstDefined(practiceData[`${p}_cf`]),
    dataNascita: firstDefined(practiceData[`${p}_data_nascita`]),
    comuneNascita: firstDefined(practiceData[`${p}_comune_nascita`], practiceData[`${p}_luogo_nascita`]),
    sesso: firstDefined(practiceData[`${p}_sesso`]),
    email: firstDefined(practiceData[`${p}_email`]),
    cellulare: firstDefined(practiceData[`${p}_cell`]),
    contratto: firstDefined(
      practiceData[`lav${suffix}`],
      practiceData[`contratto_richiedente_${suffix}`]
    ),
    redditoNettoDichiarato: toNumber(firstDefined(
      practiceData[`reddito_richiedente_${suffix}`],
      practiceData[`${p}_reddito`]
    )),
  };
}

function buildPracticeSnapshot(allDocs = [], practiceData = {}) {
  const richiedente1 = buildDeclaredApplicant(practiceData, 1);
  const richiedente2 = buildDeclaredApplicant(practiceData, 2);

  const snapshot = {
    soggetti: {
      nominativi: unique([richiedente1.nomeCompleto, richiedente2.nomeCompleto]),
      codiciFiscali: unique([richiedente1.codiceFiscale, richiedente2.codiceFiscale]),
      richiedente1,
      richiedente2,
    },

    immobile: {
      indirizzo: firstDefined(practiceData.indirizzo_immobile, practiceData.immobile_indirizzo),
      comune: firstDefined(practiceData.comune_immobile, practiceData.immobile_comune),
      foglio: "",
      particella: "",
      subalterno: "",
      categoria: "",
      rendita: "",
      intestatari: [],
      quote: [],
      classeEnergetica: "",
      valoreDichiarato: toNumber(firstDefined(practiceData.valore_immobile, practiceData.immobile_valore)),
    },

    operazione: {
      prezzoCompravendita: firstDefined(practiceData.valore_compravendita, practiceData.mutuo_compravendita),
      caparra: firstDefined(practiceData.caparra, practiceData.importo_caparra),
      importoLavori: firstDefined(practiceData.importo_lavori, practiceData.preventivo_lavori),
      provenienzaAttuale: "",
      dataAtto: "",
      importoMutuo: toNumber(firstDefined(practiceData.importo_richiesto, practiceData.mutuo_importo)),
      valoreImmobile: toNumber(firstDefined(practiceData.valore_immobile, practiceData.immobile_valore)),
      rataMutuoStimata: toNumber(firstDefined(
        practiceData.rata_mutuo_stimata,
        practiceData.rata_stimata,
        practiceData.mutuo_rata,
        practiceData.rata_nuovo_mutuo
      )),
      finalita: firstDefined(practiceData.finalita, practiceData.mutuo_finalita),
      durataAnni: toNumber(firstDefined(practiceData.durata_mutuo, practiceData.durata_anni)),
      prodotto: firstDefined(practiceData.prodotto, practiceData.prodotto_bancario),
    },

    reddito: {
      redditoLordoAnnuo: "",
      isee: "",
      dataAssunzione: "",
      redditoNettoDichiaratoR1: richiedente1.redditoNettoDichiarato,
      redditoNettoDichiaratoR2: richiedente2.redditoNettoDichiarato,
      redditoNettoDichiaratoTotale:
        (richiedente1.redditoNettoDichiarato || 0) + (richiedente2.redditoNettoDichiarato || 0) || null,
      redditiDocumentali: [],
    },

    esposizioni: {
      rataFinanziamento: "",
      residuoFinanziamento: "",
      totaleRateDichiarate: toNumber(firstDefined(
        practiceData.totale_rate_finanziamenti,
        practiceData.rata_fin_pre
      )),
      rateRilevate: [],
    },

    banca: {
      stipendiRilevati: [],
      movimentiGamblingRilevati: [],
      movimentiRicorrenti: [],
      saldoNegativoOScoperti: false,
      documentiBancariAnalizzati: 0,
    },

    fonti: {
      schedaConsulenzaDisponibile: Object.keys(practiceData || {}).length > 0,
      documentiAnalizzati: allDocs.length,
    },

    documenti: allDocs,
  };

  for (const doc of allDocs) {
    const e = extractionData(doc);
    const code = documentCode(doc);
    const subjectIndex = subjectIndexFromCode(code);

    const nomeCompletoDoc = [e.nome, e.cognome].filter(Boolean).join(" ").trim();
    if (nomeCompletoDoc) snapshot.soggetti.nominativi.push(nomeCompletoDoc);
    if (e.codice_fiscale) snapshot.soggetti.codiciFiscali.push(e.codice_fiscale);

    const applicant = subjectIndex === 2 ? snapshot.soggetti.richiedente2 : subjectIndex === 1 ? snapshot.soggetti.richiedente1 : null;
    if (applicant) {
      if (e.nome) applicant.nome = e.nome;
      if (e.cognome) applicant.cognome = e.cognome;
      if (nomeCompletoDoc) applicant.nomeCompleto = nomeCompletoDoc;
      if (e.codice_fiscale) applicant.codiceFiscale = e.codice_fiscale;
      if (e.data_nascita) applicant.dataNascita = e.data_nascita;
      if (e.comune_nascita) applicant.comuneNascita = e.comune_nascita;
    }

    if (e.indirizzo_immobile) snapshot.immobile.indirizzo = e.indirizzo_immobile;
    if (e.comune_immobile) snapshot.immobile.comune = e.comune_immobile;
    else if (e.comune && !snapshot.immobile.comune) snapshot.immobile.comune = e.comune;
    if (e.foglio) snapshot.immobile.foglio = e.foglio;
    if (e.particella) snapshot.immobile.particella = e.particella;
    if (e.subalterno) snapshot.immobile.subalterno = e.subalterno;
    if (e.categoria_catastale) snapshot.immobile.categoria = e.categoria_catastale;
    if (e.rendita_catastale) snapshot.immobile.rendita = e.rendita_catastale;
    if (Array.isArray(e.intestatari) && e.intestatari.length) snapshot.immobile.intestatari = e.intestatari;
    if (Array.isArray(e.quote) && e.quote.length) snapshot.immobile.quote = e.quote;
    if (e.classe_energetica) snapshot.immobile.classeEnergetica = e.classe_energetica;

    if (e.prezzo_compravendita) snapshot.operazione.prezzoCompravendita = e.prezzo_compravendita;
    if (e.caparra) snapshot.operazione.caparra = e.caparra;
    if (e.importo_lavori) snapshot.operazione.importoLavori = e.importo_lavori;
    if (e.tipo_provenienza) snapshot.operazione.provenienzaAttuale = e.tipo_provenienza;
    if (e.data_atto) snapshot.operazione.dataAtto = e.data_atto;

    if (e.reddito_lordo_annuo) snapshot.reddito.redditoLordoAnnuo = e.reddito_lordo_annuo;
    if (e.valore_isee) snapshot.reddito.isee = e.valore_isee;
    if (e.data_assunzione) snapshot.reddito.dataAssunzione = e.data_assunzione;

    const nettoDoc = toNumber(firstDefined(
      e.netto_mensile_rilevato_documento,
      e.reddito_netto_mensile,
      e.netto_mensile
    ));
    if (nettoDoc !== null) {
      snapshot.reddito.redditiDocumentali.push({
        tipoDocumento: code,
        richiedente: subjectIndex,
        nettoMensile: nettoDoc,
      });
    }

    if (e.rata_mensile) snapshot.esposizioni.rataFinanziamento = e.rata_mensile;
    if (e.residuo) snapshot.esposizioni.residuoFinanziamento = e.residuo;

    if (Array.isArray(e.rate_rilevate) && e.rate_rilevate.length) {
      snapshot.esposizioni.rateRilevate.push(...e.rate_rilevate);
    }

    if (
      Array.isArray(e.stipendi_rilevati) ||
      Array.isArray(e.movimenti_gambling_rilevati) ||
      Array.isArray(e.movimenti_ricorrenti) ||
      typeof e.saldo_negativo_o_scoperti === "boolean"
    ) {
      snapshot.banca.documentiBancariAnalizzati += 1;
    }

    if (Array.isArray(e.stipendi_rilevati)) snapshot.banca.stipendiRilevati.push(...e.stipendi_rilevati);
    if (Array.isArray(e.movimenti_gambling_rilevati)) snapshot.banca.movimentiGamblingRilevati.push(...e.movimenti_gambling_rilevati);
    if (Array.isArray(e.movimenti_ricorrenti)) snapshot.banca.movimentiRicorrenti.push(...e.movimenti_ricorrenti);
    if (e.saldo_negativo_o_scoperti === true) snapshot.banca.saldoNegativoOScoperti = true;
  }

  snapshot.soggetti.nominativi = unique(snapshot.soggetti.nominativi);
  snapshot.soggetti.codiciFiscali = unique(snapshot.soggetti.codiciFiscali);
  snapshot.esposizioni.rateRilevate = snapshot.esposizioni.rateRilevate || [];
  snapshot.banca.stipendiRilevati = snapshot.banca.stipendiRilevati || [];
  snapshot.banca.movimentiGamblingRilevati = snapshot.banca.movimentiGamblingRilevati || [];
  snapshot.banca.movimentiRicorrenti = snapshot.banca.movimentiRicorrenti || [];

  return snapshot;
}

module.exports = { buildPracticeSnapshot };
