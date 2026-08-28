/**
 * Reminder automatici documentazione + reminder interni pratica.
 *
 * LOGICA DOCUMENTI
 * - il timer parte quando viene richiesta un'integrazione;
 * - reminder cliente ogni 48h finché esistono documenti richiesti mancanti;
 * - vale sia con 0/10 caricati sia con 8/10 caricati;
 * - stato "sospesa" mette in pausa i reminder documentali;
 * - uscendo da "sospesa" il ciclo riparte;
 * - quando i documenti sono completi si arresta.
 *
 * ESCALATION
 * - dopo 7 giorni, se la documentazione è ancora incompleta,
 *   una sola email di assistenza a cliente + Backoffice + consulente.
 *
 * REMINDER INTERNI
 * - quando dashboard salva stato "sospesa" o "attesa_documenti"
 *   con motivo/data, alla data indicata invia una sola email
 *   a Backoffice e consulente.
 */

const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

const APP_ORIGIN =
    "https://consulenza-credipass.it";

const SEND_EMAIL_ENDPOINT =
    `${APP_ORIGIN}/api/send-email`;

const HOURS_48 =
    48 * 60 * 60 * 1000;

const DAYS_7 =
    7 * 24 * 60 * 60 * 1000;

const STATE_META = {
    da_istruire: { step: 0, pct: 12, label: "Da istruire" },
    istruttoria: { step: 1, pct: 25, label: "Istruttoria" },
    integrazione_documenti: { step: 1, pct: 30, label: "Integrazione documenti" },
    attesa_documenti: { step: 1, pct: 30, label: "Attesa documenti" },
    caricato_banca: { step: 2, pct: 42, label: "Caricato in banca" },
    valutazione_reddituale: { step: 2, pct: 48, label: "Valutazione reddituale" },
    delibera_reddituale_ok: { step: 2, pct: 55, label: "Delibera reddituale OK" },
    delibera_reddituale_ko: { step: 2, pct: 55, label: "Delibera reddituale KO" },
    attesa_perizia: { step: 3, pct: 60, label: "Attesa perizia" },
    perizia_in_corso: { step: 3, pct: 67, label: "Perizia in corso" },
    perizia_ok: { step: 3, pct: 72, label: "Perizia OK" },
    perizia_ko: { step: 3, pct: 67, label: "Perizia KO" },
    attesa_documentazione_notarile: { step: 4, pct: 78, label: "Documentazione notarile" },
    chiamata_atto: { step: 4, pct: 88, label: "Chiamata d'atto" },
    stipulato: { step: 5, pct: 100, label: "Stipulato" },
    sospesa: { step: 2, pct: 45, label: "Sospesa" },
    rinunciata: { step: 1, pct: 25, label: "Rinunciata / KO" }
};

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function millis(value) {
    if (!value) return 0;

    if (
        typeof value.toMillis ===
        "function"
    ) {
        return value.toMillis();
    }

    const d =
        new Date(value);

    return Number.isFinite(
        d.getTime()
    )
        ? d.getTime()
        : 0;
}

function stateMeta(stato) {
    return STATE_META[stato]
        ||
        STATE_META.integrazione_documenti;
}

function nomePratica(d = {}, idCliente = "") {
    const names = [
        d.cliente_nome_completo || d.nomeCliente || "",
        d.cliente2_nome_completo || d.nomeCliente2 || ""
    ]
        .map(x => String(x || "").trim())
        .filter(Boolean);

    return names.length
        ? names.join(" · ")
        : String(idCliente || "")
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
}

