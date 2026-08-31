const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const {
  defineSecret,
} = require("firebase-functions/params");

const admin =
  require("firebase-admin");

const OpenAI =
  require("openai");

const {
  createNotification,
} = require("./notification-center");


if (!admin.apps.length) {
  admin.initializeApp();
}


const db =
  admin.firestore();


const OPENAI_API_KEY =
  defineSecret(
    "OPENAI_API_KEY"
  );


function parseJsonObject(
  value
) {

  const raw =
    String(
      value || ""
    ).trim();

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  }
  catch(error) {}

  const first =
    raw.indexOf("{");

  const last =
    raw.lastIndexOf("}");

  if (
    first >= 0
    &&
    last > first
  ) {
    try {
      return JSON.parse(
        raw.slice(
          first,
          last + 1
        )
      );
    }
    catch(error) {}
  }

  return null;
}


function normalizeAnalysis(
  data = {}
) {

  const allowedPriority =
    ["low","normal","high","urgent"];

  const requestedDocuments =
    Array.isArray(
      data.requestedDocuments
    )
      ? data.requestedDocuments
          .map(x => String(x || "").trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];

  const actions =
    Array.isArray(
      data.suggestedActions
    )
      ? data.suggestedActions
          .map(x => String(x || "").trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];

  return {
    summary:
      String(
        data.summary || ""
      )
      .trim()
      .slice(0, 2500),

    category:
      String(
        data.category || "comunicazione"
      )
      .trim()
      .slice(0, 100),

    priority:
      allowedPriority
        .includes(data.priority)
        ? data.priority
        : "normal",

    requestedDocuments,

    suggestedActions:
      actions,

    deadline:
      data.deadline
        ? String(data.deadline)
            .slice(0, 100)
        : null,

    statusSuggestion:
      data.statusSuggestion
        ? String(data.statusSuggestion)
            .slice(0, 150)
        : null,

    requiresAction:
      data.requiresAction === true,

    positiveOutcome:
      data.positiveOutcome === true,

    confidence:
      Number.isFinite(
        Number(data.confidence)
      )
        ? Math.max(
            0,
            Math.min(
              1,
              Number(data.confidence)
            )
          )
        : null,
  };
}


