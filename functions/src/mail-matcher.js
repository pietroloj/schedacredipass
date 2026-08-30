const admin =
  require("firebase-admin");


function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}


function normalizeText(value) {
  return norm(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}


function emailDomain(address) {
  const raw =
    String(address || "")
      .trim()
      .toLowerCase();

  const at =
    raw.lastIndexOf("@");

  return at >= 0
    ? raw.slice(at + 1)
    : "";
}


function domainMatches(domain, pattern) {
  const d = norm(domain);
  const p = norm(pattern)
    .replace(/^\*\./, "");

  return Boolean(
    d
    &&
    p
    &&
    (
      d === p
      ||
      d.endsWith(`.${p}`)
      ||
      d.includes(p)
    )
  );
}


function collectAddresses(mail) {
  const out = [];

  const pushList = value => {
    if (!value) return;

    if (Array.isArray(value.value)) {
      for (const item of value.value) {
        if (item?.address) {
          out.push(item.address);
        }
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          out.push(item);
        }
        else if (item?.address) {
          out.push(item.address);
        }
      }
    }
  };

  pushList(mail.from);
  pushList(mail.to);
  pushList(mail.cc);
  pushList(mail.bcc);

  return out;
}


/*
 * Estrae candidati "numero pratica" dall'oggetto.
 * Il matcher non presume un formato unico per tutte le banche.
 */
function extractPracticeNumbers(subject = "") {
  const text =
    String(subject || "")
      .replace(/\s+/g, " ")
      .trim();

  const candidates =
    new Set();

  const labeled =
    [
      /(?:pratica|prat\.|numero pratica|n\.?\s*pratica|rif\.?|riferimento)\s*(?:n\.?|nr\.?|numero|#|:|-)?\s*([a-z0-9][a-z0-9\/._-]{4,30})/gi,
      /(?:mutuo|istruttoria)\s*(?:n\.?|nr\.?|#|:|-)?\s*([a-z0-9][a-z0-9\/._-]{4,30})/gi,
    ];

  for (const regex of labeled) {
    let m;

    while (
      (
        m =
          regex.exec(text)
      )
    ) {
      candidates.add(
        normalizePracticeNumber(
          m[1]
        )
      );
    }
  }

  /*
   * Fallback: sequenze numeriche lunghe nell'oggetto.
   */
  const numeric =
    text.match(
      /\b\d{6,20}\b/g
    )
    ||
    [];

  for (const value of numeric) {
    candidates.add(
      normalizePracticeNumber(
        value
      )
    );
  }

  return Array.from(
    candidates
  )
  .filter(Boolean);
}


function normalizePracticeNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[.,;:]+$/g, "");
}


function practiceNumbersFromData(data = {}) {
  const direct = [
    data.numero_pratica_banca,
    data.numero_pratica,
    data.pratica_banca_numero,
    data.numeroPraticaBanca,
    data.numeroPratica,
    data.riferimento_pratica_banca,
    data.mail_matching?.numero_pratica,
  ];

  const arrays = [
    data.mail_matching?.numeri_pratica,
    data.numeri_pratica_banca,
  ];

  return Array.from(
    new Set(
      [
        ...direct,
        ...arrays.flatMap(v =>
          Array.isArray(v)
            ? v
            : []
        )
      ]
      .map(normalizePracticeNumber)
      .filter(Boolean)
    )
  );
}


function practiceCreatedMillis(data = {}) {
  const candidates = [
    data.createdAt,
    data.creatoIl,
    data.creato_il,
    data.dataCreazione,
    data.data_creazione,
    data.documentReminderRichiestoIl,
    data.timestamp,
  ];

  for (const value of candidates) {
    if (!value) continue;

    if (typeof value.toMillis === "function") {
      return value.toMillis();
    }

    if (typeof value.toDate === "function") {
      return value.toDate().getTime();
    }

    const n =
      Number(value);

    if (Number.isFinite(n)) {
      return n;
    }

    const parsed =
      Date.parse(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}


function applicantNames(data = {}) {
  const pairs = [
    [
      data.cliente_nome,
      data.cliente_cognome
    ],
    [
      data.cliente2_nome,
      data.cliente2_cognome
    ],
  ];

  return pairs
    .map(([nome, cognome]) =>
      normalizeText(
        `${nome || ""} ${cognome || ""}`
      )
    )
    .filter(x =>
      x.length >= 5
    );
}


function nameMatchScore(subject, data) {
  const text =
    normalizeText(subject);

  const names =
    applicantNames(data);

  let hits = 0;

  for (const full of names) {
    if (
      full
      &&
      text.includes(full)
    ) {
      hits++;
      continue;
    }

    /*
     * Anche "COGNOME NOME".
     */
    const parts =
      full.split(" ")
        .filter(Boolean);

    if (
      parts.length >= 2
    ) {
      const reversed =
        [...parts]
          .reverse()
          .join(" ");

      if (
        text.includes(reversed)
      ) {
        hits++;
      }
    }
  }

  if (hits >= 2) return 90;
  if (hits === 1) return 70;
  return 0;
}


async function loadBankCatalog(db) {
  const snap =
    await db
      .collection("mail_banche")
      .where("attiva", "==", true)
      .get();

  return snap.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() || {})
  }));
}


