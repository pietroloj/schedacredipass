const {bankName}=require("./mail-bank-names");
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

  const visibleHtml=mail.html ? htmlToPlain(mail.html) : "";
  // Some banks send a minimal plain-text alternative and the actual request in HTML.
  if(visibleHtml.length>text.length*1.2)return visibleHtml.slice(0,50000);
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

    try {
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

    } catch(error) {
      saved.push({nome:safeName,contentType:att.contentType||"",size:att.size||0,downloadError:String(error.message||error).slice(0,300)});
      continue;
    }
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
      contentId: att.cid || String(att.contentId||"").replace(/^<|>$/g,""),
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
          (match?.extractedNumbers || [])
          ||
          [],

        candidati:
          (
            (match?.candidates || [])
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
  consultantUid,
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

  await learnPracticeNumberAfterNameMatch({practiceRef,practiceData:match.best.data||{},subject:mail.subject,method:match.best.method});
  const attachments =
    await saveAttachments({
      practiceId,
      emailDocId,
      mail,
    });

  if (existing.exists) {
    // Backfill repairs existing messages too, without resetting analysis/handled state.
    await emailRef.set({html: String(mail.html || "").slice(0,600000), testo:cleanBody(mail),bodyVersion:3,allegati:attachments}, {merge:true});
    await learnPracticeNumberAfterNameMatch({practiceRef,practiceData:match.best.data||{},subject:mail.subject,method:match.best.method});
    return false;
  }

  const direction =
    emailDirection(
      mail,
      mailboxUser,
      folderName
    );

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
    consultantUid: consultantUid || null,
    casella: mailboxUser,
    bodyVersion: 3,
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

    html: String(mail.html || "").slice(0,600000),
    autoAssociata: true,
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
      (match?.extractedNumbers || [])?.[0]
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
    (match?.extractedNumbers || [])?.[0];

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
    if(Number(meta.data()?.version||0)<2){
      await db.collection("mail_banche").doc("ing").set({bancaKey:"ing",bancaNome:"ING",domini:admin.firestore.FieldValue.arrayUnion("ing.it","ing.com","ingdirect.it")},{merge:true});
      await metaRef.set({version:2},{merge:true});
    }
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
        2,

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



const {strictSubject, trustedNumbers, extractLabeledPracticeNumbersFromSubject, excludedSender} = require("./mail-policy");

async function learnPracticeNumberAfterNameMatch({practiceRef,practiceData,subject,method}) {
  if(method!=="subject_full_name"&&method!=="subject_surname_initial")return [];
  const learned=extractLabeledPracticeNumbersFromSubject(subject);
  if(!learned.length)return [];
  // Atomic union preserves concurrent learning and never overwrites manual identifiers.
  await practiceRef.set({mail_matching:{
    numeri_pratica_appresi: admin.firestore.FieldValue.arrayUnion(...learned),
    numero_pratica_auto: learned[learned.length-1],
    numero_pratica_auto_metodo: method,
    numero_pratica_auto_aggiornatoIl: admin.firestore.FieldValue.serverTimestamp(),
  }},{merge:true});
  return learned;
}

async function findPracticeByStrictSubject({mail,consultantUid}) {
  if(excludedSender(mail.from)) return null;
  const subject=String(mail.subject||""); if(!subject.trim())return null;
  const snap=await db.collection("pratiche_mutuo").get(), matches=[];
  for(const doc of snap.docs){
    const data=doc.data()||{};
    const owner=String(data.consulente_uid||data.workspace_uid||data.owner_uid||data.assegnato_a_uid||"").trim();
    if(consultantUid&&owner!==consultantUid)continue;
    const r=strictSubject(subject,data);
    if(r.matched)matches.push({id:doc.id,ref:doc.ref,data,...r});
  }
  if(!matches.length)return null;
  matches.sort((x,y)=>y.score-x.score);
  if(matches.length>1&&matches[0].score===matches[1].score)
    return {matched:false,best:null,candidates:matches.slice(0,5),extractedNumbers:[],reason:"corrispondenza oggetto ambigua"};
  return {matched:true,best:matches[0],candidates:matches.slice(1,5),
    extractedNumbers:matches[0].practiceNumber?[matches[0].practiceNumber]:[]};
}
async function cleanupPracticeTimeline({consultantUid,practiceId}) {
  if(!practiceId)return 0;
  const ref=db.collection("pratiche_mutuo").doc(practiceId);
  const doc=await ref.get();
  if(!doc.exists)return 0;
  if(!(await canReadTimelinePractice(consultantUid,doc.data())))
    throw new HttpsError("permission-denied","Non puoi ripulire questa pratica.");
  const practices=await db.collection("pratiche_mutuo").get();
  const candidates=practices.docs.filter(x=>{
    const d=x.data(); const owner=d.consulente_uid||d.workspace_uid||d.owner_uid||d.assegnato_a_uid;
    const target=doc.data(); return owner===(target.consulente_uid||target.workspace_uid||target.owner_uid||target.assegnato_a_uid);
  });
  function valid(subject,from) {
    if(excludedSender(from))return false;
    const matches=candidates.map(x=>({id:x.id,...strictSubject(subject,x.data())})).filter(x=>x.matched).sort((a,b)=>b.score-a.score);
    return matches[0]?.id===practiceId && (!matches[1] || matches[0].score>matches[1].score);
  }
  const tl=await ref.collection("email_timeline").get();
  const removedIds=new Set(), validIds=new Set();
  for(const e of tl.docs){
    const d=e.data();
    if(d.autoAssociata===false || d.matchMethod==="manual" || valid(d.oggetto||d.subject,d.mittente||d.from)) validIds.add(e.id);
    else removedIds.add(e.id);
  }
  // Remove both materialized representations; never issue any Gmail deletion.
  for(const id of removedIds) await ref.collection("email_timeline").doc(id).delete();
  let orphanCount=0;
  await db.runTransaction(async tx=>{
    const fresh=await tx.get(ref); const entries=fresh.data()?.attivita_interne||[];
    const kept=entries.filter(e=>{
      const id=e.meta?.email_doc_id || (String(e.id||"").startsWith("email_")?e.id.slice(6):"");
      if(!id)return true;
      if(removedIds.has(id))return false;
      if(validIds.has(id))return true;
      return valid(e.descrizione,e.autore);
    });
    orphanCount=entries.length-kept.length;
    tx.set(ref,{attivita_interne:kept},{merge:true});
  });
  return Math.max(removedIds.size,orphanCount);
}


async function syncFolder({
  client,
  folderName,
  mailboxUser,
  bankCatalog,
  stateRef,
  consultantUid,
  forceRecent = false,
  backfillPage = 0,
}) {
  let lock;

  try {
    lock =
      await client.getMailboxLock(
        folderName, {readOnly:true}
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

    const exists =
      Number(
        client.mailbox?.exists
        ||
        0
      );

    /*
     * Sincronizzazione manuale: backfill reale delle ultime 250 email
     * usando i sequence number IMAP, indipendentemente dal cursore UID.
     * La schedulata continua invece a usare il cursore incrementale.
     */
    if (!exists || (forceRecent && exists <= Number(backfillPage)*50))
      return {folderName,processed:0,matched:0,backfill:forceRecent,backfillPage,diagnostics:[]};
    if (forceRecent) {
      const page =
        Math.max(0, Math.min(4, Number(backfillPage || 0)));

      const end =
        Math.max(1, exists - (page * 50));

      const first =
        Math.max(1, end - 49);

      range =
        `${first}:${end}`;
    }
    else if (lastUid <= 0) {
      const first =
        Math.max(1, exists - 99);

      range =
        `${first}:*`;
    }
    else {
      range =
        `${lastUid + 1}:*`;
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
      (!forceRecent && lastUid > 0)
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
            msg.source, {skipImageLinks:true}
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

      if (excludedSender(mail.from)) {
        messageDiagnostics.push({subject:mail.subject,from:safeArrayAddress(mail.from),matched:false,reason:"mittente escluso"});
        continue;
      }
      const bankDetection =
        detectBank(
          bankCatalog,
          mail
        );

      const rawMatch =
        await findPracticeByStrictSubject({
          mail,
          consultantUid,
        });

      /*
       * Il matcher restrittivo può non trovare nulla.
       * Da qui in avanti usiamo SEMPRE un oggetto stabile, così nessun
       * ramo legacy può più leggere proprietà da null.
       */
      const match =
        rawMatch || {
          matched: false,
          best: null,
          candidates: [],
          extractedNumbers: [],
          reason:
            "oggetto senza numero pratica o nominativo compatibile",
        };

      const direction =
        emailDirection(
          mail,
          mailboxUser,
          folderName
        );

      const diagnosticNumbers =
        extractLabeledPracticeNumbersFromSubject(mail.subject || "");

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
        !match?.matched
        ||
        !match?.best?.ref
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
          (match?.candidates || [])?.length
          ||
          (match.extractedNumbers || [])?.length
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
            match?.best.ref,
          practiceId:
            match?.best.id,
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
        const learnedPracticeNumbers =
          await learnPracticeNumberAfterNameMatch({
            practiceRef: match.best.ref,
            practiceData: match.best.data || {},
            subject: mail.subject || "",
            method: match.best.method,
          });

        if (learnedPracticeNumbers.length) {
          match.extractedNumbers =
            [...new Set([
              ...(match.extractedNumbers || []),
              ...learnedPracticeNumbers,
            ])];
        }

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
      backfill:
        forceRecent === true,
      backfillPage:
        forceRecent ? Number(backfillPage || 0) : null,
      mailboxExists:
        exists,
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


async function runMailSyncForConsultant(
  consultantUid,
  { manualBackfill = false, backfillPage = 0 } = {}
) {
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
        forceRecent: manualBackfill,
        backfillPage,
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
        const backfillPage =
        Math.max(0, Math.min(4, Number(request.data?.backfillPage || 0)));

      const practiceId =
        String(request.data?.practiceId || "").trim();

      const removedWrongAssociations =
        backfillPage === 0
          ? await cleanupPracticeTimeline({
              consultantUid: uid,
              practiceId,
            })
          : 0;

      const syncResult =
        await runMailSyncForConsultant(
        uid,
        { manualBackfill: true, backfillPage }
      );

      return {
        ...syncResult,
        removedWrongAssociations,
      };
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
  if (profile.attivo === false) return false;
  if (role === "admin") return true;

  const ownerUid = String(
    practice.consulente_uid || practice.workspace_uid || practice.owner_uid || practice.assegnato_a_uid || ""
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

async function repairStoredNumbers(practiceId, practice) {
  const owner=practice.consulente_uid||practice.workspace_uid||practice.owner_uid||practice.assegnato_a_uid;
  const all=await db.collection("pratiche_mutuo").get();
  const candidates=all.docs.filter(x=>{const d=x.data();return (d.consulente_uid||d.workspace_uid||d.owner_uid||d.assegnato_a_uid)===owner;});
  const emails=await db.collection("pratiche_mutuo").doc(practiceId).collection("email_timeline").get();
  const learned=new Set();
  for(const email of emails.docs){
    const d=email.data();if(excludedSender(d.mittente||d.from))continue;
    const matches=candidates.map(x=>({id:x.id,...strictSubject(d.oggetto||d.subject,x.data())})).filter(x=>x.matched).sort((a,b)=>b.score-a.score);
    if(matches[0]?.id!==practiceId || (matches[1]&&matches[0].score===matches[1].score))continue;
    // Require a name match even when the same subject also contains a known number.
    const nameOnly={...practice,mail_matching:{},numeri_pratica_banca_manual:[],numero_pratica_banca:null,numeroPraticaBanca:null};
    if(!strictSubject(d.oggetto||d.subject,nameOnly).matched)continue;
    for(const n of extractLabeledPracticeNumbersFromSubject(d.oggetto||d.subject))learned.add(n);
  }
  if(learned.size)await db.collection("pratiche_mutuo").doc(practiceId).set({mail_matching:{numeri_pratica_appresi:admin.firestore.FieldValue.arrayUnion(...learned)}},{merge:true});
  return [...learned];
}
const riparaNumeriPraticaDaEmail=onCall({region:"us-central1",timeoutSeconds:120},async request=>{
 const uid=request.auth?.uid,id=String(request.data?.practiceId||"");
 if(!uid)throw new HttpsError("unauthenticated","Accesso richiesto.");
 if(!id)throw new HttpsError("invalid-argument","Pratica mancante.");
 const snap=await db.collection("pratiche_mutuo").doc(id).get();
 if(!snap.exists||!(await canReadTimelinePractice(uid,snap.data())))throw new HttpsError("permission-denied","Pratica non accessibile.");
 return {ok:true,learned:await repairStoredNumbers(id,snap.data())};
});

async function hydrateOriginalEmail(practiceId,emailDocId,data,practice) {
 const owner=data.consultantUid||practice.consulente_uid||practice.workspace_uid||practice.owner_uid||practice.assegnato_a_uid;
 const connectionSnap=await db.collection("gmail_connections").doc(owner).get();
 const connection=connectionSnap.data()||{};
 if(connection.provider!=="imap_app_password"||!connection.connected)throw new Error("Collegamento IMAP del titolare non disponibile per recuperare l'originale.");
 const user=String(connection.email||"");
 const password=decryptRefreshToken(imapCredentialPayload(connection)).token;
 const client=new ImapFlow({host:"imap.gmail.com",port:993,secure:true,auth:{user,pass:String(password).replace(/\s+/g,"")},connectionTimeout:20000,greetingTimeout:15000,socketTimeout:60000,logger:false});
 await client.connect();let lock;
 try{
   lock=await client.getMailboxLock(data.folder||"INBOX",{readOnly:true});
   let message=data.uid?await client.fetchOne(Number(data.uid),{source:true},{uid:true}):null;
   let mail=message?.source?await simpleParser(message.source,{skipImageLinks:true}):null;
   if(!mail || normalizeMessageId(mail.messageId)!==normalizeMessageId(data.messageId)){
     if(!data.messageId)throw new Error("Identificativo originale Gmail mancante.");
     const ids=await client.search({header:{"message-id":data.messageId}},{uid:true});
     if(!ids?.length)throw new Error("Originale non trovato nella cartella Gmail: potrebbe essere stato spostato.");
     message=await client.fetchOne(ids[0],{source:true},{uid:true});
     mail=await simpleParser(message.source,{skipImageLinks:true});
   }
   if(normalizeMessageId(mail.messageId)!==normalizeMessageId(data.messageId))throw new Error("L'originale non corrisponde alla mail selezionata.");
   let attachments=data.allegati||[],attachmentError=null;
   try{attachments=await saveAttachments({practiceId,emailDocId,mail});}catch(e){attachmentError="Allegati non recuperati: "+e.message;}
   const update={html:String(mail.html||"").slice(0,600000),testo:cleanBody(mail),bodyVersion:3,allegati:attachments,attachmentError};
   await db.collection("pratiche_mutuo").doc(practiceId).collection("email_timeline").doc(emailDocId).set({...update,aiAnalysis:admin.firestore.FieldValue.delete()},{merge:true});
   return {...data,...update,aiAnalysis:null};
 }finally{lock?.release();await client.logout().catch(()=>{});}
}
async function emailForDisplay(data,practice){
 const result={...data,banca:bankName(data,practice)||null};
 result.allegati=await Promise.all((data.allegati||[]).map(async a=>{
   if(!a.storagePath)return a;
   try{const [url]=await storage.bucket().file(a.storagePath).getSignedUrl({action:"read",expires:Date.now()+3600000});return {...a,url};}
   catch(_){return a;}
 }));
 return result;
}

const leggiEmailTimeline =
  onCall(
    { region: "us-central1", timeoutSeconds: 120, memory: "1GiB", secrets:[GMAIL_TOKEN_ENCRYPTION_KEY] },
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
        if(selected.bodyVersion!==3 || request.data?.refreshOriginal===true){
          try{selected=await hydrateOriginalEmail(practiceId,emailDocId,selected,practiceSnap.data());}
          catch(e){selected.bodyLoadError=e.message;}
        }
        selected=await emailForDisplay(selected,practiceSnap.data());
      }

      let threadQuery=practiceRef.collection("email_timeline").orderBy("data","desc");
      const after=String(request.data?.threadAfter||"");
      if(after){const cursor=await practiceRef.collection("email_timeline").doc(after).get();
        if(cursor.exists)threadQuery=threadQuery.startAfter(cursor);}
      const threadSnap=await threadQuery.limit(51).get();
      const page=threadSnap.docs.slice(0,50);
      const practiceData=practiceSnap.data() || {};
      const owner=practiceData.consulente_uid||practiceData.workspace_uid||practiceData.owner_uid||practiceData.assegnato_a_uid;
      let consultantName=practiceData.assegnato_a_nome||practiceData.consulente_nome||"";
      if(owner){const profile=await db.collection("consulenti").doc(owner).get();
        if(profile.exists)consultantName=[profile.data().nome,profile.data().cognome].filter(Boolean).join(" ");}
      return {
        ok: true,
        practice: {
          id: practiceSnap.id,
          ...practiceData,
          consulente_nome: consultantName,
        },
        email: selected,
        thread: page.map(doc=>{const d=serializeTimelineEmail(doc);return {id:doc.id,oggetto:d.oggetto||"",mittente:d.mittente||[],data:d.data,direzione:d.direzione||""};}),
        threadNext: threadSnap.docs.length>50 ? page[page.length-1].id : null,
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
        Array.isArray(data.mail_matching?.numeri_pratica_manual)
          ? data.mail_matching.numeri_pratica_manual
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
            numeri_pratica_manual: numbers,
            ...(action === "remove" ? {numeri_pratica_appresi: admin.firestore.FieldValue.arrayRemove(number)} : {}),
            numero_pratica_manual:
              numbers.length
                ? numbers[numbers.length - 1]
                : null,
            aggiornatoIl:
              admin.firestore.FieldValue.serverTimestamp(),
          },
          numeri_pratica_banca_manual: numbers,
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
            "folders.inbox.lastUid": 0,
            "folders.inbox.aggiornatoIl":
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


const segnaEmailGestita = onCall({region:"us-central1"}, async request=>{
  const uid=request.auth?.uid;
  if(!uid)throw new HttpsError("unauthenticated","Accesso richiesto.");
  const practiceId=String(request.data?.practiceId||"").trim();
  const emailId=String(request.data?.emailId||"").trim();
  if(!practiceId||!emailId)throw new HttpsError("invalid-argument","Pratica ed email obbligatorie.");
  const ref=db.collection("pratiche_mutuo").doc(practiceId);
  const practice=await ref.get();
  if(!practice.exists||!(await canReadTimelinePractice(uid,practice.data())))
    throw new HttpsError("permission-denied","Pratica non accessibile.");
  const email=ref.collection("email_timeline").doc(emailId);
  await db.runTransaction(async tx=>{
    const snap=await tx.get(email);
    if(!snap.exists)throw new HttpsError("not-found","Email non trovata.");
    tx.update(email,{gestita:true,gestitaDa:uid,gestitaIl:admin.firestore.FieldValue.serverTimestamp()});
  });
  return {ok:true};
});

module.exports = {
  imapCredentialPayload,
  riparaNumeriPraticaDaEmail,
  repairStoredNumbers,
  hydrateOriginalEmail,
  findPracticeByStrictSubject,
  learnPracticeNumberAfterNameMatch,
  segnaEmailGestita,
  canReadTimelinePractice,
  cleanupPracticeTimeline,
  gestisciNumeroPraticaBanca,
  leggiEmailTimeline,
  collegaGmailConAppPassword,
  sincronizzaGmailImapPersonale,
  sincronizzaGmailImapTutti,
  confermaDominioBanca,
  associaEmailAPratica,
};