function fasiHtml(step) {
    const labels = [
        "Richiesta",
        "Istruttoria",
        "Banca / Delibera",
        "Perizia",
        "Notaio / Atto",
        "Stipula"
    ];

    return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
        ${labels.map((label, index) => {
            let bg = "#e3e8ee";
            let fg = "#7d8790";
            let tc = "#8a949e";
            let val = String(index + 1);

            if (index < step) {
                bg = "#002d72";
                fg = "#ffffff";
                tc = "#002d72";
                val = "✓";
            }
            else if (index === step) {
                bg = "#C99700";
                fg = "#ffffff";
                tc = "#8a6800";
            }

            return `
            <td align="center" width="16.66%" valign="top">
                <div style="
                    width:28px;height:28px;line-height:28px;border-radius:50%;
                    background:${bg};color:${fg};font-size:11px;font-weight:bold;margin:auto;
                ">${val}</div>
                <div style="
                    font-size:8px;color:${tc};font-weight:bold;margin-top:6px;line-height:1.2;
                ">${esc(label.toUpperCase())}</div>
            </td>`;
        }).join("")}
        </tr>
    </table>`;
}

function documentiMancanti(d = {}) {
    const richiesti =
        Array.isArray(d.elencoDocRichiesti)
            ? d.elencoDocRichiesti
            : [];

    const versioni =
        Array.isArray(d.documenti_versione_richiesta)
            ? d.documenti_versione_richiesta
            : [];

    return richiesti.filter(code => {
        const raw =
            String(code || "")
                .replace(/^doc_/, "");

        const presente =
            d[`doc_${raw}`] === true
            ||
            d[raw] === true;

        return (
            !presente
            ||
            versioni.includes(raw)
        );
    });
}

function allComplete(d = {}) {
    return (
        Array.isArray(d.elencoDocRichiesti)
        &&
        d.elencoDocRichiesti.length > 0
        &&
        documentiMancanti(d).length === 0
    );
}

function backofficeEmail(d = {}) {
    return String(
        d.email_backoffice
        ||
        d.campo_email_auto
        ||
        d.emailBackoffice
        ||
        d.email_automazione
        ||
        ""
    ).trim();
}

async function consulenteEmail(d = {}) {
    const direct =
        String(
            d.consulente_email
            ||
            d.email_consulente
            ||
            d.referente_email
            ||
            ""
        ).trim();

    if (direct) {
        return direct;
    }

    const uid =
        d.consulente_uid
        ||
        d.owner_uid
        ||
        d.uid_consulente
        ||
        d.workspace_uid
        ||
        "";

    if (!uid) {
        return "";
    }

    const snap =
        await db.collection("consulenti")
            .doc(uid)
            .get();

    if (!snap.exists) {
        return "";
    }

    const c =
        snap.data() || {};

    return String(
        c.email
        ||
        c.mail
        ||
        c.email_lavoro
        ||
        ""
    ).trim();
}

function layoutEmail({
    d,
    idCliente,
    audience,
    title,
    subtitle,
    actionTitle,
    actionText,
    nextStep,
    ctaLabel,
    ctaUrl,
    missing = []
}) {
    const stato =
        d.stato_pratica
        ||
        "integrazione_documenti";

    const meta =
        stateMeta(stato);

    const nome =
        nomePratica(
            d,
            idCliente
        );

    return `
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)}</title>
</head>

<body style="margin:0;padding:0;background:#eef2f6;font-family:Arial,Helvetica,sans-serif;color:#27313a;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2f6">
<tr>
<td align="center" style="padding:30px 12px;">

<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="max-width:720px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e3e8ee;">

<tr>
<td bgcolor="#002d72" style="padding:27px 32px 24px;border-bottom:5px solid #C99700;">

    <img
        src="https://consulenza-credipass.it/images/logo-credipass.png"
        width="175"
        alt="Credipass"
    >

    <div style="
        margin-top:21px;
        font-size:10px;
        color:#C99700;
        font-weight:bold;
        text-transform:uppercase;
        letter-spacing:.8px;
    ">${esc(audience)}</div>

    <div style="
        margin-top:7px;
        color:#fff;
        font-size:24px;
        font-weight:bold;
    ">${esc(title)}</div>

    <div style="
        margin-top:7px;
        color:#cbd7e6;
        font-size:12px;
        line-height:1.55;
    ">${esc(subtitle)}</div>

</td>
</tr>

<tr>
<td style="padding:23px 32px 18px;">
    <div style="
        background:#f7f9fc;
        border:1px solid #e3e8ee;
        border-radius:12px;
        padding:17px 19px;
    ">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
                <td>
                    <div style="
                        font-size:10px;
                        color:#7a858f;
                        font-weight:bold;
                        text-transform:uppercase;
                    ">Avanzamento pratica</div>

                    <div style="
                        font-size:13px;
                        color:#002d72;
                        font-weight:bold;
                        margin-top:5px;
                    ">${esc(meta.label)}</div>
                </td>

                <td align="right" style="
                    font-size:21px;
                    color:#002d72;
                    font-weight:bold;
                ">${meta.pct}%</td>
            </tr>
        </table>

        <div style="
            height:9px;
            background:#e4e9ef;
            border-radius:999px;
            overflow:hidden;
            margin-top:10px;
        ">
            <div style="
                width:${meta.pct}%;
                height:9px;
                background:#C99700;
            "></div>
        </div>

        <div style="margin-top:14px;">
            ${fasiHtml(meta.step)}
        </div>
    </div>