async function analyzeEmailWithAI({
  practiceId,
  emailId,
  uid,
  bank = null,
  subject = "",
  body = "",
  from = [],
  force = false,
}) {

  const practiceRef =
    db
      .collection(
        "pratiche_mutuo"
      )
      .doc(practiceId);

  const emailRef =
    practiceRef
      .collection(
        "email_timeline"
      )
      .doc(emailId);

  const emailSnap =
    await emailRef.get();

  if (!emailSnap.exists) {
    throw new Error(
      "Email pratica non trovata."
    );
  }

  const emailData =
    emailSnap.data() || {};

  if (
    !force
    &&
    emailData.aiAnalysis
      ?.completed === true
  ) {
    return emailData.aiAnalysis;
  }

  const practiceSnap =
    await practiceRef.get();

  const practice =
    practiceSnap.exists
      ? practiceSnap.data() || {}
      : {};

  const client =
    new OpenAI({
      apiKey:
        OPENAI_API_KEY.value(),
    });

  const clientName =
    [
      practice.nome,
      practice.cognome,
      practice.r1_nome,
      practice.r1_cognome,
      practice.nome_cliente,
    ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 250);

  const instruction = `
Sei un assistente operativo per pratiche di mutuo italiane.

Analizza esclusivamente il contenuto dell'email fornita.
Non inventare documenti, scadenze o richieste che non siano presenti.

Restituisci SOLO JSON valido con questa struttura:
{
  "summary": "riassunto molto breve in italiano",
  "category": "una tra: richiesta_documenti, aggiornamento_pratica, delibera, perizia, appuntamento, richiesta_chiarimenti, comunicazione, altro",
  "priority": "low|normal|high|urgent",
  "requestedDocuments": ["documento 1"],
  "suggestedActions": ["azione 1"],
  "deadline": "testo della scadenza oppure null",
  "statusSuggestion": "eventuale stato pratica suggerito oppure null",
  "requiresAction": true,
  "positiveOutcome": false,
  "confidence": 0.0
}

Regole:
- requestedDocuments contiene SOLO documenti realmente richiesti.
- requiresAction=true solo se il consulente deve fare qualcosa.
- positiveOutcome=true per delibera positiva/approvazione/esito favorevole.
- priority=urgent solo se il testo indica urgenza/scadenza ravvicinata/blocco esplicito.
- confidence è tra 0 e 1.
`.trim();

  const userContent = `
PRATICA
ID: ${practiceId}
Cliente: ${clientName || "N/D"}

EMAIL
Banca: ${bank || "N/D"}
Da: ${Array.isArray(from) ? from.join(", ") : String(from || "")}
Oggetto: ${String(subject || "")}

Testo:
${String(body || "").slice(0, 18000)}
`.trim();

  const response =
    await client.chat.completions.create({
      model:
        "gpt-4o-mini",

      temperature:
        0.1,

      response_format: {
        type:
          "json_object",
      },

      messages: [
        {
          role:
            "system",

          content:
            instruction,
        },
        {
          role:
            "user",

          content:
            userContent,
        },
      ],
    });

  const parsed =
    parseJsonObject(
      response.choices
        ?.[0]
        ?.message
        ?.content
    );

  if (!parsed) {
    throw new Error(
      "L'AI non ha restituito JSON valido."
    );
  }

  const normalized =
    normalizeAnalysis(
      parsed
    );

  const aiAnalysis = {
    completed:
      true,

    analyzedAt:
      admin.firestore
        .FieldValue
        .serverTimestamp(),

    model:
      "gpt-4o-mini",

    ...normalized,
  };

  await emailRef.set(
    {
      aiAnalysis,
    },
    {
      merge: true,
    }
  );

  if (
    uid
    &&
    (
      normalized.requiresAction
      ||
      normalized.positiveOutcome
      ||
      normalized.priority === "urgent"
      ||
      normalized.priority === "high"
    )
  ) {

    const title =
      normalized.positiveOutcome
        ? `🏦 Esito banca: ${bank || "nuova comunicazione"}`
        : normalized.requiresAction
        ? `📧 Azione richiesta: ${bank || "email banca"}`
        : `📧 Nuova email prioritaria`;

    await createNotification({
      uid,

      type:
        normalized.positiveOutcome
          ? "bank_positive_outcome"
          : "bank_email_action",

      title,

      message:
        normalized.summary
        ||
        subject
        ||
        "Nuova comunicazione banca.",

      practiceId,

      emailId,

      priority:
        normalized.priority,

      metadata: {
        requestedDocuments:
          normalized.requestedDocuments,

        suggestedActions:
          normalized.suggestedActions,

        deadline:
          normalized.deadline,

        statusSuggestion:
          normalized.statusSuggestion,
      },
    });
  }

  return {
    completed:
      true,

    ...normalized,
  };
}


const analizzaEmailPraticaAI =
  onCall(
    {
      region:
        "us-central1",

      secrets: [
        OPENAI_API_KEY,
      ],

      memory:
        "1GiB",

      timeoutSeconds:
        180,
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

      const practiceId =
        String(
          request.data?.practiceId || ""
        ).trim();

      const emailId =
        String(
          request.data?.emailId || ""
        ).trim();

      if (
        !practiceId
        ||
        !emailId
      ) {
        throw new HttpsError(
          "invalid-argument",
          "practiceId ed emailId sono obbligatori."
        );
      }

      const ref =
        db
          .collection(
            "pratiche_mutuo"
          )
          .doc(practiceId)
          .collection(
            "email_timeline"
          )
          .doc(emailId);

      const snap =
        await ref.get();

      if (!snap.exists) {
        throw new HttpsError(
          "not-found",
          "Email non trovata."
        );
      }

      const email =
        snap.data() || {};

      try {
        const result =
          await analyzeEmailWithAI({
            practiceId,
            emailId,
            uid,

            bank:
              email.banca || null,

            subject:
              email.oggetto || "",

            body:
              email.testo || "",

            from:
              email.mittente || [],

            force:
              request.data?.force === true,
          });

        return {
          ok: true,
          analysis: result,
        };
      }
      catch(error) {
        console.error(
          "analizzaEmailPraticaAI:",
          error
        );

        throw new HttpsError(
          "internal",
          error?.message
          || "Errore analisi AI email."
        );
      }
    }
  );


module.exports = {
  OPENAI_API_KEY,
  analyzeEmailWithAI,
  analizzaEmailPraticaAI,
};
