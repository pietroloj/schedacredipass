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
  GMAIL_TOKEN_ENCRYPTION_KEY,
  encryptRefreshToken,
  decryptRefreshToken,
} = require("./gmail-token-crypto");

const {
  emailDomain,
  loadBankCatalog,
  detectBank,
  findPracticeMatch,
  rememberPracticeNumber,
  extractPracticeNumbers,
  normalizePracticeNumber
} = require("./mail-matcher");


if (!admin.apps.length) {
  admin.initializeApp();
}


const db =
  admin.firestore();

const storage =
  admin.storage();



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
  consultantUid,
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

        consultantUid:
          consultantUid || null,

        consultantUid:
          consultantUid
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



function normalizeMessageId(value = "") {
  return String(value || "").trim().replace(/^<|>$/g, "").toLowerCase();
}

function mailReferenceIds(mail) {
  const values = [];
  if (mail.inReplyTo) values.push(mail.inReplyTo);
  if (Array.isArray(mail.references)) values.push(...mail.references);
  else if (mail.references) values.push(mail.references);

  return [...new Set(
    values
      .flatMap(v => String(v || "").split(/\s+/))
      .map(normalizeMessageId)
      .filter(Boolean)
  )];
}


async function findPracticeByKnownNumber({ mail, consultantUid }) {
  const text = [
    mail.subject || "",
    mail.text || "",
  ].join("\n");

  const incomingNumbers =
    extractPracticeNumbers(text)
      .map(normalizePracticeNumber)
      .filter(Boolean);

  if (!incomingNumbers.length) return null;

  const practices =
    await db.collection("pratiche_mutuo").get();

  for (const practiceDoc of practices.docs) {
    const data = practiceDoc.data() || {};
    const owner = String(
      data.consulente_uid
      || data.workspace_uid
      || data.owner_uid
      || data.assegnato_a_uid
      || ""
    ).trim();

    if (consultantUid && owner && owner !== consultantUid) continue;

    const known = new Set(
      [
        ...(Array.isArray(data.mail_matching?.numeri_pratica)
          ? data.mail_matching.numeri_pratica
          : []),
        ...(Array.isArray(data.numeri_pratica_banca)
          ? data.numeri_pratica_banca
          : []),
        data.numero_pratica_banca,
        data.numeroPraticaBanca,
        data.mail_matching?.numero_pratica,
      ]
        .map(normalizePracticeNumber)
        .filter(Boolean)
    );

    /*
     * Se il numero non è ancora stato memorizzato nel fascicolo,
     * impariamo anche dalle email già correttamente associate.
     */
    const timeline =
      await practiceDoc.ref
        .collection("email_timeline")
        .limit(150)
        .get();

    for (const emailDoc of timeline.docs) {
      const ed = emailDoc.data() || {};
      const values = [
        ed.numeroPraticaRilevato,
        ...extractPracticeNumbers(
          `${ed.oggetto || ""}\n${ed.testo || ""}`
        ),
      ];

      for (const value of values) {
        const n = normalizePracticeNumber(value);
        if (n) known.add(n);
      }
    }

    const hit =
      incomingNumbers.find(n => known.has(n));

    if (hit) {
      await rememberPracticeNumber({
        db,
        practiceRef: practiceDoc.ref,
        number: hit,
        bankDetection: null,
      });

      return {
        matched: true,
        best: {
          id: practiceDoc.id,
          ref: practiceDoc.ref,
          data,
          score: 2000,
          method: "known_practice_number",
          practiceNumber: hit,
        },
        candidates: [],
        extractedNumbers: incomingNumbers,
      };
    }
  }

  return null;
}


