const {
  onSchedule,
} = require("firebase-functions/v2/scheduler");

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const {
  defineSecret,
} = require("firebase-functions/params");

const admin =
  require("firebase-admin");

const {
  ImapFlow,
} = require("imapflow");

const {
  simpleParser,
} = require("mailparser");

const {
  BANK_DOMAIN_SEED,
} = require("./mail-bank-domains.seed");

const {
  emailDomain,
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


const MAIL_GMAIL_USER =
  defineSecret(
    "MAIL_GMAIL_USER"
  );

const MAIL_GMAIL_APP_PASSWORD =
  defineSecret(
    "MAIL_GMAIL_APP_PASSWORD"
  );


function isAdminUser(uid) {
  if (!uid) {
    return false;
  }

  return db
    .collection("consulenti")
    .doc(uid)
    .get()
    .then(snap =>
      snap.exists
      &&
      snap.data()?.ruolo === "admin"
      &&
      snap.data()?.attivo !== false
    );
}


function unique(values = []) {
  return Array.from(
    new Set(
      values.filter(Boolean)
    )
  );
}


function safeArrayAddress(value) {
  if (!value) return [];

  if (Array.isArray(value.value)) {
    return value.value
      .map(x => x?.address)
      .filter(Boolean);
  }

  return [];
}


function emailDirection(mail, mailboxUser, folderName) {
  const user =
    String(mailboxUser || "")
      .trim()
      .toLowerCase();

  const from =
    safeArrayAddress(
      mail.from
    )
    .map(x =>
      String(x).toLowerCase()
    );

  const folder =
    String(folderName || "")
      .toLowerCase();

  if (
    from.includes(user)
    ||
    folder.includes("sent")
    ||
    folder.includes("inviat")
  ) {
    return "inviata";
  }

  return "ricevuta";
}


function htmlToPlain(html = "") {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}


function cleanBody(mail) {
  const text =
    String(
      mail.text
      ||
      ""
    )
    .trim();

  if (text) {
    return text.slice(0, 50000);
  }

  return htmlToPlain(
    mail.html
    ||
    ""
  )
  .slice(0, 50000);
}


function timelineDate(mail) {
  const d =
    mail.date
      ? new Date(mail.date)
      : new Date();

  return (
    Number.isNaN(d.getTime())
      ? new Date()
      : d
  )
  .toISOString();
}


function messageKey(folderName, uid, messageId) {
  const raw =
    messageId
    ||
    `${folderName}:${uid}`;

  return Buffer
    .from(
      String(raw)
    )
    .toString("base64url")
    .slice(0, 180);
}


async function saveAttachments({
  practiceId,
  emailDocId,
  mail,
}) {
  const attachments =
    Array.isArray(mail.attachments)
      ? mail.attachments
      : [];

  if (!attachments.length) {
    return [];
  }

  const bucket =
    storage.bucket();

  const saved = [];

  for (
    let i = 0;
    i < attachments.length;
    i++
  ) {
    const att =
      attachments[i];

    const safeName =
      String(
        att.filename
        ||
        `allegato_${i + 1}`
      )
      .replace(/[^\w.\-() ]+/g, "_")
      .slice(0, 160);

    const path =
      `EmailPratiche/${practiceId}/${emailDocId}/${safeName}`;

    const file =
      bucket.file(path);

    await file.save(
      att.content,
      {
        metadata: {
          contentType:
            att.contentType
            ||
            "application/octet-stream",
        },
        resumable:
          false,
      }
    );

    saved.push({
      nome:
        safeName,
      contentType:
        att.contentType
        ||
        "",
      size:
        att.size
        ||
        att.content?.length
        ||
        0,
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
          data.attivita_interne
        )
          ? data.attivita_interne
          : [];

      const from =
        safeArrayAddress(mail.from)
          .join(", ");

      const to =
        safeArrayAddress(mail.to)
          .join(", ");

      const title =
        direction === "ricevuta"
          ? `✉️ Email ricevuta${bankDetection?.bank?.bancaNome ? ` - ${bankDetection.bank.bancaNome}` : ""}`
          : `📤 Email inviata${bankDetection?.bank?.bancaNome ? ` - ${bankDetection.bank.bancaNome}` : ""}`;

      const entry = {
        id:
          `email_${emailDocId}`,

        tipo:
          direction === "ricevuta"
            ? "email_ricevuta"
            : "email_inviata",

        titolo:
          title,

        descrizione:
          String(
            mail.subject
            ||
            "(senza oggetto)"
          ),

        autore:
          direction === "ricevuta"
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
          timelineDate(
            mail
          ),

        meta: {
          email_doc_id:
            emailDocId,

          direzione:
            direction,

          banca:
            bankDetection?.bank?.bancaNome
            ||
            "",

          dominio:
            bankDetection?.domain
            ||
            "",

          match_method:
            matchMethod
            ||
            "",
        },
      };

      const already =
        current.some(
          item =>
            item?.id ===
              entry.id
        );

      if (already) {
        return;
      }

      tx.set(
        practiceRef,
        {
          attivita_interne: [
            entry,
            ...current,
          ]
          .slice(0, 300),

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
    bankDetection?.domain
    ||
    "";

  if (
    !domain
    ||
    bankDetection?.verified
  ) {
    return;
  }

  const ref =
    db
      .collection(
        "mail_domini_da_verificare"
      )
      .doc(
        domain
          .replace(/[^\w.-]+/g, "_")
      );

  await ref.set(
    {
      dominio:
        domain,

      stato:
        "pending",

      primaRilevazioneIl:
        admin.firestore
          .FieldValue
          .serverTimestamp(),

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
        match?.best?.id
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


async function saveUnmatched({
  mail,
  folderName,
  uid,
  bankDetection,
  match,
}) {
  const id =
    messageKey(
      folderName,
      uid,
      mail.messageId
    );

  await db
    .collection(
      "mail_da_associare"
    )
    .doc(id)
    .set(
      {
        messageId:
          mail.messageId
          ||
          null,

        uid,

        folder:
          folderName,

        data:
          mail.date
          ? admin.firestore.Timestamp.fromDate(
              new Date(mail.date)
            )
          : admin.firestore.FieldValue.serverTimestamp(),

        mittente:
          safeArrayAddress(
            mail.from
          ),

        destinatari:
          unique([
            ...safeArrayAddress(
              mail.to
            ),
            ...safeArrayAddress(
              mail.cc
            ),
          ]),

        oggetto:
          String(
            mail.subject
            ||
            ""
          ),

        dominio:
          bankDetection?.domain
          ||
          "",

        dominioVerificato:
          bankDetection?.verified ===
          true,

        bancaSuggerita:
          bankDetection?.bank?.bancaNome
          ||
          null,

        numeriPraticaRilevati:
          match?.extractedNumbers
          ||
          [],

        candidati:
          (
            match?.candidates
            ||
            []
          )
          .map(x => ({
            praticaId:
              x.id,
            score:
              x.score,
            method:
              x.method,
          })),

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


async function saveMatchedMail({
  practiceRef,
  practiceId,
  folderName,
  uid,
  mail,
  mailboxUser,
  bankDetection,
  match,
}) {
  const emailDocId =
    messageKey(
      folderName,
      uid,
      mail.messageId
    );

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

  const direction =
    emailDirection(
      mail,
      mailboxUser,
      folderName
    );

  const attachments =
    await saveAttachments({
      practiceId,
      emailDocId,
      mail,
    });

  const bodyText =
    cleanBody(
      mail
    );

  await emailRef.set({
    messageId:
      mail.messageId
      ||
      null,

    uid,

    folder:
      folderName,

    direzione:
      direction,

    data:
      mail.date
      ? admin.firestore.Timestamp.fromDate(
          new Date(mail.date)
        )
      : admin.firestore.FieldValue.serverTimestamp(),

    mittente:
      safeArrayAddress(
        mail.from
      ),

    destinatari:
      unique([
        ...safeArrayAddress(
          mail.to
        ),
        ...safeArrayAddress(
          mail.cc
        ),
      ]),

    replyTo:
      safeArrayAddress(
        mail.replyTo
      ),

    oggetto:
      String(
        mail.subject
        ||
        ""
      ),

    testo:
      bodyText,

    allegati:
      attachments,

    banca:
      bankDetection?.bank?.bancaNome
      ||
      null,

    bancaKey:
      bankDetection?.bank?.bancaKey
      ||
      bankDetection?.bank?.id
      ||
      null,

    dominio:
      bankDetection?.domain
      ||
      null,

    dominioVerificato:
      bankDetection?.verified ===
      true,

    numeroPraticaRilevato:
      match?.best?.practiceNumber
      ||
      match?.extractedNumbers?.[0]
      ||
      null,

    matchMethod:
      match?.best?.method
      ||
      null,

    matchScore:
      match?.best?.score
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
      match?.best?.method,
  });

  const number =
    match?.best?.practiceNumber
    ||
    match?.extractedNumbers?.[0];

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
    meta.data()?.version >= 1
  ) {
    return;
  }

  const batch =
    db.batch();

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


async function syncFolder({
  client,
  folderName,
  mailboxUser,
  bankCatalog,
  stateRef,
}) {
  let lock;

  try {
    lock =
      await client.getMailboxLock(
        folderName
      );
  }
  catch(error) {
    console.warn(
      `Cartella IMAP non disponibile: ${folderName}`,
      error?.message
      ||
      error
    );

    return {
      folderName,
      skipped:
        true,
      processed:
        0,
      matched:
        0,
    };
  }

  try {
    const stateSnap =
      await stateRef.get();

    const state =
      stateSnap.exists
        ? stateSnap.data()
        : {};

    const key =
      folderName
        .replace(/[^\w]+/g, "_")
        .toLowerCase();

    const lastUid =
      Number(
        state?.folders?.[key]?.lastUid
        ||
        0
      );

    /*
     * Al primo avvio leggiamo solo gli ultimi 100 messaggi:
     * il filtro sulla data creazione fascicolo impedisce
     * l'associazione di vecchie email.
     */
    let range;

    if (lastUid > 0) {
      range =
        `${lastUid + 1}:*`;
    }
    else {
      const exists =
        Number(
          client.mailbox?.exists
          ||
          0
        );

      const first =
        Math.max(
          1,
          exists -
          99
        );

      range =
        `${first}:*`;
    }

    let maxUid =
      lastUid;

    let processed =
      0;

    let matched =
      0;

    for await (
      const msg of client.fetch(
        range,
        {
          uid:
            true,
          source:
            true,
          envelope:
            true,
          internalDate:
            true,
        }
      )
    ) {
      if (!msg?.source) {
        continue;
      }

      processed++;

      maxUid =
        Math.max(
          maxUid,
          Number(msg.uid || 0)
        );

      let mail;

      try {
        mail =
          await simpleParser(
            msg.source
          );
      }
      catch(error) {
        console.error(
          "Errore parsing email UID",
          msg.uid,
          error
        );

        continue;
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
        !match.matched
        ||
        !match.best?.ref
      ) {
        /*
         * Conserviamo solo email che hanno almeno:
         * - dominio banca noto, oppure
         * - candidato pratica, oppure
         * - numero pratica rilevato.
         */
        if (
          bankDetection.verified
          ||
          match.candidates?.length
          ||
          match.extractedNumbers?.length
        ) {
          await saveUnmatched({
            mail,
            folderName,
            uid:
              msg.uid,
            bankDetection,
            match,
          });
        }

        continue;
      }

      const saved =
        await saveMatchedMail({
          practiceRef:
            match.best.ref,
          practiceId:
            match.best.id,
          folderName,
          uid:
            msg.uid,
          mail,
          mailboxUser,
          bankDetection,
          match,
        });

      if (saved) {
        matched++;
      }
    }

    if (
      maxUid >
      lastUid
    ) {
      await stateRef.set(
        {
          folders: {
            ...(state?.folders || {}),
            [key]: {
              lastUid:
                maxUid,

              aggiornatoIl:
                admin.firestore
                  .FieldValue
                  .serverTimestamp(),
            },
          },
        },
        {
          merge:
            true,
        }
      );
    }

    return {
      folderName,
      processed,
      matched,
      lastUid:
        maxUid,
    };
  }
  finally {
    lock.release();
  }
}


async function runMailSync() {
  await ensureBankSeed();

  const user =
    MAIL_GMAIL_USER.value();

  const password =
    MAIL_GMAIL_APP_PASSWORD.value();

  if (
    !user
    ||
    !password
  ) {
    throw new Error(
      "MAIL_GMAIL_USER / MAIL_GMAIL_APP_PASSWORD non configurati."
    );
  }

  const client =
    new ImapFlow({
      host:
        "imap.gmail.com",

      port:
        993,

      secure:
        true,

      auth: {
        user,
        pass:
          password
            .replace(/\s+/g, ""),
      },

      logger:
        false,
    });

  await client.connect();

  try {
    const catalog =
      await loadBankCatalog(
        db
      );

    const stateRef =
      db
        .collection(
          "system"
        )
        .doc(
          "mail_sync_state"
        );

    const results = [];

    results.push(
      await syncFolder({
        client,
        folderName:
          "INBOX",
        mailboxUser:
          user,
        bankCatalog:
          catalog,
        stateRef,
      })
    );

    /*
     * Gmail espone la cartella Sent con nome localizzato.
     * Cerchiamo il path via specialUse.
     */
    const folders =
      await client.list();

    const sent =
      folders.find(
        f =>
          String(f.specialUse || "")
            .toLowerCase() ===
          "\\sent"
      )
      ||
      folders.find(
        f =>
          /sent|inviat/i.test(
            f.path
          )
      );

    if (
      sent?.path
      &&
      sent.path !== "INBOX"
    ) {
      results.push(
        await syncFolder({
          client,
          folderName:
            sent.path,
          mailboxUser:
            user,
          bankCatalog:
            catalog,
          stateRef,
        })
      );
    }

    await stateRef.set(
      {
        ultimoSyncIl:
          admin.firestore
            .FieldValue
            .serverTimestamp(),

        ultimoSyncOk:
          true,

        ultimoErrore:
          null,
      },
      {
        merge:
          true,
      }
    );

    return {
      ok:
        true,
      user,
      results,
    };
  }
  catch(error) {
    await db
      .collection("system")
      .doc("mail_sync_state")
      .set(
        {
          ultimoSyncIl:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          ultimoSyncOk:
            false,

          ultimoErrore:
            String(
              error?.message
              ||
              error
            )
            .slice(0, 1500),
        },
        {
          merge:
            true,
        }
      );

    throw error;
  }
  finally {
    await client.logout()
      .catch(() => {});
  }
}


const sincronizzaEmailPratiche =
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
        MAIL_GMAIL_USER,
        MAIL_GMAIL_APP_PASSWORD,
      ],
    },

    async () => {
      const result =
        await runMailSync();

      console.log(
        "Mail Engine sync:",
        JSON.stringify(
          result
        )
      );
    }
  );


const sincronizzaEmailPraticheManuale =
  onCall(
    {
      region:
        "us-central1",

      memory:
        "1GiB",

      timeoutSeconds:
        540,

      secrets: [
        MAIL_GMAIL_USER,
        MAIL_GMAIL_APP_PASSWORD,
      ],
    },

    async request => {
      if (!request.auth?.uid) {
        throw new HttpsError(
          "unauthenticated",
          "Accesso richiesto."
        );
      }

      const result =
        await runMailSync();

      return result;
    }
  );


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

      const adminOk =
        await isAdminUser(
          request.auth.uid
        );

      if (!adminOk) {
        throw new HttpsError(
          "permission-denied",
          "Solo un amministratore può confermare domini banca."
        );
      }

      const domain =
        String(
          request.data?.dominio
          ||
          ""
        )
        .trim()
        .toLowerCase();

      const bancaKey =
        String(
          request.data?.bancaKey
          ||
          ""
        )
        .trim();

      const bancaNome =
        String(
          request.data?.bancaNome
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
          "Dominio, bancaKey e bancaNome sono obbligatori."
        );
      }

      const bankRef =
        db
          .collection("mail_banche")
          .doc(bancaKey);

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
            Array.isArray(data?.domini)
              ? data.domini
              : [];

          const domains =
            Array.from(
              new Set([
                ...current
                  .map(x =>
                    String(x).toLowerCase()
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
                  .replace(/[^\w.-]+/g, "_")
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
          request.data?.emailId
          ||
          ""
        )
        .trim();

      const practiceId =
        String(
          request.data?.practiceId
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
          .doc(emailId);

      const pending =
        await pendingRef.get();

      if (!pending.exists) {
        throw new HttpsError(
          "not-found",
          "Email da associare non trovata."
        );
      }

      /*
       * Questa funzione registra l'associazione manuale e, se nella mail
       * era stato rilevato un numero pratica, lo memorizza sul fascicolo.
       * Il messaggio completo verrà poi acquisito al sync successivo.
       */
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
          data.numeriPraticaRilevati
        )
          ? data.numeriPraticaRilevati[0]
          : null;

      if (number) {
        await rememberPracticeNumber({
          db,
          practiceRef,
          number,
          bankDetection: {
            verified:
              data.dominioVerificato ===
              true,
            domain:
              data.dominio
              ||
              "",
            bank: data.bancaSuggerita
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
  sincronizzaEmailPratiche,
  sincronizzaEmailPraticheManuale,
  confermaDominioBanca,
  associaEmailAPratica,
};
