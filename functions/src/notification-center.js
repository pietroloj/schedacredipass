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


async function createNotification({
  uid,
  type,
  title,
  message,
  practiceId = null,
  emailId = null,
  priority = "normal",
  metadata = null,
}) {

  if (!uid) {
    return null;
  }

  const ref =
    db
      .collection(
        "user_notifications"
      )
      .doc();

  await ref.set({
    uid,

    type:
      String(type || "generic"),

    title:
      String(title || "Notifica")
        .slice(0, 200),

    message:
      String(message || "")
        .slice(0, 2000),

    practiceId:
      practiceId || null,

    emailId:
      emailId || null,

    priority:
      ["low","normal","high","urgent"]
        .includes(priority)
        ? priority
        : "normal",

    read:
      false,

    handled:
      false,

    metadata:
      metadata && typeof metadata === "object"
        ? JSON.parse(JSON.stringify(metadata))
        : null,

    createdAt:
      admin.firestore
        .FieldValue
        .serverTimestamp(),

    readAt:
      null,

    handledAt:
      null,
  });

  return ref.id;
}


const listaNotifichePersonali =
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

      const limit =
        Math.min(
          Math.max(
            Number(request.data?.limit || 50),
            1
          ),
          100
        );

      const snap =
        await db
          .collection(
            "user_notifications"
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
          .limit(limit)
          .get();

      const notifications =
        snap.docs.map(doc => {

          const data =
            doc.data() || {};

          return {
            id: doc.id,
            type: data.type || "",
            title: data.title || "",
            message: data.message || "",
            practiceId: data.practiceId || null,
            emailId: data.emailId || null,
            priority: data.priority || "normal",
            read: data.read === true,
            handled: data.handled === true,
            metadata: data.metadata || null,

            createdAt:
              data.createdAt
                ?.toDate?.()
                ?.toISOString?.()
              || null,
          };
        });

      return {
        ok: true,

        unread:
          notifications
            .filter(x => !x.read)
            .length,

        notifications,
      };
    }
  );


const aggiornaNotificaPersonale =
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

      const notificationId =
        String(
          request.data?.notificationId || ""
        ).trim();

      if (!notificationId) {
        throw new HttpsError(
          "invalid-argument",
          "notificationId mancante."
        );
      }

      const ref =
        db
          .collection(
            "user_notifications"
          )
          .doc(notificationId);

      const snap =
        await ref.get();

      if (
        !snap.exists
        ||
        snap.data()?.uid !== uid
      ) {
        throw new HttpsError(
          "permission-denied",
          "Notifica non disponibile."
        );
      }

      const patch = {};

      if (
        request.data?.read === true
      ) {
        patch.read = true;
        patch.readAt =
          admin.firestore
            .FieldValue
            .serverTimestamp();
      }

      if (
        request.data?.handled === true
      ) {
        patch.handled = true;
        patch.handledAt =
          admin.firestore
            .FieldValue
            .serverTimestamp();

        patch.read = true;
        patch.readAt =
          admin.firestore
            .FieldValue
            .serverTimestamp();
      }

      await ref.set(
        patch,
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
  createNotification,
  listaNotifichePersonali,
  aggiornaNotificaPersonale,
};