async function findPracticeByMailThread({ mail, consultantUid }) {
  const refs = mailReferenceIds(mail);
  if (!refs.length) return null;

  const practices = await db.collection("pratiche_mutuo").get();

  for (const practiceDoc of practices.docs) {
    const data = practiceDoc.data() || {};
    const owner = String(
      data.consulente_uid
      || data.workspace_uid
      || data.owner_uid
      || data.assegnato_a_uid
      || ""
    ).trim();

    if (consultantUid && owner && owner !== consultantUid) continue;

    const timeline = await practiceDoc.ref
      .collection("email_timeline")
      .limit(100)
      .get();

    for (const emailDoc of timeline.docs) {
      const messageId = normalizeMessageId(emailDoc.data()?.messageId);
      if (messageId && refs.includes(messageId)) {
        return {
          matched: true,
          best: {
            id: practiceDoc.id,
            ref: practiceDoc.ref,
            data,
            score: 200,
            method: "thread_reply",
            practiceNumber: "",
          },
          candidates: [],
          extractedNumbers: [],
        };
      }
    }
  }
  return null;
}


async function syncFolder({
  client,
  folderName,
  mailboxUser,
  bankCatalog,
  stateRef,
  consultantUid,
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

    /*
     * Diagnostica locale alla singola cartella IMAP.
     * Deve essere inizializzata dentro syncFolder, prima del ciclo fetch.
     */
    const messageDiagnostics =
      [];

    const fetchOptions =
      lastUid > 0
        ? { uid: true }
        : {};

    for await (
      const msg of client.fetch(
        range,
        {
          uid: true,
          source: true,
          envelope: true,
          internalDate: true,
        },
        fetchOptions
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

      /*
       * Priorità:
       * 1) numero pratica già noto / imparato dalle email associate;
       * 2) thread In-Reply-To / References;
       * 3) matcher tradizionale.
       */
      const numberMatch =
        await findPracticeByKnownNumber({
          mail,
          consultantUid,
        });

      const threadMatch =
        numberMatch
          ? null
          : await findPracticeByMailThread({
              mail,
              consultantUid,
            });

      const match =
        numberMatch
        ||
        threadMatch
        ||
        await findPracticeMatch({
          db,
          mail,
          bankDetection,
          ownerUid:
            consultantUid,
        });

      const direction =
        emailDirection(
          mail,
          mailboxUser,
          folderName
        );

      const diagnosticNumbers =
        extractPracticeNumbers(
          `${mail.subject || ""}\n${mail.text || ""}`
        );

      messageDiagnostics.push({
        uid: msg.uid,
        direction,
        subject: String(mail.subject || "").slice(0, 300),
        from: safeArrayAddress(mail.from).slice(0, 5),
        inReplyTo: mail.inReplyTo || null,
        references: mailReferenceIds(mail).slice(0, 10),
        extractedNumbers:
          diagnosticNumbers,
        matched: !!match?.matched,
        practiceId: match?.best?.id || null,
        method: match?.best?.method || null,
        score: Number(match?.best?.score || 0),
        reason: match?.matched
          ? "associata"
          : (
              diagnosticNumbers.length
                ? "numero rilevato ma nessun fascicolo corrispondente"
                : (
                    match?.best
                      ? "candidato sotto soglia"
                      : "nessuna pratica candidata"
                  )
            ),
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
          consultantUid,
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
    diagnostics: messageDiagnostics.slice(-50),
  };
  }
  finally {
    lock.release();
  }
}


function imapCredentialPayload(connection = {}) {
  return {
    refreshTokenEncrypted:
      connection.imapPasswordEncrypted,
    refreshTokenIv:
      connection.imapPasswordIv,
    refreshTokenTag:
      connection.imapPasswordTag,
    refreshTokenEncryption:
      connection.imapPasswordEncryption,
  };
}


async function requireActiveConsultant(uid) {
  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "Accesso richiesto."
    );
  }

  const snap =
    await db.collection("consulenti").doc(uid).get();

  if (!snap.exists || snap.data()?.attivo === false) {
    throw new HttpsError(
      "permission-denied",
      "Profilo consulente non attivo."
    );
  }

  return snap.data() || {};
}


async function runMailSyncForConsultant(consultantUid) {
  await ensureBankSeed();

  const connectionRef =
    db.collection("gmail_connections").doc(consultantUid);

  const connectionSnap =
    await connectionRef.get();

  if (!connectionSnap.exists) {
    throw new Error(
      "Casella Gmail non configurata per questo consulente."
    );
  }

  const connection =
    connectionSnap.data() || {};

  if (
    connection.connected !== true
    ||
    connection.provider !== "imap_app_password"
  ) {
    throw new Error(
      "Il consulente non utilizza il collegamento IMAP con Password per le app."
    );
  }

  const user =
    String(connection.email || "")
      .trim()
      .toLowerCase();

  const password =
    decryptRefreshToken(
      imapCredentialPayload(connection)
    ).token;

  if (!user || !password) {
    throw new Error(
      "Credenziali IMAP personali non disponibili."
    );
  }

  const client =
    new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: {
        user,
        pass: String(password).replace(/\s+/g, ""),
      },
      logger: false,
    });

  await client.connect();

  try {
    const catalog =
      await loadBankCatalog(db);

    const stateRef =
      connectionRef
        .collection("sync")
        .doc("imap");

    const results = [];

    results.push(
      await syncFolder({
        client,
        folderName: "INBOX",
        mailboxUser: user,
        bankCatalog: catalog,
        stateRef,
        consultantUid,
      })
    );

    const folders =
      await client.list();

    const sent =
      folders.find(
        f =>
          String(f.specialUse || "")
            .toLowerCase() === "\\sent"
      )
      ||
      folders.find(
        f => /sent|inviat/i.test(f.path)
      );

    if (sent?.path && sent.path !== "INBOX") {
      results.push(
        await syncFolder({
          client,
          folderName: sent.path,
          mailboxUser: user,
          bankCatalog: catalog,
          stateRef,
          consultantUid,
        })
      );
    }

    const processed =
      results.reduce(
        (sum, x) => sum + Number(x.processed || 0),
        0
      );

    const matched =
      results.reduce(
        (sum, x) => sum + Number(x.matched || 0),
        0
      );

    await connectionRef.set(
      {
        lastSyncAt:
          admin.firestore.FieldValue.serverTimestamp(),
        lastSyncOk: true,
        lastError: null,
        oauthLastError: null,
        reconnectRequired: false,
      },
      { merge: true }
    );

    return {
      ok: true,
      provider: "imap_app_password",
      email: user,
      processed,
      matched,
      results,
    };
  }
  catch(error) {
    await connectionRef.set(
      {
        lastSyncAt:
          admin.firestore.FieldValue.serverTimestamp(),
        lastSyncOk: false,
        lastError:
          String(error?.message || error)
            .slice(0, 1500),
      },
      { merge: true }
    );

    throw error;
  }
  finally {
    await client.logout().catch(() => {});
  }
}


