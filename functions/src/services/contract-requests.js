const { createHash } = require("node:crypto");

async function requestContractTransformation({ db, id, checks, send, serverTimestamp }) {
  const results = [];
  const practiceRef = db.collection("pratiche_mutuo").doc(id);
  for (const { required, subject } of checks.filter(check => check.required)) {
    const claim = await db.runTransaction(async tx => {
      const snap = await tx.get(practiceRef);
      const practice = snap.data();
      if (!practice || practice["doc_" + required] ||
          ["stipulato", "rinunciata", "sospesa"].includes(String(practice.stato_pratica).toLowerCase())) return null;
      const marker = "richiesta_automatica_" + required;
      const existing = practice[marker];
      const currentSlots = Array.isArray(practice.elencoDocRichiesti) ? practice.elencoDocRichiesti : [];
      const mainSlots = Array.isArray(practice.documenti_richiesti_portale) ? practice.documenti_richiesti_portale : [];
      if (!existing && [...currentSlots, ...mainSlots].some(value => String(value).replace(/^doc_/, "") === required)) {
        return { state: "slot_esistente" };
      }
      if (existing?.state === "inviata") return { state: "inviata" };
      if (existing?.state === "invio_in_corso" && Date.now() - existing.timestamp < 300000) return { state: "invio_in_corso" };
      const to = String(subject === "r2" ? practice.cliente2_email || practice.cliente_email || practice.email_cliente || "" :
        practice.cliente_email || practice.email_cliente || "").trim();
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
      const state = validEmail ? "invio_in_corso" : "email_mancante";
      const patch = {
        elencoDocRichiesti: [...new Set([...currentSlots, required])],
        richiestaIntegrazioneAttiva: true,
        [marker]: { state, timestamp: Date.now() },
      };
      if (!currentSlots.includes(required)) patch.ultimoAggiornamentoIntegrazione = serverTimestamp();
      tx.update(practiceRef, patch);
      return { state, marker, to };
    });

    if (!claim) continue;
    if (claim.state !== "invio_in_corso" || !claim.marker) {
      results.push({ document: required, state: claim.state });
      continue;
    }
    const url = "https://consulenza-credipass.it/upload.html?id=" + encodeURIComponent(id);
    const idempotencyKey = "credipass-contratto-" + createHash("sha256").update(id + "|" + required).digest("hex");
    let state = "inviata";
    try {
      await send({
        to: claim.to,
        subject: "Credipass · Documento richiesto nel portale",
        html: '<p>Per proseguire con la pratica, accedi al portale e carica la comunicazione di trasformazione del contratto a tempo indeterminato.</p><p><a href="' +
          url + '">Apri il portale documenti</a></p>',
        idempotencyKey,
      });
    } catch {
      state = "invio_non_riuscito";
    }
    await practiceRef.update({ [claim.marker]: { state, timestamp: Date.now() } });
    results.push({ document: required, state });
  }
  return results;
}

module.exports = { requestContractTransformation };
