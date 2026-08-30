const {
  onSchedule,
} = require("firebase-functions/v2/scheduler");

const admin =
  require("firebase-admin");


if (!admin.apps.length) {
  admin.initializeApp();
}


const db =
  admin.firestore();


const EMAIL_ENDPOINT =
  process.env.REMINDER_EMAIL_ENDPOINT
  ||
  "https://consulenza-credipass.it/api/send-email";


const HOUR =
  60 * 60 * 1000;

const REMINDER_48H_MS =
  48 * HOUR;

const HELP_7D_MS =
  7 * 24 * HOUR;


/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function asMillis(value) {

  if (!value) {
    return null;
  }

  if (
    typeof value.toMillis ===
    "function"
  ) {
    return value.toMillis();
  }

  if (
    typeof value.toDate ===
    "function"
  ) {
    return value
      .toDate()
      .getTime();
  }

  const n =
    Number(value);

  if (
    Number.isFinite(n)
  ) {
    return n;
  }

  const parsed =
    Date.parse(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;

}


function uniqueEmails(values = []) {

  return Array.from(
    new Set(
      values
        .flatMap(
          value =>
            Array.isArray(value)
              ? value
              : [value]
        )
        .map(
          value =>
            String(
              value ||
              ""
            )
            .trim()
            .toLowerCase()
        )
        .filter(
          value =>
            value
            &&
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/
              .test(value)
        )
    )
  );

}


function safeHtml(value) {

  return String(
    value ??
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


function normalizeCode(value) {

  return String(
    value ||
    ""
  )
  .trim()
  .replace(
    /^doc_/,
    ""
  );

}


function documentLabel(code) {

  const labels = {
    ci1:
      "Carta d'Identità R1",
    ci2:
      "Carta d'Identità R2",
    ts1:
      "Tessera Sanitaria / Codice Fiscale R1",
    ts2:
      "Tessera Sanitaria / Codice Fiscale R2",
    residenza1:
      "Certificato Cumulativo",
    matrimonio:
      "Atto / Estratto di matrimonio",
    separazione:
      "Documentazione separazione",
    divorzio:
      "Sentenza di divorzio",
    mantenimento:
      "Documentazione mantenimento",

    bustepaga1:
      "Ultime 2 Buste Paga R1",
    bustepaga2:
      "Ultime 2 Buste Paga R2",
    cud1:
      "Certificazione Unica R1",
    cud2:
      "Certificazione Unica R2",
    contratto:
      "Contratto di Lavoro",
    contratto1:
      "Contratto di Lavoro R1",
    contratto2:
      "Contratto di Lavoro R2",
    unici1:
      "Modello Redditi R1",
    unici2:
      "Modello Redditi R2",
    ricevute1:
      "Ricevuta dichiarazione R1",
    ricevute2:
      "Ricevuta dichiarazione R2",
    f241:
      "F24 R1",
    f242:
      "F24 R2",
    visura1:
      "Visura Camerale R1",
    visura2:
      "Visura Camerale R2",

    ec1:
      "Estratto Conto R1",
    ec2:
      "Estratto Conto R2",
    mov1:
      "Lista Movimenti R1",
    mov2:
      "Lista Movimenti R2",

    locazioni:
      "Contratti di locazione",
    redditi_locazione:
      "Redditi da locazione",
    accrediti_locazione:
      "Accrediti canoni di locazione",

    atto:
      "Atto di provenienza",
    planimetria:
      "Planimetria catastale",
    visura_catastale:
      "Visura catastale",
    visuracat:
      "Visura catastale",
    titoli_edilizi:
      "Titoli edilizi",
    agibilita:
      "Agibilità",
    preliminare:
      "Preliminare / Proposta",
    computo_metrico:
      "Computo metrico",

    mutuo_pre:
      "Documentazione mutuo in essere",
    prestiti:
      "Contratti finanziamenti",
    conteggi_estintivi:
      "Conteggi estintivi",
    ctc:
      "CTC online",
  };

  return (
    labels[
      normalizeCode(code)
    ]
    ||
    normalizeCode(code)
      .replace(
        /_/g,
        " "
      )
      .replace(
        /\b\w/g,
        c =>
          c.toUpperCase()
      )
  );

}


function getRequiredCodes(data = {}) {

  const source =
    data
      .richiestaIntegrazioneAttiva ===
      true
      ?
      data
        .elencoDocRichiesti
      :
      data
        .documenti_richiesti_portale;

  return Array.from(
    new Set(
      (
        Array.isArray(source)
          ?
          source
          :
          []
      )
      .map(
        normalizeCode
      )
      .filter(Boolean)
    )
  );

}


function isDocumentPresent(
  data,
  code
) {

  const raw =
    normalizeCode(code);

  return (
    data[
      `doc_${raw}`
    ] ===
      true
    ||
    data[
      raw
    ] ===
      true
  );

}


function getMissingCodes(
  data = {}
) {

  const required =
    getRequiredCodes(
      data
    );

  const versionRequests =
    new Set(
      (
        Array.isArray(
          data
            .documenti_versione_richiesta
        )
          ?
          data
            .documenti_versione_richiesta
          :
          []
      )
      .map(
        normalizeCode
      )
  );

  return required
    .filter(
      code =>
        !isDocumentPresent(
          data,
          code
        )
        ||
        versionRequests
          .has(
            code
          )
    );

}


function clientEmails(data = {}) {

  return uniqueEmails([
    data
      .cliente_email,
    data
      .cliente2_email,
  ]);

}


function internalEmails(data = {}) {

  return uniqueEmails([
    data
      .referente_email,

    data
      .consulente_email,

    data
      .backoffice_email,

    data
      .email_backoffice,

    data
      .emailBO,
  ]);

}


function practiceLabel(
  id,
  data = {}
) {

  return (
    data
      .nomeCliente
    ||
    data
      .cliente_nome_completo
    ||
    data
      .cliente_nome
    ||
    id
  );

}


function clientAreaUrl(
  id,
  data = {}
) {

  if (
    data
      .area_cliente_url
  ) {
    return String(
      data
        .area_cliente_url
    );
  }

  return (
    "https://consulenza-credipass.it/upload.html?id="
    +
    encodeURIComponent(
      id
    )
  );

}


function dashboardUrl(id) {

  return (
    "https://consulenza-credipass.it/main/dashboard-consulente.html?id="
    +
    encodeURIComponent(
      id
    )
  );

}


/*
|--------------------------------------------------------------------------
| EMAIL
|--------------------------------------------------------------------------
*/

async function sendEmail({
  to,
  subject,
  html,
  replyTo = "",
}) {

  const recipients =
    uniqueEmails(
      to
    );

  if (
    !recipients.length
  ) {
    return {
      ok:
        false,
      skipped:
        true,
      reason:
        "no_recipients",
    };
  }

  const response =
    await fetch(
      EMAIL_ENDPOINT,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            to:
              recipients,

            cc:
              [],

            bcc:
              [],

            subject,

            html,

            replyTo:
              replyTo
              ||
              undefined,
          }),
      }
    );

  if (
    !response.ok
  ) {
    let detail =
      "";

    try {
      detail =
        await response
          .text();
    }
    catch(e) {}

    throw new Error(
      `Email endpoint ${response.status}: ${detail || "errore invio"}`
    );
  }

  return {
    ok:
      true,
    recipients,
  };

}


