const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Metodo non consentito" }),
      };
    }

    const data = JSON.parse(event.body || "{}");
    const { to, bcc, subject, html, replyTo, pdfBase64, pdfFileName } = data;

    if (!to || !subject || !html) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Campi obbligatori mancanti: to, subject, html",
        }),
      };
    }

    const emailPayload = {
      from: "Consulenza Credipass <consulenze@consulenza-credipass.it>",
      to: Array.isArray(to) ? to : [to],
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
      subject,
      html,
      replyTo: replyTo || undefined,
    };

    if (pdfBase64) {
      emailPayload.attachments = [
        {
          filename: pdfFileName || "Scheda_Consulenza.pdf",
          content: pdfBase64,
        },
      ];
    }

    const result = await resend.emails.send(emailPayload);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        result,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message || "Errore interno server",
      }),
    };
  }
};
