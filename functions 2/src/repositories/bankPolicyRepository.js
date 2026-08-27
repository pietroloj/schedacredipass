const admin = require("firebase-admin");

const COLLECTION = "bank_policies";

/**
 * Recupera tutte le policy bancarie contrassegnate come "attive" (active: true) nel database.
 */
async function listActiveBankPolicies() {
  const snap = await admin
    .firestore()
    .collection(COLLECTION)
    .where("active", "==", true)
    .get();

  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/**
 * Filtra le policy attive in base alla finalità del mutuo (es. "acquisto", "surroga", "ristrutturazione").
 */
async function listPoliciesByFinalita(finalita) {
  const all = await listActiveBankPolicies();
  if (!finalita) return all; // Se non c'è finalità, le restituisce tutte
  
  return all.filter((p) => Array.isArray(p.finalita) && p.finalita.includes(finalita));
}

/**
 * Recupera una singola policy bancaria tramite il suo ID specifico (es. "ing_acquisto_standard").
 */
async function getPolicyById(policyId) {
  const snap = await admin.firestore().collection(COLLECTION).doc(policyId).get();
  
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

module.exports = {
  listActiveBankPolicies,
  listPoliciesByFinalita,
  getPolicyById,
};