function baseEmail({
  eyebrow,
  title,
  intro,
  missingCodes,
  detail,
  ctaLabel,
  ctaUrl,
  footer,
}) {

  const items =
    missingCodes
      .map(
        code =>
          `
            <tr>
              <td style="padding:7px 0;color:#303a43;font-size:12px;">
                <span style="color:#C99700;font-weight:bold;">✓</span>
                ${safeHtml(documentLabel(code))}
              </td>
            </tr>
          `
      )
      .join("");

  return `
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${safeHtml(title)}</title>
</head>

<body style="margin:0;padding:0;background:#eef2f6;font-family:Arial,Helvetica,sans-serif;color:#27313a;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2f6">
<tr>
<td align="center" style="padding:28px 12px;">

<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="max-width:650px;background:#fff;border-radius:15px;overflow:hidden;border:1px solid #e2e7ed;">

<tr>
<td bgcolor="#002d72" style="padding:26px 30px;border-bottom:5px solid #C99700;">
  <div style="font-size:11px;color:#C99700;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;">
    ${safeHtml(eyebrow)}
  </div>
  <div style="margin-top:7px;color:#fff;font-size:22px;font-weight:bold;">
    ${safeHtml(title)}
  </div>
</td>
</tr>

<tr>
<td style="padding:26px 30px 12px;color:#4f5b64;font-size:13px;line-height:1.65;">
  ${safeHtml(intro)}
</td>
</tr>

${
  missingCodes.length
    ?
    `
<tr>
<td style="padding:4px 30px 16px;">
  <div style="font-size:11px;color:#002d72;font-weight:bold;text-transform:uppercase;">
    Documenti ancora da completare
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:7px;">
    ${items}
  </table>
</td>
</tr>
    `
    :
    ""
}

${
  detail
    ?
    `
<tr>
<td style="padding:0 30px 18px;">
  <div style="background:#fff9e8;border-left:4px solid #C99700;border-radius:8px;padding:12px 14px;color:#655b37;font-size:11px;line-height:1.55;">
    ${safeHtml(detail)}
  </div>
</td>
</tr>
    `
    :
    ""
}

${
  ctaUrl
    ?
    `
<tr>
<td align="center" style="padding:4px 30px 28px;">
  <a href="${safeHtml(ctaUrl)}"
     style="display:inline-block;background:#002d72;color:#fff;text-decoration:none;padding:13px 20px;border-radius:8px;border-bottom:4px solid #C99700;font-size:12px;font-weight:bold;">
    ${safeHtml(ctaLabel)}
  </a>
</td>
</tr>
    `
    :
    ""
}

<tr>
<td bgcolor="#002d72" style="padding:17px 30px;color:#aebbd0;font-size:10px;line-height:1.5;">
  <strong style="color:#C99700;">Credipass S.p.A.</strong><br>
  ${safeHtml(footer)}
</td>
</tr>

</table>
</td>
</tr>
</table>

</body>
</html>
  `;

}


