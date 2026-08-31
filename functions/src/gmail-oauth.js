const {
  onCall,
  onRequest,
  HttpsError,
} = require("firebase-functions/v2/https");

const {
  defineSecret,
} = require("firebase-functions/params");

const admin =
  require("firebase-admin");

const crypto =
  require("crypto");

const {
  google,
} = require("googleapis");

const {
  GMAIL_TOKEN_ENCRYPTION_KEY,
  encryptRefreshToken,
} = require("./gmail-token-crypto");

const {
  writeGmailAudit,
} = require("./gmail-audit");


if (!admin.apps.length) {
  admin.initializeApp();
}


const db =
  admin.firestore();


const GOOGLE_OAUTH_CLIENT_ID =
  defineSecret(
    "GOOGLE_OAUTH_CLIENT_ID"
  );

const GOOGLE_OAUTH_CLIENT_SECRET =
  defineSecret(
    "GOOGLE_OAUTH_CLIENT_SECRET"
  );


const OAUTH_REDIRECT_URI =
  "https://us-central1-consulenza-credipass.cloudfunctions.net/gmailOAuthCallback";


const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
];


function buildOAuthClient() {

  return new google.auth.OAuth2(
    GOOGLE_OAUTH_CLIENT_ID.value(),
    GOOGLE_OAUTH_CLIENT_SECRET.value(),
    OAUTH_REDIRECT_URI
  );

}


function randomState() {

  return crypto
    .randomBytes(32)
    .toString("hex");

}


async function requireActiveConsultant(uid) {

  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "Accesso richiesto."
    );
  }

  const snap =
    await db
      .collection("consulenti")
      .doc(uid)
      .get();

  if (
    !snap.exists
    ||
    snap.data()?.attivo ===
      false
  ) {
    throw new HttpsError(
      "permission-denied",
      "Profilo consulente non attivo."
    );
  }

  return snap.data()
  ||
  {};

}


/*
|--------------------------------------------------------------------------
| CREA URL DI COLLEGAMENTO
|--------------------------------------------------------------------------
|
| Ogni consulente autorizza una sola volta la propria casella Gmail.
| Nessuna password Gmail o App Password viene salvata nel gestionale.
|
*/

const creaCollegamentoGmail =
  onCall(
    {
      region:
        "us-central1",

      secrets: [
        GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET,
      ],
    },

    async request => {

      const uid =
        request.auth?.uid;

      const consultant =
        await requireActiveConsultant(
          uid
        );

      const state =
        randomState();

      const stateRef =
        db
          .collection(
            "gmail_oauth_states"
          )
          .doc(
            state
          );

      await stateRef.set({
        uid,

        createdAt:
          admin.firestore
            .FieldValue
            .serverTimestamp(),

        expiresAt:
          admin.firestore.Timestamp.fromMillis(
            Date.now()
            +
            10 * 60 * 1000
          ),
      });

      const oauth2Client =
        buildOAuthClient();

      const loginHint =
        String(
          consultant.email
          ||
          request.auth?.token?.email
          ||
          ""
        )
        .trim();

      const url =
        oauth2Client
          .generateAuthUrl({
            access_type:
              "offline",

            prompt:
              "consent",

            include_granted_scopes:
              true,

            scope:
              GMAIL_SCOPES,

            state,

            login_hint:
              loginHint
              ||
              undefined,
          });

      return {
        ok:
          true,

        url,

        redirectUri:
          OAUTH_REDIRECT_URI,
      };

    }
  );


/*
|--------------------------------------------------------------------------
| CALLBACK GOOGLE
|--------------------------------------------------------------------------
*/

