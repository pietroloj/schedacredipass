const {
  onSchedule,
} = require("firebase-functions/v2/scheduler");

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin =
  require("firebase-admin");

const {
  google,
} = require("googleapis");

const {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  buildOAuthClient,
} = require("./gmail-oauth");

const {
  BANK_DOMAIN_SEED,
} = require("./mail-bank-domains.seed");

const {
  loadBankCatalog,
  detectBank,
  findPracticeMatch,
  rememberPracticeNumber,
} = require("./mail-matcher");


if (!admin.apps.length) {
  admin.initializeApp();
}


const db =
  admin.firestore();

const storage =
  admin.storage();


/*
|--------------------------------------------------------------------------
| HELPERS GMAIL API
|--------------------------------------------------------------------------
*/

function headerValue(
  headers,
  name
) {

  const target =
    String(
      name
    )
    .toLowerCase();

  const found =
    (
      Array.isArray(headers)
        ?
        headers
        :
        []
    )
    .find(
      item =>
        String(
          item?.name
          ||
          ""
        )
        .toLowerCase() ===
        target
    );

  return String(
    found?.value
    ||
    ""
  );

}


function parseAddresses(value) {

  return String(
    value
    ||
    ""
  )
  .split(",")
  .map(
    part => {

      const bracket =
        part.match(
          /<([^>]+)>/
        );

      return (
        bracket?.[1]
        ||
        part
      )
      .trim()
      .toLowerCase();

    }
  )
  .filter(
    value =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(
          value
        )
  );

}


function decodeBase64Url(value) {

  if (!value) {
    return "";
  }

  return Buffer
    .from(
      value
        .replace(
          /-/g,
          "+"
        )
        .replace(
          /_/g,
          "/"
        ),
      "base64"
    )
    .toString(
      "utf8"
    );

}