/*
|--------------------------------------------------------------------------
| TIMELINE INTERNA
|--------------------------------------------------------------------------
*/

async function addInternalTimeline(
  ref,
  {
    tipo,
    titolo,
    descrizione,
    meta = {},
  }
) {

  const entry = {
    id:
      `sys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,

    tipo,

    titolo,

    descrizione,

    stato:
      "",

    meta,

    autore:
      "Sistema automatico",

    creato_il:
      new Date()
        .toISOString(),
  };

  await db.runTransaction(
    async transaction => {

      const snap =
        await transaction
          .get(
            ref
          );

      const data =
        snap.exists
          ?
          (
            snap.data()
            ||
            {}
          )
          :
          {};

      const current =
        Array.isArray(
          data
            .attivita_interne
        )
          ?
          data
            .attivita_interne
          :
          [];

      transaction.set(
        ref,
        {
          attivita_interne:
            [
              entry,
              ...current,
            ]
            .slice(
              0,
              250
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


/*
|--------------------------------------------------------------------------
| PROCESSING
|--------------------------------------------------------------------------
*/

async function processPractice(
  docSnap
) {

  const id =
    docSnap.id;

  const data =
    docSnap.data()
    ||
    {};

  if (
    data
      .documentReminderAttivo !==
      true
  ) {
    return;
  }

  if (
    data
      .documentReminderPausa ===
      true
    ||
    data
      .stato_pratica ===
      "sospesa"
  ) {
    return;
  }

  const ref =
    docSnap.ref;

  const required =
    getRequiredCodes(
      data
    );

  if (
    !required.length
  ) {
    return;
  }

  const missing =
    getMissingCodes(
      data
    );

  /*
   * Tutto completo -> stop reminder.
   */
  if (
    missing.length ===
    0
  ) {

    if (
      data
        .documentReminderCompletato !==
      true
    ) {

      await ref.set(
        {
          documentReminderAttivo:
            false,

          documentReminderCompletato:
            true,

          documentReminderCompletatoIl:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        },
        {
          merge:
            true,
        }
      );

      await addInternalTimeline(
        ref,
        {
          tipo:
            "reminder_documenti_completato",

          titolo:
            "Reminder documentazione terminato",

          descrizione:
            "Tutti i documenti richiesti risultano presenti. Il ciclo automatico di sollecito è stato chiuso.",

          meta: {
            documenti_richiesti:
              required,
          },
        }
      );

    }

    return;
  }

  const now =
    Date.now();

  const richiestaIl =
    asMillis(
      data
        .documentReminderRichiestoIl
    );

  const primoUploadIl =
    asMillis(
      data
        .documentReminderPrimoUploadIl
    );

  const ultimoInvioIl =
    asMillis(
      data
        .documentReminderUltimoInvioIl
    );

  const isIntegration =
    data
      .richiestaIntegrazioneAttiva ===
      true;

  const customers =
    clientEmails(
      data
    );

  const internal =
    internalEmails(
      data
    );

  const label =
    practiceLabel(
      id,
      data
    );

  const replyTo =
    uniqueEmails([
      data
        .referente_email,
      data
        .consulente_email,
    ])[0]
    ||
    "";

  /*
   * ESCALATION 7 GIORNI SENZA ALCUN UPLOAD
   *
   * Una sola volta.
   */
  if (
    !primoUploadIl
    &&
    !isIntegration
    &&
    richiestaIl
    &&
    (
      now -
      richiestaIl
    ) >=
      HELP_7D_MS
    &&
    data
      .documentReminderHelpInviato !==
      true
  ) {

    if (
      customers.length
    ) {

      await sendEmail({
        to:
          customers,

        subject:
          `Serve aiuto con i documenti? - ${label}`,

        replyTo,

        html:
          baseEmail({
            eyebrow:
              "Supporto documentazione",

            title:
              "Possiamo aiutarti con i documenti?",

            intro:
              "La documentazione richiesta per la pratica non risulta ancora avviata. Se hai difficoltà nel reperire o caricare i documenti, il consulente può supportarti.",

            missingCodes:
              missing,

            detail:
              "Puoi utilizzare l'Area Cliente oppure rispondere direttamente a questa email per chiedere supporto.",

            ctaLabel:
              "APRI AREA CLIENTE",

            ctaUrl:
              clientAreaUrl(
                id,
                data
              ),

            footer:
              `Pratica ${label}.`,
          }),
      });

    }

    if (
      internal.length
    ) {

      await sendEmail({
        to:
          internal,

        subject:
          `Alert documentazione ferma da 7 giorni - ${label}`,

        replyTo,

        html:
          baseEmail({
            eyebrow:
              "Alert operativo",

            title:
              "Documentazione non ancora avviata",

            intro:
              "Sono trascorsi 7 giorni dalla richiesta documentale e non risulta ancora alcun primo caricamento del cliente.",

            missingCodes:
              missing,

            detail:
              "Il cliente è stato contattato automaticamente per verificare se necessita di supporto.",

            ctaLabel:
              "APRI PRATICA",

            ctaUrl:
              dashboardUrl(
                id
              ),

            footer:
              "Comunicazione interna destinata a consulente e Backoffice.",
          }),
      });

    }

    await ref.set(
      {
        documentReminderHelpInviato:
          true,

        documentReminderHelpInviatoIl:
          admin.firestore
            .FieldValue
            .serverTimestamp(),
      },
      {
        merge:
          true,
      }
    );

    await addInternalTimeline(
      ref,
      {
        tipo:
          "reminder_documenti_help",

        titolo:
          "Escalation documentazione: 7 giorni",

        descrizione:
          "Nessun primo caricamento rilevato. Il cliente è stato contattato per offrire supporto; consulente e Backoffice sono stati informati.",

        meta: {
          documenti_mancanti:
            missing,

          destinatari_cliente:
            customers,

          destinatari_interni:
            internal,
        },
      }
    );

    return;
  }

  /*
   * REMINDER 48 ORE
   *
   * - pratica normale: solo dopo il primo upload;
   * - integrazione: da subito, perché è già una richiesta specifica.
   */
  const reminderStarted =
    isIntegration
    ||
    Boolean(
      primoUploadIl
    );

  if (
    !reminderStarted
  ) {
    return;
  }

  const baseTime =
    ultimoInvioIl
    ||
    primoUploadIl
    ||
    richiestaIl;

  if (
    !baseTime
    ||
    (
      now -
      baseTime
    ) <
      REMINDER_48H_MS
  ) {
    return;
  }

  /*
   * 1) CLIENTE
   */
  if (
    customers.length
  ) {

    await sendEmail({
      to:
        customers,

      subject:
        isIntegration
          ?
          `Promemoria integrazione documenti - ${label}`
          :
          `Promemoria documentazione pratica - ${label}`,

      replyTo,

      html:
        baseEmail({
          eyebrow:
            "Promemoria automatico",

          title:
            isIntegration
              ?
              "Integrazione documenti ancora da completare"
              :
              "Documentazione ancora da completare",

          intro:
            isIntegration
              ?
              "Ti ricordiamo che risultano ancora uno o più documenti richiesti in integrazione."
              :
              "Hai già iniziato a caricare la documentazione. Risultano però ancora alcuni documenti da completare.",

          missingCodes:
            missing,

          detail:
            "Il promemoria viene inviato automaticamente ogni 48 ore finché la documentazione richiesta non risulta completa.",

          ctaLabel:
            "COMPLETA DOCUMENTAZIONE",

          ctaUrl:
            clientAreaUrl(
              id,
              data
            ),

          footer:
            `Pratica ${label}.`,
        }),
    });

  }

  /*
   * 2) CONSULENTE + BACKOFFICE
   *
   * Ogni reminder 48h genera anche un alert interno.
   */
  if (
    internal.length
  ) {

    await sendEmail({
      to:
        internal,

      subject:
        `Alert reminder 48h documentazione - ${label}`,

      replyTo,

      html:
        baseEmail({
          eyebrow:
            "Alert operativo 48h",

          title:
            "Cliente sollecitato automaticamente",

          intro:
            "Il sistema ha inviato al cliente il promemoria automatico delle 48 ore perché la documentazione richiesta non risulta ancora completa.",

          missingCodes:
            missing,

          detail:
            `${missing.length} documento/i ancora da completare. Consulente e Backoffice ricevono questo alert per mantenere piena visibilità sulla pratica.`,

          ctaLabel:
            "APRI PRATICA",

          ctaUrl:
            dashboardUrl(
              id
            ),

          footer:
            "Comunicazione interna destinata a consulente e Backoffice.",
        }),
    });

  }

  await ref.set(
    {
      documentReminderUltimoInvioIl:
        admin.firestore
          .FieldValue
          .serverTimestamp(),

      documentReminderNumeroInvii:
        admin.firestore
          .FieldValue
          .increment(1),
    },
    {
      merge:
        true,
    }
  );

  /*
   * 3) TIMELINE INTERNA
   */
  await addInternalTimeline(
    ref,
    {
      tipo:
        "reminder_documenti_48h",

      titolo:
        "Reminder documentazione 48h inviato",

      descrizione:
        `Cliente sollecitato automaticamente. Documenti ancora mancanti: ${missing.map(documentLabel).join(", ")}.`,

      meta: {
        documenti_mancanti:
          missing,

        integrazione:
          isIntegration,

        destinatari_cliente:
          customers,

        destinatari_interni:
          internal,
      },
    }
  );

}


/*
|--------------------------------------------------------------------------
| CLOUD FUNCTION SCHEDULATA
|--------------------------------------------------------------------------
*/

const controllaReminderDocumenti =
  onSchedule(
    {
      schedule:
        "every 60 minutes",

      timeZone:
        "Europe/Rome",

      region:
        "us-central1",

      memory:
        "512MiB",

      timeoutSeconds:
        540,
    },

    async () => {

      const snap =
        await db
          .collection(
            "pratiche_mutuo"
          )
          .where(
            "documentReminderAttivo",
            "==",
            true
          )
          .get();

      console.log(
        `Reminder documenti: ${snap.size} pratiche attive da verificare.`
      );

      let ok =
        0;

      let errori =
        0;

      for (
        const docSnap of
        snap.docs
      ) {

        try {

          await processPractice(
            docSnap
          );

          ok++;

        }
        catch(error) {

          errori++;

          console.error(
            "Errore reminder pratica",
            docSnap.id,
            error
          );

          try {

            await addInternalTimeline(
              docSnap.ref,
              {
                tipo:
                  "reminder_documenti_errore",

                titolo:
                  "Errore reminder automatico",

                descrizione:
                  error?.message
                  ||
                  "Errore non specificato durante il controllo reminder.",

                meta: {
                  errore:
                    error?.message
                    ||
                    "",
                },
              }
            );

          }
          catch(timelineError) {

            console.error(
              "Errore registrazione timeline reminder:",
              timelineError
            );

          }

        }

      }

      console.log(
        `Reminder documenti completato. OK=${ok}, errori=${errori}`
      );

    }
  );


module.exports = {
  controllaReminderDocumenti,
};