</td>
</tr>

<tr>
<td style="padding:0 32px 18px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
            <td width="50%" valign="top" style="padding-right:7px;">
                <div style="
                    background:#eef5ff;
                    border:1px solid #d6e2f1;
                    border-radius:11px;
                    padding:15px;
                ">
                    <div style="
                        font-size:9px;
                        color:#6d7e93;
                        font-weight:bold;
                        text-transform:uppercase;
                    ">Situazione attuale</div>

                    <div style="
                        font-size:12px;
                        color:#002d72;
                        font-weight:bold;
                        margin-top:6px;
                    ">${missing.length} documento/i ancora da completare</div>
                </div>
            </td>

            <td width="50%" valign="top" style="padding-left:7px;">
                <div style="
                    background:#fff9e8;
                    border:1px solid #f0d88b;
                    border-radius:11px;
                    padding:15px;
                ">
                    <div style="
                        font-size:9px;
                        color:#8a6800;
                        font-weight:bold;
                        text-transform:uppercase;
                    ">${esc(actionTitle)}</div>

                    <div style="
                        font-size:12px;
                        color:#775a00;
                        font-weight:bold;
                        margin-top:6px;
                    ">${esc(actionText)}</div>
                </div>
            </td>
        </tr>
    </table>
</td>
</tr>

${missing.length ? `
<tr>
<td style="padding:0 32px 18px;">
    <div style="
        font-size:11px;
        color:#002d72;
        font-weight:bold;
        text-transform:uppercase;
        margin-bottom:10px;
    ">Documenti ancora mancanti</div>

    <div style="
        border:1px solid #e4e9ef;
        border-radius:10px;
        padding:13px 15px;
        color:#53606b;
        font-size:11px;
        line-height:1.7;
    ">
        ${missing.map(x => `• ${esc(String(x).replace(/^doc_/, ""))}`).join("<br>")}
    </div>
</td>
</tr>` : ""}

<tr>
<td style="padding:0 32px 18px;">
    <div style="
        background:#f7f9fc;
        border:1px solid #e5eaf0;
        border-radius:10px;
        padding:14px 15px;
    ">
        <div style="
            font-size:9px;
            color:#7a858f;
            font-weight:bold;
            text-transform:uppercase;
        ">Prossimo passaggio</div>

        <div style="
            font-size:12px;
            color:#002d72;
            font-weight:bold;
            margin-top:6px;
        ">${esc(nextStep)}</div>
    </div>
</td>
</tr>

<tr>
<td align="center" style="padding:2px 32px 31px;">
    <a
        href="${ctaUrl}"
        style="
            display:inline-block;
            background:#002d72;
            color:#ffffff;
            text-decoration:none;
            padding:15px 28px;
            border-radius:8px;
            font-size:12px;
            font-weight:bold;
            border-bottom:4px solid #C99700;
        "
    >${esc(ctaLabel)}</a>
