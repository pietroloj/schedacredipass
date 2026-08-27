const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const clean = v => String(v || "").trim();

async function isAdmin(uid) {
  if (!uid) return false;
  const snap = await db.collection("consulenti").doc(uid).get();
  return snap.exists &&
    String(snap.data()?.ruolo || "").toLowerCase() === "admin" &&
    snap.data()?.attivo !== false;
}

async function createWorkspaceProfile(uid, fields = {}) {
  const now = admin.firestore.FieldValue.serverTimestamp();

  const profileRef = db.collection("consulenti").doc(uid);
  const workspaceRef = db.collection("workspaces").doc(uid);

  await profileRef.set({
    uid,
    nome: clean(fields.nome),
    cognome: clean(fields.cognome),
    email: clean(fields.email).toLowerCase(),
    ruolo: clean(fields.ruolo) || "consulente",
    attivo: fields.attivo !== false,
    creato_il: fields.creato_il || now,
    ultimo_accesso: now,
  }, { merge: true });

  await workspaceRef.set({
    uid,
    consulente_uid: uid,
    nome: `${clean(fields.nome)} ${clean(fields.cognome)}`.trim(),
    email: clean(fields.email).toLowerCase(),
    attivo: fields.attivo !== false,
    creato_il: fields.creato_il || now,
    ultimo_accesso: now,
    impostazioni: {
      brand: "Credipass",
      colore_primario: "#002d72",
      colore_secondario: "#C99700",
    },
  }, { merge: true });

  const snap = await profileRef.get();
  return { uid, ...(snap.data() || {}) };
}

exports.bootstrapFirstAdmin = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async request => {
    const data = request.data || {};
    const nome = clean(data.nome);
    const cognome = clean(data.cognome);
    const email = clean(data.email).toLowerCase();
    const password = String(data.password || "");

    if (!nome || !cognome || !email || password.length < 8) {
      throw new HttpsError("invalid-argument", "Compila tutti i campi. Password minimo 8 caratteri.");
    }

    const securityRef = db.collection("system").doc("security");
    const security = await securityRef.get();

    if (security.exists && security.data()?.admin_uid) {
      throw new HttpsError("failed-precondition", "Il primo amministratore è già stato configurato.");
    }

    let user;
    try {
      user = await admin.auth().createUser({
        email,
        password,
        displayName: `${nome} ${cognome}`,
        emailVerified: false,
        disabled: false,
      });
    } catch (error) {
      if (error?.code === "auth/email-already-exists") {
        throw new HttpsError("already-exists", "Esiste già un account con questa email.");
      }
      throw error;
    }

    // Secondo controllo dopo la creazione per evitare doppio bootstrap concorrente.
    const secondCheck = await securityRef.get();
    if (secondCheck.exists && secondCheck.data()?.admin_uid) {
      try { await admin.auth().deleteUser(user.uid); } catch (_) {}
      throw new HttpsError("failed-precondition", "Il primo amministratore è già stato configurato.");
    }

    await createWorkspaceProfile(user.uid, {
      nome, cognome, email, ruolo: "admin", attivo: true
    });

    await securityRef.set({
      admin_uid: user.uid,
      admin_email: email,
      configurato_il: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { ok: true, uid: user.uid, email };
  }
);

exports.ensureConsultantProfile = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Accesso richiesto.");
    }

    const uid = request.auth.uid;
    const user = await admin.auth().getUser(uid);

    if (user.disabled) {
      throw new HttpsError("permission-denied", "Account disabilitato.");
    }

    const existing = await db.collection("consulenti").doc(uid).get();

    let nome = "";
    let cognome = "";
    let ruolo = "consulente";
    let attivo = true;

    if (existing.exists) {
      const d = existing.data() || {};
      nome = d.nome || "";
      cognome = d.cognome || "";
      ruolo = d.ruolo || "consulente";
      attivo = d.attivo !== false;
    } else if (user.displayName) {
      const p = user.displayName.trim().split(/\s+/);
      nome = p.shift() || "";
      cognome = p.join(" ");
    }

    if (!attivo) {
      throw new HttpsError("permission-denied", "Account non attivo.");
    }

    const profile = await createWorkspaceProfile(uid, {
      nome,
      cognome,
      email: user.email || "",
      ruolo,
      attivo,
    });

    return {
      ok: true,
      profile: {
        uid,
        nome: profile.nome || "",
        cognome: profile.cognome || "",
        email: profile.email || user.email || "",
        ruolo: profile.ruolo || "consulente",
        attivo: profile.attivo !== false,
      }
    };
  }
);

exports.createConsultant = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Accesso richiesto.");
    }
    if (!(await isAdmin(request.auth.uid))) {
      throw new HttpsError("permission-denied", "Funzione riservata all'amministratore.");
    }

    const d = request.data || {};
    const nome = clean(d.nome);
    const cognome = clean(d.cognome);
    const email = clean(d.email).toLowerCase();
    const password = String(d.password || "");
    const requestedRole = clean(d.ruolo).toLowerCase();
    const ruolo = ["admin", "consulente", "segreteria"].includes(requestedRole)
      ? requestedRole : "consulente";

    if (!nome || !cognome || !email || password.length < 8) {
      throw new HttpsError("invalid-argument", "Dati incompleti o password troppo corta.");
    }

    let user;
    try {
      user = await admin.auth().createUser({
        email,
        password,
        displayName: `${nome} ${cognome}`,
        emailVerified: false,
        disabled: false,
      });
    } catch (error) {
      if (error?.code === "auth/email-already-exists") {
        throw new HttpsError("already-exists", "Esiste già un account con questa email.");
      }
      throw error;
    }

    await createWorkspaceProfile(user.uid, {
      nome, cognome, email, ruolo, attivo: true
    });

    return { ok: true, uid: user.uid, email, ruolo };
  }
);