function extractBodyFromPayload(
  payload
) {

  if (!payload) {
    return "";
  }

  if (
    payload.mimeType ===
      "text/plain"
    &&
    payload.body?.data
  ) {
    return decodeBase64Url(
      payload.body.data
    );
  }

  const parts =
    Array.isArray(
      payload.parts
    )
      ? payload.parts
      : [];

  for (const part of parts) {
    const text =
      extractBodyFromPayload(
        part
      );

    if (text) {
      return text;
    }
  }

  if (
    payload.mimeType ===
      "text/html"
    &&
    payload.body?.data
  ) {
    return decodeBase64Url(
      payload.body.data
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<br\s*\/?>/gi,
      "\n"
    )
    .replace(
      /<\/p>/gi,
      "\n"
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /&nbsp;/g,
      " "
    )
    .replace(
      /&amp;/g,
      "&"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
  }

  return "";

}


function collectAttachments(
  payload,
  out = []
) {

  if (!payload) {
    return out;
  }

  if (
    payload.filename
    &&
    payload.body
      ?.attachmentId
  ) {
    out.push({
      filename:
        payload.filename,

      mimeType:
        payload.mimeType
        ||
        "application/octet-stream",

      attachmentId:
        payload.body
          .attachmentId,

      size:
        payload.body
          .size
        ||
        0,
    });
  }

  const parts =
    Array.isArray(
      payload.parts
    )
      ? payload.parts
      : [];

  for (const part of parts) {
    collectAttachments(
      part,
      out
    );
  }

  return out;
}


function toMatcherMail(
  message
) {

  const headers =
    message.payload
      ?.headers
    ||
    [];

  const from =
    parseAddresses(
      headerValue(
        headers,
        "From"
      )
    );

  const to =
    parseAddresses(
      headerValue(
        headers,
        "To"
      )
    );

  const cc =
    parseAddresses(
      headerValue(
        headers,
        "Cc"
      )
    );

  const replyTo =
    parseAddresses(
      headerValue(
        headers,
        "Reply-To"
      )
    );

  const internalDate =
    Number(
      message.internalDate
    );

  return {
    messageId:
      headerValue(
        headers,
        "Message-ID"
      )
      ||
      message.id,

    threadId:
      message.threadId,

    subject:
      headerValue(
        headers,
        "Subject"
      ),

    date:
      Number.isFinite(
        internalDate
      )
        ? new Date(
            internalDate
          )
        : new Date(),

    from: {
      value:
        from.map(
          address => ({
            address,
          })
        ),
    },

    to: {
      value:
        to.map(
          address => ({
            address,
          })
        ),
    },

    cc: {
      value:
        cc.map(
          address => ({
            address,
          })
        ),
    },

    replyTo: {
      value:
        replyTo.map(
          address => ({
            address,
          })
        ),
    },

    text:
      extractBodyFromPayload(
        message.payload
      )
      .slice(
        0,
        50000
      ),
  };

}


async function getGmailForConnection(
  connection
) {

  const oauth2Client =
    buildOAuthClient();

  oauth2Client
    .setCredentials({
      refresh_token:
        connection
          .refreshToken,
    });

  return google.gmail({
    version:
      "v1",

    auth:
      oauth2Client,
  });

}


async function ensureBankSeed() {

  const metaRef =
    db
      .collection("system")
      .doc("mail_bank_seed");

  const meta =
    await metaRef.get();

  if (
    meta.exists
    &&
    meta.data()?.version >=
      1
  ) {
    return;
  }

  let batch =
    db.batch();

  let count =
    0;

  for (const item of BANK_DOMAIN_SEED) {

    const ref =
      db
        .collection(
          "mail_banche"
        )
        .doc(
          item.bancaKey
        );

    batch.set(
      ref,
      {
        bancaKey:
          item.bancaKey,

        bancaNome:
          item.bancaNome,

        domini:
          item.domains,

        attiva:
          true,

        origine:
          "seed",

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

    count++;

    if (
      count %
      400 ===
      0
    ) {
      await batch.commit();

      batch =
        db.batch();
    }
  }

  batch.set(
    metaRef,
    {
      version:
        1,

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

  await batch.commit();

}


async function saveAttachments({
  gmail,
  gmailMessageId,
  practiceId,
  emailDocId,
  payload,
}) {

  const descriptors =
    collectAttachments(
      payload
    );

  const saved =
    [];

  if (!descriptors.length) {
    return saved;
  }

  const bucket =
    storage.bucket();

  for (
    let i = 0;
    i <
      descriptors.length;
    i++
  ) {

    const item =
      descriptors[i];

    const response =
      await gmail
        .users
        .messages
        .attachments
        .get({
          userId:
            "me",

          messageId:
            gmailMessageId,

          id:
            item
              .attachmentId,
        });

    const data =
      response.data
        ?.data;

    if (!data) {
      continue;
    }

    const buffer =
      Buffer.from(
        data
          .replace(
            /-/g,
            "+"
          )
          .replace(
            /_/g,
            "/"
          ),
        "base64"
      );

    const safeName =
      String(
        item.filename
        ||
        `allegato_${i + 1}`
      )
      .replace(
        /[^\w.\-() ]+/g,
        "_"
      )
      .slice(
        0,
        160
      );

    const path =
      `EmailPratiche/${practiceId}/${emailDocId}/${safeName}`;

    await bucket
      .file(
        path
      )
      .save(
        buffer,
        {
          metadata: {
            contentType:
              item.mimeType,
          },

          resumable:
            false,
        }
      );

    saved.push({
      nome:
        safeName,

      contentType:
        item.mimeType,

      size:
        buffer.length,

      storagePath:
        path,
    });

  }

  return saved;

}


async function addTimelineEntry({
  practiceRef,
  emailDocId,
  direction,
  mail,
  bankDetection,
  matchMethod,
}) {

  await db.runTransaction(
    async tx => {

      const snap =
        await tx.get(
          practiceRef
        );

      const data =
        snap.data()
        ||
        {};

      const current =
        Array.isArray(
          data
            .attivita_interne
        )
          ? data
              .attivita_interne
          : [];

      const from =
        (
          mail.from
            ?.value
          ||
          []
        )
        .map(
          x =>
            x.address
        )
        .join(
          ", "
        );

      const to =
        (
          mail.to
            ?.value
          ||
          []
        )
        .map(
          x =>
            x.address
        )
        .join(
          ", "
        );

      const entry = {
        id:
          `email_${emailDocId}`,

        tipo:
          direction ===
            "ricevuta"
            ? "email_ricevuta"
            : "email_inviata",

        titolo:
          direction ===
            "ricevuta"
            ?
            `✉️ Email ricevuta${bankDetection?.bank?.bancaNome ? ` - ${bankDetection.bank.bancaNome}` : ""}`
            :
            `📤 Email inviata${bankDetection?.bank?.bancaNome ? ` - ${bankDetection.bank.bancaNome}` : ""}`,

        descrizione:
          String(
            mail.subject
            ||
            "(senza oggetto)"
          ),

        autore:
          direction ===
            "ricevuta"
            ? (
                from
                ||
                "Mittente email"
              )
            : (
                to
                ||
                "Email inviata"
              ),

        creato_il:
          (
            mail.date
            instanceof Date
            &&
            !Number.isNaN(
              mail.date
                .getTime()
            )
          )
            ? mail.date
                .toISOString()
            : new Date()
                .toISOString(),

        meta: {
          email_doc_id:
            emailDocId,

          direzione:
            direction,

          banca:
            bankDetection
              ?.bank
              ?.bancaNome
            ||
            "",

          dominio:
            bankDetection
              ?.domain
            ||
            "",

          match_method:
            matchMethod
            ||
            "",
        },
      };

      if (
        current.some(
          item =>
            item?.id ===
              entry.id
        )
      ) {
        return;
      }

      tx.set(
        practiceRef,
        {
          attivita_interne: [
            entry,
            ...current,
          ]
          .slice(
            0,
            300
          ),

          attivita_interna_aggiornata_il:
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

}


async function proposeUnknownDomain({
  mail,
  bankDetection,
  match,
}) {

  const domain =
    bankDetection
      ?.domain
    ||
    "";

  if (
    !domain
    ||
    bankDetection
      ?.verified
  ) {
    return;
  }

  await db
    .collection(
      "mail_domini_da_verificare"
    )
    .doc(
      domain
        .replace(
          /[^\w.-]+/g,
          "_"
        )
    )
    .set(
      {
        dominio:
          domain,

        stato:
          "pending",

        ultimaRilevazioneIl:
          admin.firestore
            .FieldValue
            .serverTimestamp(),

        ultimoOggetto:
          String(
            mail.subject
            ||
            ""
          )
          .slice(
            0,
            500
          ),

        praticaSuggerita:
          match
            ?.best
            ?.id
          ||
          null,

        numeroPraticaSuggerito:
          match
            ?.extractedNumbers
            ?.[0]
          ||
          null,
      },
      {
        merge:
          true,
      }
    );

}


async function savePending({
  gmailMessage,
  mail,
  bankDetection,
  match,
  consultantUid,
}) {

  const id =
    `${consultantUid}_${gmailMessage.id}`;

  await db
    .collection(
      "mail_da_associare"
    )
    .doc(
      id
    )
    .set(
      {
        gmailMessageId:
          gmailMessage.id,

        gmailThreadId:
          gmailMessage.threadId
          ||
          null,

        consultantUid,

        data:
          admin.firestore.Timestamp.fromDate(
            mail.date
            ||
            new Date()
          ),

        mittente:
          (
            mail.from
              ?.value
            ||
            []
          )
          .map(
            x =>
              x.address
          ),

        destinatari: [
          ...(
            mail.to
              ?.value
            ||
            []
          ),
          ...(
            mail.cc
              ?.value
            ||
            []
          ),
        ]
        .map(
          x =>
            x.address
        ),

        oggetto:
          mail.subject
          ||
          "",

        dominio:
          bankDetection
            ?.domain
          ||
          "",

        dominioVerificato:
          bankDetection
            ?.verified ===
          true,

        bancaSuggerita:
          bankDetection
            ?.bank
            ?.bancaNome
          ||
          null,

        numeriPraticaRilevati:
          match
            ?.extractedNumbers
          ||
          [],

        candidati:
          (
            match
              ?.candidates
            ||
            []
          )
          .map(
            x => ({
              praticaId:
                x.id,

              score:
                x.score,

              method:
                x.method,
            })
          ),

        stato:
          "pending",

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

}


async function saveMatched({
  gmail,
  gmailMessage,
  mail,
  connection,
  match,
  bankDetection,
}) {

  const practiceRef =
    match.best.ref;

  const practiceId =
    match.best.id;

  const emailDocId =
    `${connection.uid}_${gmailMessage.id}`;

  const emailRef =
    practiceRef
      .collection(
        "email_timeline"
      )
      .doc(
        emailDocId
      );

  const existing =
    await emailRef.get();

  if (existing.exists) {
    return false;
  }

  const labels =
    Array.isArray(
      gmailMessage
        .labelIds
    )
      ? gmailMessage
          .labelIds
      : [];

  const direction =
    labels.includes(
      "SENT"
    )
      ?
      "inviata"
      :
      "ricevuta";

  const attachments =
    await saveAttachments({
      gmail,

      gmailMessageId:
        gmailMessage.id,

      practiceId,

      emailDocId,

      payload:
        gmailMessage.payload,
    });

  const from =
    (
      mail.from
        ?.value
      ||
      []
    )
    .map(
      x =>
        x.address
    );

  const to = [
    ...(
      mail.to
        ?.value
      ||
      []
    ),
    ...(
      mail.cc
        ?.value
      ||
      []
    ),
  ]
  .map(
    x =>
      x.address
  );

  const replyTo =
    (
      mail.replyTo
        ?.value
      ||
      []
    )
    .map(
      x =>
        x.address
    );

  await emailRef.set({
    gmailMessageId:
      gmailMessage.id,

    gmailThreadId:
      gmailMessage.threadId
      ||
      null,

    consultantUid:
      connection.uid,

    casella:
      connection.email,

    direzione:
      direction,

    data:
      admin.firestore.Timestamp.fromDate(
        mail.date
        ||
        new Date()
      ),

    mittente:
      from,

    destinatari:
      to,

    replyTo,

    oggetto:
      mail.subject
      ||
      "",

    testo:
      mail.text
      ||
      "",

    allegati:
      attachments,

    banca:
      bankDetection
        ?.bank
        ?.bancaNome
      ||
      null,

    bancaKey:
      bankDetection
        ?.bank
        ?.bancaKey
      ||
      bankDetection
        ?.bank
        ?.id
      ||
      null,

    dominio:
      bankDetection
        ?.domain
      ||
      null,

    dominioVerificato:
      bankDetection
        ?.verified ===
      true,

    numeroPraticaRilevato:
      match.best
        ?.practiceNumber
      ||
      match
        .extractedNumbers
        ?.[0]
      ||
      null,

    matchMethod:
      match.best
        ?.method
      ||
      null,

    matchScore:
      match.best
        ?.score
      ||
      null,

    creatoIl:
      admin.firestore
        .FieldValue
        .serverTimestamp(),
  });

  await addTimelineEntry({
    practiceRef,

    emailDocId,

    direction,

    mail,

    bankDetection,

    matchMethod:
      match.best
        ?.method,
  });

  const number =
    match.best
      ?.practiceNumber
    ||
    match
      .extractedNumbers
      ?.[0];

  if (number) {
    await rememberPracticeNumber({
      db,

      practiceRef,

      number,

      bankDetection,
    });
  }

  return true;

}


/*
|--------------------------------------------------------------------------
| SINCRONIZZAZIONE SINGOLA CASELLA
|--------------------------------------------------------------------------
*/

async function syncConnection(
  connection,
  bankCatalog
) {

  const gmail =
    await getGmailForConnection(
      connection
    );

  const state =
    connection.syncState
    ||
    {};

  const afterMillis =
    Number(
      state.afterMillis
      ||
      (
        Date.now()
        -
        30 * 24 * 60 * 60 * 1000
      )
    );

  /*
   * Gmail search usa secondi Unix.
   * Il filtro finale sulla data creazione fascicolo rimane comunque
   * nel matcher, quindi vecchie email non vengono associate.
   */
  const q =
    `after:${Math.floor(afterMillis / 1000)}`;

  let pageToken =
    null;

  let processed =
    0;

  let matched =
    0;

  let newestMillis =
    afterMillis;

  do {

    const list =
      await gmail
        .users
        .messages
        .list({
          userId:
            "me",

          q,

          maxResults:
            100,

          pageToken:
            pageToken
            ||
            undefined,
        });

    const messages =
      list.data
        ?.messages
      ||
      [];

    for (const item of messages) {

      const detail =
        await gmail
          .users
          .messages
          .get({
            userId:
              "me",

            id:
              item.id,

            format:
              "full",
          });

      const gmailMessage =
        detail.data;

      const mail =
        toMatcherMail(
          gmailMessage
        );

      processed++;

      const millis =
        mail.date
          ?.getTime?.()
        ||
        0;

      if (
        millis >
        newestMillis
      ) {
        newestMillis =
          millis;
      }

      const bankDetection =
        detectBank(
          bankCatalog,
          mail
        );

      const match =
        await findPracticeMatch({
          db,

          mail,

          bankDetection,
        });

      await proposeUnknownDomain({
        mail,

        bankDetection,

        match,
      });

      if (
        match.matched
        &&
        match.best
          ?.ref
      ) {

        const saved =
          await saveMatched({
            gmail,

            gmailMessage,

            mail,

            connection,

            match,

            bankDetection,
          });

        if (saved) {
          matched++;
        }

      }
      else if (
        bankDetection
          .verified
        ||
        match
          .candidates
          ?.length
        ||
        match
          .extractedNumbers
          ?.length
      ) {

        await savePending({
          gmailMessage,

          mail,

          bankDetection,

          match,

          consultantUid:
            connection.uid,
        });

      }

    }

    pageToken =
      list.data
        ?.nextPageToken
      ||
      null;

    /*
     * Evitiamo di scandire una casella enorme nella stessa esecuzione.
     */
    if (
      processed >=
      300
    ) {
      break;
    }

  }
  while(pageToken);

  /*
   * Sovrapposizione di 5 minuti per tollerare ritardi / ordering.
   * La deduplicazione avviene tramite Gmail Message ID.
   */
  const nextAfter =
    Math.max(
      afterMillis,
      newestMillis -
        5 * 60 * 1000
    );

  await db
    .collection(
      "gmail_connections"
    )
    .doc(
      connection.uid
    )
    .set(
      {
        syncState: {
          afterMillis:
            nextAfter,
        },

        lastSyncAt:
          admin.firestore
            .FieldValue
            .serverTimestamp(),

        lastSyncOk:
          true,

        lastError:
          null,
      },
      {
        merge:
          true,
      }
    );

  return {
    uid:
      connection.uid,

    email:
      connection.email,

    processed,

    matched,
  };

}


async function syncAllConnections() {

  await ensureBankSeed();

  const connectionsSnap =
    await db
      .collection(
        "gmail_connections"
      )
      .where(
        "connected",
        "==",
        true
      )
      .get();

  const bankCatalog =
    await loadBankCatalog(
      db
    );

  const results =
    [];

  for (const doc of connectionsSnap.docs) {

    const connection = {
      uid:
        doc.id,

      ...(
        doc.data()
        ||
        {}
      ),
    };

    try {

      const result =
        await syncConnection(
          connection,
          bankCatalog
        );

      results.push({
        ...result,

        ok:
          true,
      });

    }
    catch(error) {

      console.error(
        "Errore sync Gmail",
        connection.uid,
        error
      );

      await doc.ref.set(
        {
          lastSyncAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          lastSyncOk:
            false,

          lastError:
            String(
              error?.message
              ||
              error
            )
            .slice(
              0,
              1500
            ),
        },
        {
          merge:
            true,
        }
      );

      results.push({
        uid:
          connection.uid,

        email:
          connection.email,

        ok:
          false,

        error:
          error?.message
          ||
          "Errore sync",
      });

    }

  }

  return {
    ok:
      true,

    connections:
      connectionsSnap.size,

    results,
  };

}


/*
|--------------------------------------------------------------------------
| SCHEDULER
|--------------------------------------------------------------------------
*/

const sincronizzaGmailPratiche =
  onSchedule(
    {
      schedule:
        "every 5 minutes",

      timeZone:
        "Europe/Rome",

      region:
        "us-central1",

      memory:
        "1GiB",

      timeoutSeconds:
        540,

      secrets: [
        GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET,
      ],
    },

    async () => {

      const result =
        await syncAllConnections();

      console.log(
        "Gmail API sync:",
        JSON.stringify(
          result
        )
      );

    }
  );


/*
|--------------------------------------------------------------------------
| SYNC MANUALE DEL SOLO UTENTE LOGGATO
|--------------------------------------------------------------------------
*/

const sincronizzaGmailPersonale =
  onCall(
    {
      region:
        "us-central1",

      memory:
        "1GiB",

      timeoutSeconds:
        540,

      secrets: [
        GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET,
      ],
    },

    async request => {

      if (!request.auth?.uid) {
        throw new HttpsError(
          "unauthenticated",
          "Accesso richiesto."
        );
      }

      const ref =
        db
          .collection(
            "gmail_connections"
          )
          .doc(
            request.auth.uid
          );

      const snap =
        await ref.get();

      if (
        !snap.exists
        ||
        snap.data()
          ?.connected !==
          true
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Gmail non collegata."
        );
      }

      const bankCatalog =
        await loadBankCatalog(
          db
        );

      const result =
        await syncConnection(
          {
            uid:
              snap.id,

            ...(
              snap.data()
              ||
              {}
            ),
          },

          bankCatalog
        );

      return {
        ok:
          true,

        ...result,
      };

    }
  );


module.exports = {
  sincronizzaGmailPratiche,
  sincronizzaGmailPersonale,
};
