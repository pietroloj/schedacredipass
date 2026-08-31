const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin =
  require("firebase-admin");


if (!admin.apps.length) {
  admin.initializeApp();
}


const db =
  admin.firestore();


const listaEmailDaAssociare =
  onCall(
    {
      region: "us-central1",
    },

    async request => {

      const uid =
        request.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "Accesso richiesto."
        );
      }

      const snap =
        await db
          .collection(
            "mail_da_associare"
          )
          .where(
            "consultantUid",
            "==",
            uid
          )
          .where(
            "stato",
            "==",
            "pending"
          )
          .limit(100)
          .get();

      const items =
        snap.docs
          .map(doc => {
            const d = doc.data() || {};

            return {
              id: doc.id,
              data:
                d.data
                  ?.toDate?.()
                  ?.toISOString?.()
                || null,

              mittente:
                d.mittente || [],

              destinatari:
                d.destinatari || [],

              oggetto:
                d.oggetto || "",

              dominio:
                d.dominio || "",

              bancaSuggerita:
                d.bancaSuggerita || null,

              numeriPraticaRilevati:
                d.numeriPraticaRilevati || [],

              candidati:
                d.candidati || [],
            };
          })
          .sort(
            (a,b) =>
              String(b.data || "")
                .localeCompare(
                  String(a.data || "")
                )
          );

      return {
        ok: true,
        items,
      };
    }
  );


const ignoraEmailDaAssociare =
  onCall(
    {
      region: "us-central1",
    },

    async request => {

      const uid =
        request.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "Accesso richiesto."
        );
      }

      const emailId =
        String(
          request.data?.emailId || ""
        ).trim();

      if (!emailId) {
        throw new HttpsError(
          "invalid-argument",
          "emailId mancante."
        );
      }

      const ref =
        db
          .collection(
            "mail_da_associare"
          )
          .doc(emailId);

      const snap =
        await ref.get();

      if (
        !snap.exists
        ||
        snap.data()?.consultantUid !== uid
      ) {
        throw new HttpsError(
          "permission-denied",
          "Email non disponibile."
        );
      }

      await ref.set(
        {
          stato:
            "ignored",

          ignoratoDa:
            uid,

          ignoratoIl:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      return {
        ok: true,
      };
    }
  );


module.exports = {
  listaEmailDaAssociare,
  ignoraEmailDaAssociare,
};