function detectBank(catalog, mail) {
  const addresses =
    collectAddresses(mail);

  const domains =
    Array.from(
      new Set(
        addresses
          .map(emailDomain)
          .filter(Boolean)
      )
    );

  for (const bank of catalog) {
    const patterns =
      Array.isArray(bank.domini)
        ? bank.domini
        : Array.isArray(bank.domains)
        ? bank.domains
        : [];

    for (const domain of domains) {
      if (
        patterns.some(
          pattern =>
            domainMatches(
              domain,
              pattern
            )
        )
      ) {
        return {
          bank,
          domain,
          verified:
            true,
        };
      }
    }
  }

  return {
    bank: null,
    domain:
      domains[0]
      ||
      "",
    verified:
      false,
  };
}


function mailDateMillis(mail) {
  const d =
    mail.date
      ? new Date(mail.date)
      : null;

  return (
    d
    &&
    !Number.isNaN(d.getTime())
  )
    ? d.getTime()
    : Date.now();
}


async function findPracticeMatch({
  db,
  mail,
  bankDetection,
}) {
  const subject =
    String(mail.subject || "");

  const numbers =
    extractPracticeNumbers(
      subject
    );

  const emailMillis =
    mailDateMillis(
      mail
    );

  const snap =
    await db
      .collection("pratiche_mutuo")
      .get();

  const candidates = [];

  for (const doc of snap.docs) {
    const data =
      doc.data()
      ||
      {};

    const createdMillis =
      practiceCreatedMillis(
        data
      );

    /*
     * Regola richiesta:
     * nessuna associazione automatica se l'email è antecedente
     * alla creazione del fascicolo.
     *
     * Se il fascicolo storico non ha una data affidabile,
     * non facciamo match automatico per nome.
     */
    if (
      createdMillis
      &&
      emailMillis <
        createdMillis
    ) {
      continue;
    }

    const knownNumbers =
      practiceNumbersFromData(
        data
      );

    const exactNumber =
      numbers.find(
        n =>
          knownNumbers.includes(n)
      );

    if (exactNumber) {
      candidates.push({
        id: doc.id,
        ref: doc.ref,
        data,
        score: 130,
        method:
          "numero_pratica_esatto",
        practiceNumber:
          exactNumber,
        createdMillis,
      });

      continue;
    }

    const nameScore =
      nameMatchScore(
        subject,
        data
      );

    if (
      nameScore <= 0
    ) {
      continue;
    }

    /*
     * Per nome/cognome pretendiamo una data creazione fascicolo.
     */
    if (!createdMillis) {
      continue;
    }

    let score =
      nameScore;

    if (
      bankDetection
        ?.verified
    ) {
      score += 30;
    }

    if (
      numbers.length
    ) {
      score += 15;
    }

    candidates.push({
      id: doc.id,
      ref: doc.ref,
      data,
      score,
      method:
        "nome_oggetto",
      practiceNumber:
        numbers[0]
        ||
        "",
      createdMillis,
    });
  }

  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );

  if (!candidates.length) {
    return {
      matched: false,
      candidates: [],
      extractedNumbers:
        numbers,
    };
  }

  const best =
    candidates[0];

  const second =
    candidates[1];

  const uniqueEnough =
    !second
    ||
    (
      best.score -
      second.score
    ) >= 20;

  /*
   * Numero pratica esatto = associazione automatica.
   * Nome+cognome = automatica solo se molto forte e univoca.
   */
  const automatic =
    best.score >= 120
    ||
    (
      best.score >= 100
      &&
      uniqueEnough
    );

  return {
    matched:
      automatic,

    best,

    candidates:
      candidates.slice(0, 5),

    extractedNumbers:
      numbers,
  };
}


async function rememberPracticeNumber({
  db,
  practiceRef,
  number,
  bankDetection,
}) {
  const normalized =
    normalizePracticeNumber(
      number
    );

  if (!normalized) {
    return;
  }

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
          data.mail_matching
            ?.numeri_pratica
        )
          ? data.mail_matching.numeri_pratica
          : [];

      const merged =
        Array.from(
          new Set([
            ...current
              .map(normalizePracticeNumber)
              .filter(Boolean),
            normalized,
          ])
        );

      tx.set(
        practiceRef,
        {
          mail_matching: {
            ...(data.mail_matching || {}),
            numeri_pratica:
              merged,
            numero_pratica:
              normalized,
            bancaKey:
              bankDetection?.bank?.bancaKey
              ||
              bankDetection?.bank?.id
              ||
              data.mail_matching?.bancaKey
              ||
              null,
            bancaNome:
              bankDetection?.bank?.bancaNome
              ||
              data.mail_matching?.bancaNome
              ||
              null,
            dominio_verificato:
              bankDetection?.verified
              ? bankDetection.domain
              : (
                  data.mail_matching?.dominio_verificato
                  ||
                  null
                ),
            aggiornatoIl:
              admin.firestore
                .FieldValue
                .serverTimestamp(),
          },
        },
        {
          merge:
            true,
        }
      );
    }
  );
}


module.exports = {
  emailDomain,
  domainMatches,
  collectAddresses,
  extractPracticeNumbers,
  normalizePracticeNumber,
  practiceNumbersFromData,
  practiceCreatedMillis,
  applicantNames,
  loadBankCatalog,
  detectBank,
  findPracticeMatch,
  rememberPracticeNumber,
};
