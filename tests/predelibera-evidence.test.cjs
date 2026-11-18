const test = require("node:test");
const assert = require("node:assert/strict");
const { isInformational, contractChecks, bankCoverage, extraordinaryCredits } = require("../functions/src/services/practice-evidence");
const { requestContractTransformation } = require("../functions/src/services/contract-requests");

const extract = (tipoDocumento, estrazione, classification = {}) => ({
  tipoDocumento, estrazione, classificazione: classification,
});

test("il punto 2 apre la verifica e soltanto un cedolino esplicito propone la trasformazione", () => {
  const now = new Date().toISOString().slice(0, 7);
  const cu = extract("doc_cud2", { dati_estratti: { anno_fiscale: String(Number(now.slice(0, 4)) - 1), cu_solo_punto_2: true } });
  const bp = extract("doc_bustepaga2", {
    dati_estratti: { mese_cedolino: now, contratto_esplicito: "indeterminato" },
  }, { leggibile_umano: true, documento_completo_inquadrato: true });
  assert.equal(contractChecks([cu])[0].required, null);
  assert.equal(contractChecks([cu, bp])[0].required, "trasformazione_contratto2");
  assert.deepEqual(contractChecks([cu, bp], { doc_trasformazione_contratto2: true }), []);
  assert.equal(contractChecks([cu, { ...bp, tipoDocumento: "doc_bustepaga1" }])[0].required, null);
  assert.equal(contractChecks([cu, { ...bp, classificazione: {} }])[0].required, null);
});

test("la copertura concatena le liste del conto e indica l'intervallo effettivamente scoperto", () => {
  const period = (from, to, account = "4120") => ({
    periodo_inizio: from, periodo_fine: to, conto_riferimento: account,
  });
  const quarter = extract("doc_ec1", period("2026-07-01", "2026-09-30"));
  const first = extract("doc_mov1", period("2026-10-01", "2026-10-20"));
  const last = extract("doc_mov1", period("2026-10-21", "2026-11-18"));
  assert.deepEqual(bankCoverage([quarter, last, first], "2026-11-18"), []);
  assert.match(bankCoverage([quarter, first], "2026-11-18")[0], /21\/10\/2026 al 18\/11\/2026/);
  assert.match(bankCoverage([quarter, last], "2026-11-18")[0], /01\/10\/2026/);
  assert.match(bankCoverage([last], "2026-11-18")[0], /ultimo trimestre/);
  assert.match(bankCoverage([quarter, extract("doc_mov1", period("2026-10-01", "2026-11-18", "9999"))], "2026-11-18")[0], /01\/10\/2026/);
});

test("i bonifici disposti sono uscite e gli avvisi informativi non diventano criticità", () => {
  const movements = [
    "05/07 - entrata straordinaria € 1.000,00 - ordinante - conto personale",
    "05/07 - uscita straordinaria € 5.988,62 - giroconto disposto a favore",
  ];
  assert.deepEqual(extraordinaryCredits({}, movements), movements.slice(0, 1));
  assert.deepEqual(extraordinaryCredits({ entrate_straordinarie: [
    { data: "2026-07-05", importo: 1000, causale: "Conto personale" },
  ] }, movements).map(x => x.split(" · ").at(-1)), ["Conto personale"]);
  for (const reason of [
    "Campo addizionale comunale acconto anno non valorizzato nella sezione ritenute della CU.",
    "Presente importo di compensi anni precedenti soggetti a tassazione separata, non incluso nell'estrazione reddituale.",
    "Nel documento non sono presenti saldi per singola operazione/giornalieri, ma solo saldo iniziale e saldo finale",
    "Periodo analizzato limitato al trimestre con estratto conto al 30/09/2026",
    "Non risultano nel trimestre addebiti SDD/RID o altre evidenze leggibili di rate/finanziamenti, ma l'assenza è riferita solo al periodo visibile",
  ]) assert(isInformational(reason), reason);
  assert.equal(isInformational("Saldo negativo e insoluto rilevati"), false);
});

test("lo slot si aggiunge senza sostituire la checklist e la mail parte una sola volta", async () => {
  const practice = { cliente_email: "demo@example.test", elencoDocRichiesti: ["ec1"] };
  const writes = patch => Object.assign(practice, patch);
  const ref = { update: async patch => writes(patch) };
  const db = {
    collection: () => ({ doc: () => ref }),
    runTransaction: async fn => fn({ get: async () => ({ data: () => practice }), update: (_, patch) => writes(patch) }),
  };
  const emails = [];
  const options = {
    db, id: "temporanea", checks: [{ required: "trasformazione_contratto1", subject: "r1" }],
    send: async email => emails.push(email), serverTimestamp: () => 1,
  };
  assert.equal((await requestContractTransformation(options))[0].state, "inviata");
  await requestContractTransformation(options);
  assert.deepEqual(practice.elencoDocRichiesti, ["ec1", "trasformazione_contratto1"]);
  assert.equal(emails.length, 1);
});
