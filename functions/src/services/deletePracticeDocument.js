const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}


function normalizeCode(value) {
  return String(value || "")
    .trim()
    .replace(/^doc_/, "")
    .toLowerCase();
}

function detectCodeFromFilename(filename) {
  const name = String(filename || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_");

  const known = [
    "bustepaga1", "bustepaga2",
    "residenza1",
    "planimetria",
    "visuracat",
    "preliminare",
    "preventivo",
    "matrimonio",
    "prestiti",
    "mutuo_pre",
    "visura1", "visura2",
    "unici1", "unici2",
    "cud1", "cud2",
    "ci1", "ci2",
    "ts1", "ts2",
    "ec1", "ec2",
    "mov1", "mov2",
    "f241", "f242",
    "atto",
    "isee",
  ];

  for (const code of known) {
    if (
      name.startsWith(`doc_${code}_`) ||
      name.startsWith(`${code}_`) ||
      name.includes(`_${code}_`)
    ) {
      return code;
    }
  }

  const isR2 =
    name.includes("_r2_") ||
    name.includes("_richiedente_2_") ||
    name.includes("_secondo_richiedente_");

  if (
    name.includes("carta_identita") ||
    name.includes("carta_di_identita") ||
    name.includes("carta_id") ||
    name.includes("documento_identita")
  ) {
    return isR2 ? "ci2" : "ci1";
  }

  if (
    name.includes("tessera_sanitaria") ||
    name.includes("codice_fiscale")
  ) {
    return isR2 ? "ts2" : "ts1";
  }

  if (
    name.includes("certificazione_unica") ||
    name.includes("_cud_") ||
    name.includes("_cu_")
  ) {
    return isR2 ? "cud2" : "cud1";
  }

  if (
    name.includes("cumulativo") ||
    name.includes("residenza")
  ) {
    return "residenza1";
  }

  if (name.includes("estratto_conto")) {
    return isR2 ? "ec2" : "ec1";
  }

  if (name.includes("movimenti")) {
    return isR2 ? "mov2" : "mov1";
  }

  return null;
}

function getBucket() {
  const cfg =
    process.env.FIREBASE_CONFIG
      ? JSON.parse(process.env.FIREBASE_CONFIG)
      : {};

  const bucketName =
    cfg.storageBucket ||
    `${process.env.GCLOUD_PROJECT}.firebasestorage.app`;

  return admin.storage().bucket(bucketName);
}

exports.deletePracticeDocument = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    const data = request.data || {};

    const idCliente =
      String(data.idCliente || "").trim();

    const fullPath =
      String(data.fullPath || "").trim();

    const codiceDocumento =
      normalizeCode(data.codiceDocumento);

    const nomeDocumento =
      String(data.nomeDocumento || "").trim() ||
      "Documento";

    if (!idCliente || !fullPath) {
      throw new HttpsError(
        "invalid-argument",
        "idCliente e fullPath sono obbligatori."
      );
    }

    if (!request.auth?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "Accedi come consulente per eliminare documenti."
      );
    }

    const callerUid = request.auth.uid;

    const profileSnap =
      await admin.firestore()
        .collection("consulenti")
        .doc(callerUid)
        .get();

    const callerIsAdmin =
      profileSnap.exists &&
      String(profileSnap.data()?.ruolo || "").toLowerCase() === "admin" &&
      profileSnap.data()?.attivo !== false;

    const practiceSnap =
      await admin.firestore()
        .collection("pratiche_mutuo")
        .doc(idCliente)
        .get();

    if (!practiceSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Pratica non trovata."
      );
    }

    const practiceData = practiceSnap.data() || {};

    const ownerUid =
      practiceData.consulente_uid ||
      practiceData.workspace_uid ||
      practiceData.owner_uid ||
      "";

    if (!callerIsAdmin && ownerUid !== callerUid) {
      throw new HttpsError(
        "permission-denied",
        "Non hai i permessi per modificare questa pratica."
      );
    }

    const allowedPrefixes = [
      `Fascicoli/${idCliente}/`,
      `Fascicoli/${idCliente.replace(/_/g, " ")}/`,
      `Fascicoli/${idCliente.replace(/_/g, "-")}/`,
    ];

    if (
      !allowedPrefixes.some(prefix =>
        fullPath.startsWith(prefix)
      )
    ) {
      throw new HttpsError(
        "permission-denied",
        "Il file non appartiene al fascicolo richiesto."
      );
    }

    const bucket =
      getBucket();

    const file =
      bucket.file(fullPath);

    const [exists] =
      await file.exists();

    if (!exists) {
      throw new HttpsError(
        "not-found",
        "File non trovato nello Storage."
      );
    }

    await file.delete();

    const folder =
      fullPath.substring(
        0,
        fullPath.lastIndexOf("/") + 1
      );

    const [remainingFiles] =
      await bucket.getFiles({
        prefix: folder,
      });

    const effectiveCode =
      codiceDocumento ||
      detectCodeFromFilename(
        fullPath.split("/").pop()
      );

    const haAltreVersioni =
      effectiveCode
        ? remainingFiles.some(item => {
            const filename =
              item.name.split("/").pop();

            return (
              detectCodeFromFilename(filename) ===
              effectiveCode
            );
          })
        : false;

    const praticaRef =
      admin.firestore()
        .collection("pratiche_mutuo")
        .doc(idCliente);

    const evento = {
      id:
        `evt_${Date.now()}_delete`,
      tipo:
        "documento_eliminato",
      titolo:
        `Documento rimosso: ${nomeDocumento}`,
      descrizione:
        haAltreVersioni
          ? "È stata eliminata una versione del documento. Nel fascicolo restano altre versioni."
          : "Il documento è stato eliminato dal fascicolo.",
      origine:
        "cloud_function_delete",
      icona:
        "fa-trash",
      visibile_cliente:
        false,
      data_ms:
        Date.now(),
    };

    const updates = {
      attivita_cliente_log:
        admin.firestore.FieldValue.arrayUnion(
          evento
        ),
      ultimo_documento_eliminato_il:
        admin.firestore.FieldValue.serverTimestamp(),
    };

    if (effectiveCode) {
      updates[
        `doc_${effectiveCode}`
      ] = haAltreVersioni;
    }

    await praticaRef.set(
      updates,
      { merge: true }
    );

    return {
      ok: true,
      deletedPath: fullPath,
      codiceDocumento:
        effectiveCode || null,
      haAltreVersioni,
    };
  }
);