const gmailOAuthCallback =
  onRequest(
    {
      region:
        "us-central1",

      secrets: [
        GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET,
        GMAIL_TOKEN_ENCRYPTION_KEY,
      ],
    },

    async (
      req,
      res
    ) => {

      try {

        const code =
          String(
            req.query?.code
            ||
            ""
          );

        const state =
          String(
            req.query?.state
            ||
            ""
          );

        const error =
          String(
            req.query?.error
            ||
            ""
          );

        if (error) {
          res
            .status(400)
            .send(
              buildResultHtml({
                ok:
                  false,

                title:
                  "Collegamento Gmail annullato",

                message:
                  `Google ha restituito: ${error}`,
              })
            );

          return;
        }

        if (
          !code
          ||
          !state
        ) {
          res
            .status(400)
            .send(
              buildResultHtml({
                ok:
                  false,

                title:
                  "Collegamento non valido",

                message:
                  "Codice OAuth o stato mancanti.",
              })
            );

          return;
        }

        const stateRef =
          db
            .collection(
              "gmail_oauth_states"
            )
            .doc(
              state
            );

        const stateSnap =
          await stateRef.get();

        if (!stateSnap.exists) {
          res
            .status(400)
            .send(
              buildResultHtml({
                ok:
                  false,

                title:
                  "Richiesta scaduta",

                message:
                  "La richiesta di collegamento non esiste più.",
              })
            );

          return;
        }

        const stateData =
          stateSnap.data()
          ||
          {};

        const expiresAt =
          stateData.expiresAt
            ?.toMillis?.()
          ||
          0;

        if (
          !stateData.uid
          ||
          !expiresAt
          ||
          expiresAt <
            Date.now()
        ) {

          await stateRef.delete()
            .catch(
              () => {}
            );

          res
            .status(400)
            .send(
              buildResultHtml({
                ok:
                  false,

                title:
                  "Richiesta scaduta",

                message:
                  "Ripeti il collegamento Gmail dal gestionale.",
              })
            );

          return;
        }

        const oauth2Client =
          buildOAuthClient();

        const tokenResponse =
          await oauth2Client
            .getToken(
              code
            );

        const tokens =
          tokenResponse.tokens
          ||
          {};

        if (
          !tokens.refresh_token
        ) {
          res
            .status(400)
            .send(
              buildResultHtml({
                ok:
                  false,

                title:
                  "Refresh token non ricevuto",

                message:
                  "Revoca l'accesso del gestionale dal tuo Account Google e ripeti il collegamento. Il gestionale necessita dell'accesso offline per sincronizzare la posta.",
              })
            );

          return;
        }

        oauth2Client
          .setCredentials(
            tokens
          );

        const gmail =
          google.gmail({
            version:
              "v1",

            auth:
              oauth2Client,
          });

        const profile =
          await gmail
            .users
            .getProfile({
              userId:
                "me",
            });

        const gmailAddress =
          String(
            profile.data
              ?.emailAddress
            ||
            ""
          )
          .trim()
          .toLowerCase();

        if (!gmailAddress) {
          throw new Error(
            "Impossibile determinare l'indirizzo Gmail collegato."
          );
        }

        const uid =
          stateData.uid;

        /*
         * Il refresh token è salvato in una collection che il browser
         * NON può leggere. Solo Admin SDK / Cloud Functions.
         */
        await db
          .collection(
            "gmail_connections"
          )
          .doc(
            uid
          )
          .set(
            {
              uid,

              email:
                gmailAddress,

              ...encryptRefreshToken(
                tokens.refresh_token
              ),

              /*
               * Non salviamo mai il refresh token in chiaro.
               */
              refreshToken:
                admin.firestore
                  .FieldValue
                  .delete(),

              scope:
                tokens.scope
                ||
                GMAIL_SCOPES.join(
                  " "
                ),

              connected:
                true,

              reconnectRequired:
                false,

              disconnectedReason:
                null,

              connectedAt:
                admin.firestore
                  .FieldValue
                  .serverTimestamp(),

              updatedAt:
                admin.firestore
                  .FieldValue
                  .serverTimestamp(),

              lastSyncAt:
                null,

              lastSyncOk:
                null,

              lastError:
                null,
            },
            {
              merge:
                true,
            }
          );

        await db
          .collection(
            "consulenti"
          )
          .doc(
            uid
          )
          .set(
            {
              gmailCollegata:
                true,

              gmailEmail:
                gmailAddress,

              gmailCollegataIl:
                admin.firestore
                  .FieldValue
                  .serverTimestamp(),
            },
            {
              merge:
                true,
            }
          );

        await writeGmailAudit({
          uid,

          event:
            "gmail_connected",

          email:
            gmailAddress,

          ok:
            true,

          source:
            "oauth_callback",

          detail:
            "Account Gmail collegato tramite OAuth 2.0.",

          metadata: {
            scope:
              tokens.scope
              ||
              GMAIL_SCOPES.join(
                " "
              ),

            tokenEncryption:
              "AES-256-GCM",
          },
        });

        await stateRef.delete();

        res
          .status(200)
          .send(
            buildResultHtml({
              ok:
                true,

              title:
                "Gmail collegata",

              message:
                `${gmailAddress} è stata collegata correttamente al gestionale. Puoi chiudere questa finestra.`,
            })
          );

      }
      catch(error) {

        console.error(
          "gmailOAuthCallback:",
          error
        );

        res
          .status(500)
          .send(
            buildResultHtml({
              ok:
                false,

              title:
                "Errore collegamento Gmail",

              message:
                error?.message
                ||
                "Errore non specificato.",
            })
          );

      }

    }
  );