const collegaGmailConAppPassword =
  onCall(
    {
      region: "us-central1",
      secrets: [
        GMAIL_TOKEN_ENCRYPTION_KEY,
      ],
      timeoutSeconds: 60,
      memory: "256MiB",
    },

    async request => {
      const uid =
        request.auth?.uid;

      const consultant =
        await requireActiveConsultant(uid);

      const email =
        String(
          request.data?.email
          ||
          consultant.email
          ||
          request.auth?.token?.email
          ||
          ""
        )
          .trim()
          .toLowerCase();

      const appPassword =
        String(
          request.data?.appPassword
          ||
          ""
        )
          .replace(/\s+/g, "");

      if (!email || !email.includes("@")) {
        throw new HttpsError(
          "invalid-argument",
          "Indirizzo Gmail non valido."
        );
      }

      if (appPassword.length < 12) {
        throw new HttpsError(
          "invalid-argument",
          "Password per le app non valida."
        );
      }

      /*
       * Verifica reale prima di salvare.
       */
      const testClient =
        new ImapFlow({
          host: "imap.gmail.com",
          port: 993,
          secure: true,
          auth: {
            user: email,
            pass: appPassword,
          },
          logger: false,
        });

      try {
        await testClient.connect();
        await testClient.logout();
      }
      catch(error) {
        throw new HttpsError(
          "failed-precondition",
          "Google ha rifiutato il collegamento IMAP. Verifica indirizzo e Password per le app."
        );
      }

      const encrypted =
        encryptRefreshToken(appPassword);

      await db
        .collection("gmail_connections")
        .doc(uid)
        .set(
          {
            uid,
            provider: "imap_app_password",
            connected: true,
            email,

            imapPasswordEncrypted:
              encrypted.refreshTokenEncrypted,
            imapPasswordIv:
              encrypted.refreshTokenIv,
            imapPasswordTag:
              encrypted.refreshTokenTag,
            imapPasswordEncryption:
              encrypted.refreshTokenEncryption,

            /*
             * Se si passa da OAuth a IMAP, i vecchi token
             * non restano utilizzabili.
             */
            refreshTokenEncrypted:
              admin.firestore.FieldValue.delete(),
            refreshTokenIv:
              admin.firestore.FieldValue.delete(),
            refreshTokenTag:
              admin.firestore.FieldValue.delete(),
            refreshTokenEncryption:
              admin.firestore.FieldValue.delete(),

            scope: "imap.readonly-like",
            reconnectRequired: false,
            lastError: null,
            connectedAt:
              admin.firestore.FieldValue.serverTimestamp(),
            updatedAt:
              admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      await db
        .collection("consulenti")
        .doc(uid)
        .set(
          {
            gmailCollegata: true,
            gmailEmail: email,
            gmailProvider: "imap_app_password",
          },
          { merge: true }
        );

      return {
        ok: true,
        connected: true,
        provider: "imap_app_password",
        email,
      };
    }
  );


const sincronizzaGmailImapPersonale =
  onCall(
    {
      region: "us-central1",
      secrets: [
        GMAIL_TOKEN_ENCRYPTION_KEY,
      ],
      timeoutSeconds: 540,
      memory: "1GiB",
    },

    async request => {
      const uid =
        request.auth?.uid;

      await requireActiveConsultant(uid);

      try {
        return await runMailSyncForConsultant(uid);
      }
      catch(error) {
        throw new HttpsError(
          "internal",
          String(error?.message || error)
        );
      }
    }
  );


const sincronizzaGmailImapTutti =
  onSchedule(
    {
      schedule: "every 10 minutes",
      timeZone: "Europe/Rome",
      region: "us-central1",
      timeoutSeconds: 540,
      memory: "1GiB",
      secrets: [
        GMAIL_TOKEN_ENCRYPTION_KEY,
      ],
    },

    async () => {
      const snap =
        await db
          .collection("gmail_connections")
          .where("connected", "==", true)
          .where("provider", "==", "imap_app_password")
          .get();

      for (const doc of snap.docs) {
        try {
          await runMailSyncForConsultant(doc.id);
        }
        catch(error) {
          console.error(
            "Sync IMAP consulente fallita:",
            doc.id,
            error
          );
        }
      }
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



async function canReadTimelinePractice(uid, practice = {}) {
  const profileSnap = await db.collection("consulenti").doc(uid).get();
  if (!profileSnap.exists) return false;
  const profile = profileSnap.data() || {};
  const role = String(profile.ruolo || "").trim().toLowerCase();
  if (role === "admin") return true;

  const ownerUid = String(
    practice.consulente_uid || practice.workspace_uid || practice.owner_uid || ""
  ).trim();
  if (!ownerUid) return false;
  if (ownerUid === uid) return true;

  const visible = Array.isArray(profile.collaboratori_visibili)
    ? profile.collaboratori_visibili.map(x => String(x || "").trim())
    : [];

  if (visible.includes(ownerUid)) return true;

  if (role === "responsabile" || role === "segreteria") {
    const ownerSnap = await db.collection("consulenti").doc(ownerUid).get();
    if (!ownerSnap.exists) return false;
    const managerUid = String(ownerSnap.data()?.responsabile_uid || "").trim();
    return !!managerUid && visible.includes(managerUid);
  }
  return false;
}

function serializeTimelineEmail(doc) {
  const d = doc.data() || {};
  return {
    id: doc.id,
    ...d,
    data: d.data?.toDate ? d.data.toDate().toISOString() : (d.data || null),
    createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : (d.createdAt || null),
    updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : (d.updatedAt || null),
  };
}

const leggiEmailTimeline =
  onCall(
    { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
    async request => {
      const uid = request.auth?.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Accesso richiesto.");

      const practiceId = String(request.data?.practiceId || "").trim();
      const emailDocId = String(request.data?.emailDocId || "").trim();

      if (!practiceId) {
        throw new HttpsError("invalid-argument", "Pratica non specificata.");
      }

      const practiceRef = db.collection("pratiche_mutuo").doc(practiceId);
      const practiceSnap = await practiceRef.get();
      if (!practiceSnap.exists) throw new HttpsError("not-found", "Pratica non trovata.");

      if (!(await canReadTimelinePractice(uid, practiceSnap.data() || {}))) {
        throw new HttpsError("permission-denied", "Non puoi visualizzare le email di questa pratica.");
      }

      let selected = null;
      if (emailDocId) {
        const emailSnap = await practiceRef.collection("email_timeline").doc(emailDocId).get();
        if (!emailSnap.exists) throw new HttpsError("not-found", "Email non trovata.");
        selected = serializeTimelineEmail(emailSnap);
      }

      const threadSnap = await practiceRef
        .collection("email_timeline")
        .orderBy("data", "asc")
        .limit(50)
        .get();

      return {
        ok: true,
        practice: {
          id: practiceSnap.id,
          ...(practiceSnap.data() || {}),
        },
        email: selected,
        thread: threadSnap.docs.map(serializeTimelineEmail),
      };
    }
  );



const gestisciNumeroPraticaBanca =
  onCall(
    { region: "us-central1" },
    async request => {
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "Accesso richiesto.");
      }

      const practiceId =
        String(request.data?.practiceId || "").trim();
      const action =
        String(request.data?.action || "add").trim().toLowerCase();
      const number =
        normalizePracticeNumber(request.data?.number || "");

      if (!practiceId || !number) {
        throw new HttpsError(
          "invalid-argument",
          "Pratica e numero pratica sono obbligatori."
        );
      }

      const ref =
        db.collection("pratiche_mutuo").doc(practiceId);
      const snap = await ref.get();

      if (!snap.exists) {
        throw new HttpsError("not-found", "Pratica non trovata.");
      }

      if (!(await canReadTimelinePractice(uid, snap.data() || {}))) {
        throw new HttpsError(
          "permission-denied",
          "Non puoi modificare questo fascicolo."
        );
      }

      const data = snap.data() || {};
      const current =
        Array.isArray(data.mail_matching?.numeri_pratica)
          ? data.mail_matching.numeri_pratica
              .map(normalizePracticeNumber)
              .filter(Boolean)
          : [];

      let numbers =
        [...new Set(current)];

      if (action === "remove") {
        numbers =
          numbers.filter(x => x !== number);
      }
      else {
        if (!numbers.includes(number)) {
          numbers.push(number);
        }
      }

      await ref.set(
        {
          mail_matching: {
            ...(data.mail_matching || {}),
            numeri_pratica: numbers,
            numero_pratica:
              numbers.length
                ? numbers[numbers.length - 1]
                : null,
            aggiornatoIl:
              admin.firestore.FieldValue.serverTimestamp(),
          },
          numeri_pratica_banca: numbers,
        },
        { merge: true }
      );

      /*
       * Se aggiungiamo un nuovo numero pratica, una ricevuta che era già
       * stata letta da INBOX in una sincronizzazione precedente non verrebbe
       * più riesaminata perché il cursore UID è già avanzato.
       *
       * Reset solo di INBOX: al prossimo "Sincronizza ora" vengono
       * riesaminate le ultime email ricevute. saveMatchedMail è idempotente,
       * quindi le email già presenti non vengono duplicate.
       */
      if (action !== "remove") {
        const imapStateRef =
          db.collection("gmail_connections")
            .doc(uid)
            .collection("sync")
            .doc("imap");

        await imapStateRef.set(
          {
            "folders.INBOX.lastUid": 0,
            "folders.INBOX.aggiornatoIl":
              admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      return {
        ok: true,
        numbers,
        inboxWillBeReprocessed:
          action !== "remove",
      };
    }
  );


module.exports = {
  gestisciNumeroPraticaBanca,
  leggiEmailTimeline,
  collegaGmailConAppPassword,
  sincronizzaGmailImapPersonale,
  sincronizzaGmailImapTutti,
  confermaDominioBanca,
  associaEmailAPratica,
};
