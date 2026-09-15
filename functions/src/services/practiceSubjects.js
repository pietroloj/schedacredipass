const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const clean = v => String(v ?? "").trim();
const normalizeRole = v => {
  const x = clean(v).toLowerCase();
  if (["richiedente","cointestatario","garante"].includes(x)) return x;
  return "richiedente";
};

function legacySubjects(pratica = {}) {
  const result = [];

  const r1Exists = [
    pratica.cliente_nome, pratica.cliente_cognome, pratica.cliente_nome_completo,
    pratica.cliente_cf, pratica.cliente_email, pratica.cliente_cell
  ].some(v => clean(v));

  if (r1Exists) {
    result.push({
      id: "r1",
      ruolo: "richiedente",
      attivo: true,
      nome: clean(pratica.cliente_nome),
      cognome: clean(pratica.cliente_cognome),
      nome_completo: clean(pratica.cliente_nome_completo) ||
        [clean(pratica.cliente_nome), clean(pratica.cliente_cognome)].filter(Boolean).join(" "),
      codice_fiscale: clean(pratica.cliente_cf).toUpperCase(),
      data_nascita: clean(pratica.cliente_data_nascita),
      comune_nascita: clean(pratica.cliente_comune_nascita || pratica.cliente_luogo_nascita),
      provincia_nascita: clean(pratica.cliente_provincia_nascita),
      sesso: clean(pratica.cliente_sesso),
      cittadinanza: clean(pratica.cliente_cittadinanza),
      residenza: clean(pratica.cliente_residenza || pratica.cliente_indirizzo_residenza),
      cellulare: clean(pratica.cliente_cell),
      email: clean(pratica.cliente_email).toLowerCase(),
      contratto: clean(pratica.lav1 || pratica.contratto_richiedente_1),
      reddito_netto: pratica.reddito_richiedente_1 ?? pratica.cliente_reddito ?? null,
      origine: "legacy"
    });
  }

  const r2Exists = [
    pratica.cliente2_nome, pratica.cliente2_cognome, pratica.cliente2_nome_completo,
    pratica.cliente2_cf, pratica.cliente2_email, pratica.cliente2_cell,
    pratica.reddito_richiedente_2, pratica.lav2
  ].some(v => clean(v));

  if (r2Exists) {
    result.push({
      id: "r2",
      ruolo: "cointestatario",
      attivo: true,
      nome: clean(pratica.cliente2_nome),
      cognome: clean(pratica.cliente2_cognome),
      nome_completo: clean(pratica.cliente2_nome_completo) ||
        [clean(pratica.cliente2_nome), clean(pratica.cliente2_cognome)].filter(Boolean).join(" "),
      codice_fiscale: clean(pratica.cliente2_cf).toUpperCase(),
      data_nascita: clean(pratica.cliente2_data_nascita),
      comune_nascita: clean(pratica.cliente2_comune_nascita || pratica.cliente2_luogo_nascita),
      provincia_nascita: clean(pratica.cliente2_provincia_nascita),
      sesso: clean(pratica.cliente2_sesso),
      cittadinanza: clean(pratica.cliente2_cittadinanza),
      residenza: clean(pratica.cliente2_residenza || pratica.cliente2_indirizzo_residenza),
      cellulare: clean(pratica.cliente2_cell),
      email: clean(pratica.cliente2_email).toLowerCase(),
      contratto: clean(pratica.lav2 || pratica.contratto_richiedente_2),
      reddito_netto: pratica.reddito_richiedente_2 ?? pratica.cliente2_reddito ?? null,
      origine: "legacy"
    });
  }

  return result;
}

function normalizeSubjects(pratica = {}) {
  const source = Array.isArray(pratica.soggetti_pratica) && pratica.soggetti_pratica.length
    ? pratica.soggetti_pratica
    : legacySubjects(pratica);

  return source.map((s, index) => ({
    ...s,
    id: clean(s.id).toLowerCase() || `r${index + 1}`,
    ruolo: normalizeRole(s.ruolo),
    attivo: s.attivo !== false,
    nome: clean(s.nome),
    cognome: clean(s.cognome),
    nome_completo: clean(s.nome_completo) ||
      [clean(s.nome), clean(s.cognome)].filter(Boolean).join(" "),
    codice_fiscale: clean(s.codice_fiscale).toUpperCase(),
    email: clean(s.email).toLowerCase(),
  }));
}

function activeSubjects(pratica = {}) {
  return normalizeSubjects(pratica).filter(s => s.attivo !== false);
}