/*
|--------------------------------------------------------------------------
| STATO COLLEGAMENTO
|--------------------------------------------------------------------------
*/

const statoCollegamentoGmail =
  onCall(
    {
      region:
        "us-central1",
    },

    async request => {

      const uid =
        request.auth?.uid;

      await requireActiveConsultant(
        uid
      );

      const snap =
        await db
          .collection(
            "gmail_connections"
          )
          .doc(
            uid
          )
          .get();

      if (!snap.exists) {
        return {
          ok:
            true,

          connected:
            false,
        };
      }

      const data =
        snap.data()
        ||
        {};

      return {
        ok:
          true,

        connected:
          data.connected ===
          true,

        email:
          data.email
          ||
          "",

        lastSyncAt:
          data.lastSyncAt
            ?.toDate?.()
            ?.toISOString?.()
          ||
          null,

        lastSyncOk:
          data.lastSyncOk
          ??
          null,

        lastError:
          data.lastError
          ||
          null,

        reconnectRequired:
          data.reconnectRequired ===
          true,

        disconnectedReason:
          data.disconnectedReason
          ||
          null,

        tokenEncrypted:
          Boolean(
            data.refreshTokenEncrypted
            &&
            data.refreshTokenIv
            &&
            data.refreshTokenTag
          ),

        tokenEncryption:
          data.refreshTokenEncryption
          ||
          null,

        scope:
          data.scope
          ||
          "",
      };

    }
  );


/*
|--------------------------------------------------------------------------
| DISCONNETTI
|--------------------------------------------------------------------------
*/

const scollegaGmail =
  onCall(
    {
      region:
        "us-central1",
    },

    async request => {

      const uid =
        request.auth?.uid;

      await requireActiveConsultant(
        uid
      );

      const connectionRef =
        db
          .collection(
            "gmail_connections"
          )
          .doc(
            uid
          );

      const connectionSnap =
        await connectionRef.get();

      const connectionData =
        connectionSnap.exists
          ? (
              connectionSnap.data()
              ||
              {}
            )
          : {};

      await writeGmailAudit({
        uid,

        event:
          "gmail_disconnected",

        email:
          connectionData.email
          ||
          null,

        ok:
          true,

        source:
          "user",

        detail:
          "Account Gmail scollegato dal consulente.",
      });

      await connectionRef.delete();

      await db
        .collection(
          "consulenti"
        )
        .doc(
          uid
        )
        .set(
          {
            gmailCollegata:
              false,

            gmailEmail:
              admin.firestore
                .FieldValue
                .delete(),
          },
          {
            merge:
              true,
          }
        );

      return {
        ok:
          true,
      };

    }
  );


function buildResultHtml({
  ok,
  title,
  message,
}) {

  const accent =
    ok
      ? "#198754"
      : "#b42318";

  return `
<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;background:#eef2f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:620px;margin:70px auto;background:#fff;border-radius:16px;padding:30px;border-top:6px solid ${accent};box-shadow:0 12px 34px rgba(0,0,0,.08);">
  <div style="font-size:23px;font-weight:800;color:#002d72;">${escapeHtml(title)}</div>
  <div style="margin-top:14px;color:#4d5964;font-size:14px;line-height:1.65;">${escapeHtml(message)}</div>
  <button onclick="window.close()" style="margin-top:22px;border:0;border-radius:8px;padding:12px 18px;background:#002d72;color:#fff;font-weight:bold;cursor:pointer;">CHIUDI</button>
</div>
</body>
</html>
  `;

}


function escapeHtml(value) {

  return String(
    value
    ??
    ""
  )
  .replace(
    /&/g,
    "&amp;"
  )
  .replace(
    /</g,
    "&lt;"
  )
  .replace(
    />/g,
    "&gt;"
  )
  .replace(
    /"/g,
    "&quot;"
  )
  .replace(
    /'/g,
    "&#039;"
  );

}


module.exports = {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  OAUTH_REDIRECT_URI,
  GMAIL_SCOPES,
  buildOAuthClient,
  creaCollegamentoGmail,
  gmailOAuthCallback,
  statoCollegamentoGmail,
  scollegaGmail,
};
