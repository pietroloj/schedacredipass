const { ImapFlow } = require("imapflow");
const nodemailer = require("nodemailer");

const user =
  String(process.env.GMAIL_USER || "").trim();

const pass =
  String(process.env.GMAIL_APP_PASSWORD || "")
    .replace(/\s+/g, "");

if (!user || !pass) {
  console.error("❌ Mancano GMAIL_USER o GMAIL_APP_PASSWORD.");
  process.exit(2);
}

async function testImap() {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user,
      pass
    },
    logger: false
  });

  await client.connect();

  try {
    const lock =
      await client.getMailboxLock("INBOX");

    try {
      const status =
        client.mailbox;

      console.log("✅ IMAP: connessione riuscita");
      console.log(
        `✅ INBOX accessibile. Messaggi visibili: ${Number(status?.exists || 0)}`
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

      if (sent?.path) {
        console.log(
          `✅ Cartella Posta inviata trovata: ${sent.path}`
        );
      }
      else {
        console.log(
          "⚠️ Cartella Posta inviata non individuata automaticamente."
        );
      }
    }
    finally {
      lock.release();
    }
  }
  finally {
    await client.logout().catch(() => {});
  }
}

async function testSmtp() {
  const transporter =
    nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user,
        pass
      }
    });

  await transporter.verify();

  console.log(
    "✅ SMTP: autenticazione riuscita. Il server accetta la casella."
  );

  console.log(
    "ℹ️ Il test NON ha inviato alcuna email."
  );
}

(async () => {
  console.log(
    `Test Gmail per: ${user.replace(/^(.{2}).*(@.*)$/, "$1***$2")}`
  );

  try {
    await testImap();
  }
  catch(error) {
    console.error(
      "❌ IMAP fallito:",
      error?.message || error
    );
    process.exitCode = 1;
    return;
  }

  try {
    await testSmtp();
  }
  catch(error) {
    console.error(
      "❌ SMTP fallito:",
      error?.message || error
    );
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("🎉 TEST COMPLETATO: IMAP + SMTP DISPONIBILI.");
})();