function nextSubjectId(subjects, role) {
  const prefix = role === "garante" ? "g" : "r";
  const nums = subjects
    .map(s => clean(s.id).toLowerCase())
    .filter(id => id.startsWith(prefix))
    .map(id => Number(id.slice(1)))
    .filter(Number.isFinite);
  return `${prefix}${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

function subjectIdFromDocument(doc = {}) {
  const explicit = clean(
    doc.subject_id ||
    doc.soggetto_id ||
    doc.decisioneBackend?._subjectId
  ).toLowerCase();

  if (explicit) return explicit;

  const original = clean(
    doc.decisioneBackend?._tipoDocumentoOriginale ||
    doc.tipoDocumentoOriginale ||
    doc.tipoDocumento ||
    doc.tipoDocumentoAtteso
  ).toLowerCase();

  // Compatibilità attuale: ...1 = R1, ...2 = R2, ecc.
  const legacy = original.match(/(\d+)$/);
  if (legacy) return `r${legacy[1]}`;

  // Nuovo formato supportato: doc_cud_g1, doc_ec_r3...
  const dynamic = original.match(/_([rg]\d+)$/);
  if (dynamic) return dynamic[1];

  return "";
}

function filterAnalysesForActiveSubjects(documentAnalyses = [], pratica = {}) {
  const active = activeSubjects(pratica);
  const activeIds = new Set(active.map(s => s.id));

  return (documentAnalyses || []).filter(doc => {
    const sid = subjectIdFromDocument(doc);

    // Documenti non personali (immobile/operazione/extra) restano sempre validi.
    if (!sid) return true;

    return activeIds.has(sid);
  });
}

function buildSubjectSummary(pratica = {}) {
  const all = normalizeSubjects(pratica);
  const active = all.filter(s => s.attivo !== false);

  return {
    versione: Number(pratica.struttura_pratica_versione || 1),
    attivi: active,
    esclusi: all.filter(s => s.attivo === false),
    richiedenti: active.filter(s => s.ruolo === "richiedente" || s.ruolo === "cointestatario"),
    garanti: active.filter(s => s.ruolo === "garante"),
  };
}

async function assertAuthenticated(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Accesso richiesto.");
  }

  const snap = await db.collection("consulenti").doc(request.auth.uid).get();
  if (!snap.exists || snap.data()?.attivo === false) {
    throw new HttpsError("permission-denied", "Account non autorizzato.");
  }

  const role = clean(snap.data()?.ruolo).toLowerCase();
  if (!["admin","responsabile","consulente","collaboratore","segreteria"].includes(role)) {
    throw new HttpsError("permission-denied", "Ruolo non autorizzato alla gestione della pratica.");
  }

  return { uid: request.auth.uid, role };
}

async function appendTimeline(idCliente, entry) {
  const ref = db.collection("pratiche_mutuo").doc(idCliente);
  await ref.set({
    timeline_interna: admin.firestore.FieldValue.arrayUnion({
      ...entry,
      data: new Date().toISOString()
    })
  }, { merge: true });
}

exports.getPracticeSubjects = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async request => {
    await assertAuthenticated(request);
    const idCliente = clean(request.data?.idCliente);
    if (!idCliente) throw new HttpsError("invalid-argument", "ID pratica mancante.");

    const ref = db.collection("pratiche_mutuo").doc(idCliente);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Pratica non trovata.");

    const pratica = snap.data() || {};
    let subjects = normalizeSubjects(pratica);

    // Migrazione automatica e non distruttiva delle vecchie pratiche.
    if (!Array.isArray(pratica.soggetti_pratica) || !pratica.soggetti_pratica.length) {
      await ref.set({
        soggetti_pratica: subjects,
        struttura_pratica_versione: Number(pratica.struttura_pratica_versione || 1),
        soggetti_migrati_il: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return { ok: true, ...buildSubjectSummary({ ...pratica, soggetti_pratica: subjects }) };
  }
);

exports.savePracticeSubject = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async request => {
    const actor = await assertAuthenticated(request);
    const idCliente = clean(request.data?.idCliente);
    const input = request.data?.soggetto || {};
    if (!idCliente) throw new HttpsError("invalid-argument", "ID pratica mancante.");

    const ref = db.collection("pratiche_mutuo").doc(idCliente);

    let savedSubject;
    let version;

    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "Pratica non trovata.");

      const pratica = snap.data() || {};
      const subjects = normalizeSubjects(pratica);
      const role = normalizeRole(input.ruolo);
      const requestedId = clean(input.id).toLowerCase();
      const id = requestedId || nextSubjectId(subjects, role);

      const currentIndex = subjects.findIndex(s => s.id === id);
      const current = currentIndex >= 0 ? subjects[currentIndex] : {};

      savedSubject = {
        ...current,
        id,
        ruolo: role,
        attivo: input.attivo !== false,
        nome: clean(input.nome),
        cognome: clean(input.cognome),
        nome_completo: [clean(input.nome), clean(input.cognome)].filter(Boolean).join(" "),
        codice_fiscale: clean(input.codice_fiscale).toUpperCase(),
        data_nascita: clean(input.data_nascita),
        comune_nascita: clean(input.comune_nascita),
        provincia_nascita: clean(input.provincia_nascita).toUpperCase(),
        sesso: clean(input.sesso).toUpperCase(),
        cittadinanza: clean(input.cittadinanza),
        residenza: clean(input.residenza),
        cellulare: clean(input.cellulare),
        email: clean(input.email).toLowerCase(),
        contratto: clean(input.contratto),
        reddito_netto: input.reddito_netto ?? null,
        aggiornato_da: actor.uid,
        aggiornato_il_iso: new Date().toISOString()
      };

      if (currentIndex >= 0) subjects[currentIndex] = savedSubject;
      else subjects.push(savedSubject);

      version = Number(pratica.struttura_pratica_versione || 1) + 1;

      const payload = {
        soggetti_pratica: subjects,
        struttura_pratica_versione: version,
        analisi_struttura_da_aggiornare: true,
        soggetti_aggiornati_il: admin.firestore.FieldValue.serverTimestamp(),
        soggetti_aggiornati_da: actor.uid
      };

      // Mantiene i campi storici R1/R2 sincronizzati finché il resto del gestionale li usa.
      if (id === "r1") {
        Object.assign(payload, {
          cliente_nome: savedSubject.nome,
          cliente_cognome: savedSubject.cognome,
          cliente_nome_completo: savedSubject.nome_completo,
          cliente_cf: savedSubject.codice_fiscale,
          cliente_data_nascita: savedSubject.data_nascita,
          cliente_comune_nascita: savedSubject.comune_nascita,
          cliente_provincia_nascita: savedSubject.provincia_nascita,
          cliente_sesso: savedSubject.sesso,
          cliente_cittadinanza: savedSubject.cittadinanza,
          cliente_residenza: savedSubject.residenza,
          cliente_cell: savedSubject.cellulare,
          cliente_email: savedSubject.email,
          reddito_richiedente_1: savedSubject.reddito_netto
        });
      }

      if (id === "r2" && savedSubject.attivo !== false) {
        Object.assign(payload, {
          cliente2_nome: savedSubject.nome,
          cliente2_cognome: savedSubject.cognome,
          cliente2_nome_completo: savedSubject.nome_completo,
          cliente2_cf: savedSubject.codice_fiscale,
          cliente2_data_nascita: savedSubject.data_nascita,
          cliente2_comune_nascita: savedSubject.comune_nascita,
          cliente2_provincia_nascita: savedSubject.provincia_nascita,
          cliente2_sesso: savedSubject.sesso,
          cliente2_cittadinanza: savedSubject.cittadinanza,
          cliente2_residenza: savedSubject.residenza,
          cliente2_cell: savedSubject.cellulare,
          cliente2_email: savedSubject.email,
          reddito_richiedente_2: savedSubject.reddito_netto
        });
      }

      tx.set(ref, payload, { merge: true });
    });

    await appendTimeline(idCliente, {
      tipo: "soggetto_pratica_modificato",
      titolo: `${savedSubject.id.toUpperCase()} aggiornato`,
      descrizione: `${savedSubject.nome_completo || savedSubject.id} - ${savedSubject.ruolo}`,
      origine: "gestione_soggetti",
      autore_uid: actor.uid
    });

    return { ok: true, soggetto: savedSubject, struttura_pratica_versione: version, richiede_ricostruzione_ai: true };
  }
);

exports.excludePracticeSubject = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async request => {
    const actor = await assertAuthenticated(request);
    const idCliente = clean(request.data?.idCliente);
    const subjectId = clean(request.data?.subjectId).toLowerCase();
    const motivo = clean(request.data?.motivo) || "Non interviene più nell'operazione";

    if (!idCliente || !subjectId) {
      throw new HttpsError("invalid-argument", "Pratica o soggetto mancante.");
    }
    if (subjectId === "r1") {
      throw new HttpsError("failed-precondition", "Il richiedente principale R1 non può essere escluso. Modificalo oppure chiudi la pratica.");
    }

    const ref = db.collection("pratiche_mutuo").doc(idCliente);
    let excluded;
    let version;

    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "Pratica non trovata.");

      const pratica = snap.data() || {};
      const subjects = normalizeSubjects(pratica);
      const index = subjects.findIndex(s => s.id === subjectId);
      if (index < 0) throw new HttpsError("not-found", "Soggetto non trovato.");

      excluded = {
        ...subjects[index],
        attivo: false,
        motivo_esclusione: motivo,
        escluso_da: actor.uid,
        escluso_il_iso: new Date().toISOString()
      };
      subjects[index] = excluded;

      version = Number(pratica.struttura_pratica_versione || 1) + 1;

      const payload = {
        soggetti_pratica: subjects,
        struttura_pratica_versione: version,
        analisi_struttura_da_aggiornare: true,
        soggetti_aggiornati_il: admin.firestore.FieldValue.serverTimestamp(),
        soggetti_aggiornati_da: actor.uid
      };

      // R2 escluso: svuotiamo i campi legacy così archivio/vecchie viste non continuano a mostrarlo.
      // I dati completi restano comunque in soggetti_pratica come storico.
      if (subjectId === "r2") {
        Object.assign(payload, {
          cliente2_nome: "",
          cliente2_cognome: "",
          cliente2_nome_completo: "",
          cliente2_cf: "",
          cliente2_data_nascita: "",
          cliente2_comune_nascita: "",
          cliente2_provincia_nascita: "",
          cliente2_sesso: "",
          cliente2_cittadinanza: "",
          cliente2_residenza: "",
          cliente2_cell: "",
          cliente2_email: "",
          cliente2_reddito: null,
          reddito_richiedente_2: null,
          lav2: ""
        });
      }

      tx.set(ref, payload, { merge: true });
    });

    await appendTimeline(idCliente, {
      tipo: "soggetto_pratica_escluso",
      titolo: `${excluded.id.toUpperCase()} escluso dalla pratica`,
      descrizione: `${excluded.nome_completo || excluded.id}. Motivo: ${motivo}`,
      origine: "gestione_soggetti",
      autore_uid: actor.uid
    });

    return { ok: true, soggetto: excluded, struttura_pratica_versione: version, richiede_ricostruzione_ai: true };
  }
);

exports.reactivatePracticeSubject = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async request => {
    const actor = await assertAuthenticated(request);
    const idCliente = clean(request.data?.idCliente);
    const subjectId = clean(request.data?.subjectId).toLowerCase();
    if (!idCliente || !subjectId) throw new HttpsError("invalid-argument", "Pratica o soggetto mancante.");

    const ref = db.collection("pratiche_mutuo").doc(idCliente);
    let reactivated;
    let version;

    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "Pratica non trovata.");
      const pratica = snap.data() || {};
      const subjects = normalizeSubjects(pratica);
      const index = subjects.findIndex(s => s.id === subjectId);
      if (index < 0) throw new HttpsError("not-found", "Soggetto non trovato.");

      reactivated = {
        ...subjects[index],
        attivo: true,
        motivo_esclusione: "",
        riattivato_da: actor.uid,
        riattivato_il_iso: new Date().toISOString()
      };
      subjects[index] = reactivated;
      version = Number(pratica.struttura_pratica_versione || 1) + 1;

      tx.set(ref, {
        soggetti_pratica: subjects,
        struttura_pratica_versione: version,
        analisi_struttura_da_aggiornare: true,
        soggetti_aggiornati_il: admin.firestore.FieldValue.serverTimestamp(),
        soggetti_aggiornati_da: actor.uid
      }, { merge: true });
    });

    await appendTimeline(idCliente, {
      tipo: "soggetto_pratica_riattivato",
      titolo: `${reactivated.id.toUpperCase()} riattivato`,
      descrizione: `${reactivated.nome_completo || reactivated.id} è nuovamente parte della pratica.`,
      origine: "gestione_soggetti",
      autore_uid: actor.uid
    });

    return { ok: true, soggetto: reactivated, struttura_pratica_versione: version, richiede_ricostruzione_ai: true };
  }
);

module.exports.normalizeSubjects = normalizeSubjects;
module.exports.activeSubjects = activeSubjects;
module.exports.subjectIdFromDocument = subjectIdFromDocument;
module.exports.filterAnalysesForActiveSubjects = filterAnalysesForActiveSubjects;
module.exports.buildSubjectSummary = buildSubjectSummary;
