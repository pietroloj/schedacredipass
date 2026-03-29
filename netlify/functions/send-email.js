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

    const { to, bcc, subject, html, replyTo } = data;

    if (!to || !subject || !html) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Campi obbligatori mancanti: to, subject, html",
        }),
      };
    }

    const result = await resend.emails.send({
      from: "consulenza@consulenza-credipass.it",
      to: Array.isArray(to) ? to : [to],
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
      subject,
      html,
      replyTo: replyTo || undefined,
    });

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
