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


function safeText(
  value,
  max =
    1000
) {

  return String(
    value
    ??
    ""
  )
  .slice(
    0,
    max
  );

}


async function writeGmailAudit({
  uid,
  event,
  email = null,
  ok = true,
  source = "backend",
  detail = null,
  metadata = null,
}) {

  if (
    !uid
    ||
    !event
  ) {
    return;
  }

  const ref =
    db
      .collection(
        "gmail_audit_logs"
      )
      .doc();

  const cleanMetadata =
    metadata
    &&
    typeof metadata ===
      "object"
      ? JSON.parse(
          JSON.stringify(
            metadata
          )
        )
      : null;

  await ref.set({
    uid,

    event:
      safeText(
        event,
        120
      ),

    email:
      email
      ?
      safeText(
        email,
        320
      )
      :
      null,

    ok:
      ok ===
      true,

    source:
      safeText(
        source,
        100
      ),

    detail:
      detail
      ?
      safeText(
        detail,
        1500
      )
      :
      null,

    metadata:
      cleanMetadata,

    createdAt:
      admin.firestore
        .FieldValue
        .serverTimestamp(),
  });

}


const listaAuditGmailPersonale =
  onCall(
    {
      region:
        "us-central1",
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
            "gmail_audit_logs"
          )
          .where(
            "uid",
            "==",
            uid
          )
          .orderBy(
            "createdAt",
            "desc"
          )
          .limit(
            30
          )
          .get();

      return {
        ok:
          true,

        events:
          snap.docs.map(
            doc => {

              const data =
                doc.data()
                ||
                {};

              return {
                id:
                  doc.id,

                event:
                  data.event
                  ||
                  "",

                email:
                  data.email
                  ||
                  null,

                ok:
                  data.ok ===
                  true,

                source:
                  data.source
                  ||
                  "",

                detail:
                  data.detail
                  ||
                  null,

                metadata:
                  data.metadata
                  ||
                  null,

                createdAt:
                  data.createdAt
                    ?.toDate?.()
                    ?.toISOString?.()
                  ||
                  null,
              };

            }
          ),
      };

    }
  );


module.exports = {
  writeGmailAudit,
  listaAuditGmailPersonale,
};
