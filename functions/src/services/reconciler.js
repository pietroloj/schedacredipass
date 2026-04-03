function buildPracticeSnapshot(allDocs = []) {
  const snapshot = {
    soggetti: { nominativi: [], codiciFiscali: [] },
    immobile: {
      indirizzo: "",
      comune: "",
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
      prezzoCompravendita: "",
      caparra: "",
      importoLavori: "",
      provenienzaAttuale: "",
      dataAtto: "",
    },
    reddito: {
      redditoLordoAnnuo: "",
      isee: "",
      dataAssunzione: "",
    },
    esposizioni: {
      rataFinanziamento: "",
      residuoFinanziamento: "",
    },
    documenti: allDocs,
  };

  for (const doc of allDocs) {
    const e = doc?.estrazione?.dati_estratti || {};

    if (e.nome || e.cognome) snapshot.soggetti.nominativi.push([e.nome, e.cognome].filter(Boolean).join(" ").trim());
    if (e.codice_fiscale) snapshot.soggetti.codiciFiscali.push(e.codice_fiscale);

    if (e.indirizzo_immobile && !snapshot.immobile.indirizzo) snapshot.immobile.indirizzo = e.indirizzo_immobile;
    if (e.comune && !snapshot.immobile.comune) snapshot.immobile.comune = e.comune;
    if (e.foglio && !snapshot.immobile.foglio) snapshot.immobile.foglio = e.foglio;
    if (e.particella && !snapshot.immobile.particella) snapshot.immobile.particella = e.particella;
    if (e.subalterno && !snapshot.immobile.subalterno) snapshot.immobile.subalterno = e.subalterno;
    if (e.categoria_catastale && !snapshot.immobile.categoria) snapshot.immobile.categoria = e.categoria_catastale;
    if (e.rendita_catastale && !snapshot.immobile.rendita) snapshot.immobile.rendita = e.rendita_catastale;
    if (Array.isArray(e.intestatari) && e.intestatari.length) snapshot.immobile.intestatari = e.intestatari;
    if (Array.isArray(e.quote) && e.quote.length) snapshot.immobile.quote = e.quote;
    if (e.classe_energetica && !snapshot.immobile.classeEnergetica) snapshot.immobile.classeEnergetica = e.classe_energetica;

    if (e.prezzo_compravendita && !snapshot.operazione.prezzoCompravendita) snapshot.operazione.prezzoCompravendita = e.prezzo_compravendita;
    if (e.caparra && !snapshot.operazione.caparra) snapshot.operazione.caparra = e.caparra;
    if (e.importo_lavori && !snapshot.operazione.importoLavori) snapshot.operazione.importoLavori = e.importo_lavori;
    if (e.tipo_provenienza && !snapshot.operazione.provenienzaAttuale) snapshot.operazione.provenienzaAttuale = e.tipo_provenienza;
    if (e.data_atto && !snapshot.operazione.dataAtto) snapshot.operazione.dataAtto = e.data_atto;

    if (e.reddito_lordo_annuo && !snapshot.reddito.redditoLordoAnnuo) snapshot.reddito.redditoLordoAnnuo = e.reddito_lordo_annuo;
    if (e.valore_isee && !snapshot.reddito.isee) snapshot.reddito.isee = e.valore_isee;
    if (e.data_assunzione && !snapshot.reddito.dataAssunzione) snapshot.reddito.dataAssunzione = e.data_assunzione;

    if (e.rata_mensile && !snapshot.esposizioni.rataFinanziamento) snapshot.esposizioni.rataFinanziamento = e.rata_mensile;
    if (e.residuo && !snapshot.esposizioni.residuoFinanziamento) snapshot.esposizioni.residuoFinanziamento = e.residuo;
  }

  return snapshot;
}

module.exports = { buildPracticeSnapshot };
