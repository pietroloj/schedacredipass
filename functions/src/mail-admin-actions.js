const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin =
  require("firebase-admin");

const {
  rememberPracticeNumber,
} = require("./mail-matcher");


if (!admin.apps.length) {
  admin.initializeApp();
}


const db =
  admin.firestore();


async function isAdminUser(uid) {

  if (!uid) {
    return false;
  }

  const snap =
    await db
      .collection(
        "consulenti"
      )
      .doc(
        uid
      )
      .get();

  return (
    snap.exists
    &&
    snap.data()
      ?.ruolo ===
      "admin"
    &&
    snap.data()
      ?.attivo !==
      false
  );

}


const confermaDominioBanca =
  onCall(
    {
      region:
        "us-central1",
    },

    async request => {

      if (!request.auth?.uid) {
        throw new HttpsError(
          "unauthenticated",
          "Accesso richiesto."
        );
      }

      if (
        !await isAdminUser(
          request.auth.uid
        )
      ) {
        throw new HttpsError(
          "permission-denied",
          "Solo Admin può confermare domini banca."
        );
      }

      const domain =
        String(
          request.data
            ?.dominio
          ||
          ""
        )
        .trim()
        .toLowerCase();

      const bancaKey =
        String(
          request.data
            ?.bancaKey
          ||
          ""
        )
        .trim();

      const bancaNome =
        String(
          request.data
            ?.bancaNome
          ||
          ""
        )
        .trim();

      if (
        !domain
        ||
        !bancaKey
        ||
        !bancaNome
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Dominio, bancaKey e bancaNome obbligatori."
        );
      }

      const bankRef =
        db
          .collection(
            "mail_banche"
          )
          .doc(
            bancaKey
          );

      await db.runTransaction(
        async tx => {

          const snap =
            await tx.get(
              bankRef
            );

          const data =
            snap.exists
              ? snap.data()
              : {};

          const current =
            Array.isArray(
              data?.domini
            )
              ? data.domini
              : [];

          const domains =
            Array.from(
              new Set([
                ...current
                  .map(
                    x =>
                      String(x)
                        .toLowerCase()
                  ),

                domain,
              ])
            );

          tx.set(
            bankRef,
            {
              bancaKey,

              bancaNome,

              domini:
                domains,

              attiva:
                true,

              origine:
                data?.origine
                ||
                "manuale",

              aggiornatoIl:
                admin.firestore
                  .FieldValue
                  .serverTimestamp(),
            },
            {
              merge:
                true,
            }
          );

          tx.set(
            db
              .collection(
                "mail_domini_da_verificare"
              )
              .doc(
                domain
                  .replace(
                    /[^\w.-]+/g,
                    "_"
                  )
              ),
            {
              dominio:
                domain,

              stato:
                "approved",

              bancaKey,

              bancaNome,

              approvatoDa:
                request.auth.uid,

              approvatoIl:
                admin.firestore
                  .FieldValue
                  .serverTimestamp(),
            },
            {
              merge:
                true,
            }
          );

        }
      );

      return {
        ok:
          true,

        dominio:
          domain,

        bancaKey,

        bancaNome,
      };

    }
  );


const associaEmailAPratica =
  onCall(
    {
      region:
        "us-central1",
    },

    async request => {

      if (!request.auth?.uid) {
        throw new HttpsError(
          "unauthenticated",
          "Accesso richiesto."
        );
      }

      const emailId =
        String(
          request.data
            ?.emailId
          ||
          ""
        )
        .trim();

      const practiceId =
        String(
          request.data
            ?.practiceId
          ||
          ""
        )
        .trim();

      if (
        !emailId
        ||
        !practiceId
      ) {
        throw new HttpsError(
          "invalid-argument",
          "emailId e practiceId sono obbligatori."
        );
      }

      const pendingRef =
        db
          .collection(
            "mail_da_associare"
          )
          .doc(
            emailId
          );

      const pending =
        await pendingRef.get();

      if (!pending.exists) {
        throw new HttpsError(
          "not-found",
          "Email non trovata."
        );
      }

      const data =
        pending.data()
        ||
        {};

      const practiceRef =
        db
          .collection(
            "pratiche_mutuo"
          )
          .doc(
            practiceId
          );

      const number =
        Array.isArray(
          data
            .numeriPraticaRilevati
        )
          ? data
              .numeriPraticaRilevati
              [0]
          : null;

      if (number) {
        await rememberPracticeNumber({
          db,

          practiceRef,

          number,

          bankDetection: {
            verified:
              data
                .dominioVerificato ===
              true,

            domain:
              data.dominio
              ||
              "",

            bank:
              data.bancaSuggerita
                ? {
                    bancaNome:
                      data.bancaSuggerita,
                  }
                : null,
          },
        });
      }

      await pendingRef.set(
        {
          stato:
            "associated",

          praticaId:
            practiceId,

          associatoDa:
            request.auth.uid,

          associatoIl:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        },
        {
          merge:
            true,
        }
      );

      return {
        ok:
          true,

        practiceId,
      };

    }
  );


module.exports = {
  confermaDominioBanca,
  associaEmailAPratica,
};