</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>`;
}

async function sendEmail(to, subject, html) {
    if (!to) {
        return false;
    }

    const response =
        await fetch(
            SEND_EMAIL_ENDPOINT,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        to: [to],
                        subject,
                        html
                    })
            }
        );

    if (!response.ok) {
        throw new Error(
            `Email non inviata (${response.status})`
        );
    }

    return true;
}

async function inviaReminderInternoSeScaduto(doc, d, now) {
    if (
        d.stato_reminder_attivo !== true
        ||
        d.stato_reminder_inviato === true
    ) {
        return;
    }

    const due =
        millis(
            d.stato_reminder_data
        );

    if (
        !due
        ||
        now < due
    ) {
        return;
    }

    /*
     * Il reminder è valido soltanto finché la pratica
     * è ancora nello stesso stato per cui è stato creato.
     */
    if (
        d.stato_reminder_stato
        &&
        d.stato_pratica !==
            d.stato_reminder_stato
    ) {
        await doc.ref.set({
            stato_reminder_attivo:
                false
        }, { merge: true });

        return;
    }

    const bo =
        backofficeEmail(d);

    const consulente =
        await consulenteEmail(d);

    const dashboardUrl =
        `${APP_ORIGIN}/main/dashboard-consulente.html?clienteId=${encodeURIComponent(doc.id)}`;

    const motivo =
        String(
            d.stato_motivo
            ||
            "Verificare la pratica"
        );

    const html =
        layoutEmail({
            d,
            idCliente:
                doc.id,
            audience:
                "Dashboard pratica · Promemoria interno",
            title:
                "Promemoria pratica",
            subtitle:
                `È arrivata la data impostata per verificare la pratica: ${motivo}`,
            actionTitle:
                "Azione richiesta",
            actionText:
                "Aprire la pratica e verificare se è possibile procedere o aggiornare il reminder.",
            nextStep:
                "Aggiornare stato, motivo o nuova data promemoria",
            ctaLabel:
                "APRI DASHBOARD PRATICA",
            ctaUrl:
                dashboardUrl,
            missing:
                documentiMancanti(d)
        });

    try {
        if (bo) {
            await sendEmail(
                bo,
                `Promemoria pratica - ${nomePratica(d, doc.id)}`,
                html
            );
        }

        if (
            consulente
            &&
            consulente !== bo
        ) {
            await sendEmail(
                consulente,
                `Promemoria pratica - ${nomePratica(d, doc.id)}`,
                html
            );
        }

        await doc.ref.set({
            stato_reminder_inviato:
                true,

            stato_reminder_inviato_il:
                admin.firestore.FieldValue.serverTimestamp(),

            stato_reminder_attivo:
                false
        }, { merge: true });
    }
    catch (error) {
        logger.error(
            "Errore reminder interno",
            {
                idCliente:
                    doc.id,

                error:
                    error.message
            }
        );
    }
}

exports.controllaReminderDocumenti =
onSchedule(
    {
        schedule:
            "every 1 hours",

        timeZone:
            "Europe/Rome",

        region:
            "us-central1"
    },

    async () => {
        const now =
            Date.now();

        /*
         * 1) Reminder interni su tutte le pratiche che ne hanno uno attivo.
         */
        const internalSnap =
            await db.collection("pratiche_mutuo")
                .where(
                    "stato_reminder_attivo",
                    "==",
                    true
                )
                .get();

        for (
            const doc of
            internalSnap.docs
        ) {
            await inviaReminderInternoSeScaduto(
                doc,
                doc.data() || {},
                now
            );
        }

        /*
         * 2) Reminder documentali sulle integrazioni attive.
         */
        const snap =
            await db.collection("pratiche_mutuo")
                .where(
                    "richiestaIntegrazioneAttiva",
                    "==",
                    true
                )
                .get();

        for (
            const doc of
            snap.docs
        ) {
            const d =
                doc.data() || {};

            const idCliente =
                doc.id;

            /*
             * SOSPESA = pausa totale reminder documentali.
             * Il reminder interno dello stato sospeso resta invece attivo.
             */
            if (
                d.stato_pratica ===
                    "sospesa"
                ||
                d.documentReminderPausa ===
                    true
            ) {
                continue;
            }

            const missing =
                documentiMancanti(
                    d
                );

            if (
                allComplete(d)
            ) {
                await doc.ref.set({
                    richiestaIntegrazioneAttiva:
                        false,

                    documentReminderAttivo:
                        false,

                    documentReminderCompletatoIl:
                        admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                continue;
            }

            const cliente =
                String(
                    d.cliente_email
                    ||
                    ""
                ).trim();

            const requestedAt =
                millis(
                    d.documentReminderRichiestoIl
                    ||
                    d.ultimoAggiornamentoIntegrazione
                );

            const lastReminderAt =
                millis(
                    d.documentReminderUltimoInvioIl
                )
                ||
                requestedAt;

            /*
             * REMINDER 48 ORE
             * Parte dalla richiesta integrazione, non dal primo upload.
             * Continua finché manca almeno un documento.
             */
            if (
                requestedAt
                &&
                now - lastReminderAt >= HOURS_48
                &&
                cliente
            ) {
                const clientUrl =
                    `${APP_ORIGIN}/upload.html?id=${encodeURIComponent(idCliente)}`;

                const reminderHtml =
                    layoutEmail({
                        d,
                        idCliente,
                        audience:
                            "Area Cliente · Promemoria documentazione",
                        title:
                            "Completiamo la documentazione",
                        subtitle:
                            `Restano ancora ${missing.length} documento/i da completare per poter proseguire con la pratica.`,
                        actionTitle:
                            "Cosa devi fare tu",
                        actionText:
                            "Caricare i documenti ancora mancanti",
                        nextStep:
                            "Completamento e verifica della documentazione",
                        ctaLabel:
                            "CONTINUA IL CARICAMENTO",
                        ctaUrl:
                            clientUrl,
                        missing
                    });

                try {
                    await sendEmail(
                        cliente,
                        `Promemoria documenti - ${nomePratica(d, idCliente)}`,
                        reminderHtml
                    );

                    await doc.ref.set({
                        documentReminderUltimoInvioIl:
                            admin.firestore.FieldValue.serverTimestamp(),

                        documentReminderAttivo:
                            true
                    }, { merge: true });
                }
                catch (error) {
                    logger.error(
                        "Errore reminder 48 ore",
                        {
                            idCliente,
                            error:
                                error.message
                        }
                    );
                }
            }

            /*
             * ESCALATION 7 GIORNI
             * Se dopo 7 giorni la documentazione è ANCORA incompleta,
             * indipendentemente da quanti file siano stati già caricati,
             * invia una sola richiesta di supporto.
             */
            if (
                requestedAt
                &&
                now - requestedAt >= DAYS_7
                &&
                missing.length > 0
                &&
                d.documentReminderHelpInviato !== true
            ) {
                const bo =
                    backofficeEmail(d);

                const consulente =
                    await consulenteEmail(d);

                const clientUrl =
                    `${APP_ORIGIN}/upload.html?id=${encodeURIComponent(idCliente)}`;

                const dashboardUrl =
                    `${APP_ORIGIN}/main/dashboard-consulente.html?clienteId=${encodeURIComponent(idCliente)}`;

                const clientHtml =
                    layoutEmail({
                        d,
                        idCliente,
                        audience:
                            "Area Cliente · Supporto documentazione",
                        title:
                            "Hai bisogno di aiuto con i documenti?",
                        subtitle:
                            `La documentazione richiesta non risulta ancora completa. Mancano ${missing.length} documento/i.`,
                        actionTitle:
                            "Come possiamo aiutarti",
                        actionText:
                            "Apri l'Area Cliente oppure contatta il tuo consulente se hai difficoltà nel reperire o caricare i documenti.",
                        nextStep:
                            "Completamento della documentazione",
                        ctaLabel:
                            "APRI AREA CLIENTE",
                        ctaUrl:
                            clientUrl,
                        missing
                    });

                const staffHtml =
                    layoutEmail({
                        d,
                        idCliente,
                        audience:
                            "Dashboard pratica · Supporto documentazione",
                        title:
                            "Documentazione ancora incompleta",
                        subtitle:
                            `Dopo 7 giorni dalla richiesta risultano ancora mancanti ${missing.length} documento/i.`,
                        actionTitle:
                            "Azione consigliata",
                        actionText:
                            "Contattare il cliente per verificare se necessita supporto.",
                        nextStep:
                            "Contatto cliente / completamento documentazione",
                        ctaLabel:
                            "APRI DASHBOARD PRATICA",
                        ctaUrl:
                            dashboardUrl,
                        missing
                    });

                try {
                    if (cliente) {
                        await sendEmail(
                            cliente,
                            "Serve aiuto con la documentazione?",
                            clientHtml
                        );
                    }

                    if (bo) {
                        await sendEmail(
                            bo,
                            `Documentazione incompleta - ${nomePratica(d, idCliente)}`,
                            staffHtml
                        );
                    }

                    if (
                        consulente
                        &&
                        consulente !== bo
                    ) {
                        await sendEmail(
                            consulente,
                            `Cliente da verificare - ${nomePratica(d, idCliente)}`,
                            staffHtml
                        );
                    }

                    await doc.ref.set({
                        documentReminderHelpInviato:
                            true,

                        documentReminderHelpInviatoIl:
                            admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }
                catch (error) {
                    logger.error(
                        "Errore escalation 7 giorni",
                        {
                            idCliente,
                            error:
                                error.message
                        }
                    );
                }
            }
        }
    }
);
