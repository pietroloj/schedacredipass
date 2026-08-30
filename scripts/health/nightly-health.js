const fs = require("fs");

const checks = [];

function add(name, ok, detail = "") {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
  });
}

function exists(path) {
  return fs.existsSync(path);
}

add(
  "Firebase Functions index",
  exists("functions/src/index.js")
);

add(
  "Firestore rules",
  exists("firestore.rules")
);

add(
  "Gmail OAuth",
  exists("functions/src/gmail-oauth.js")
);

add(
  "Gmail API Engine",
  exists("functions/src/gmail-api-engine.js")
);

add(
  "Mail Matcher",
  exists("functions/src/mail-matcher.js")
);

add(
  "Reminder documentali",
  exists("functions/src/document-reminders.js")
);

add(
  "Predelibera AI",
  exists("functions/src/services/openaiClient.js")
  &&
  exists("functions/src/services/practiceIncomeCalculator.js")
);

add(
  "CLIENT_ID GitHub secret",
  Boolean(process.env.CLIENT_ID)
);

add(
  "CLIENT_SECRET GitHub secret",
  Boolean(process.env.CLIENT_SECRET)
);

add(
  "FIREBASE_TOKEN GitHub secret",
  Boolean(process.env.FIREBASE_TOKEN)
);

console.log("");
console.log("==============================================");
console.log(" HEALTH CHECK GESTIONALE CREDIPASS");
console.log("==============================================");

for (const check of checks) {
  console.log(
    `${check.ok ? "✅" : "❌"} ${check.name}`
    +
    (
      check.detail
        ? ` - ${check.detail}`
        : ""
    )
  );
}

const failed =
  checks.filter(
    item =>
      !item.ok
  );

console.log("");
console.log(
  failed.length
    ? `❌ ${failed.length} controllo/i fallito/i`
    : "🎉 TUTTI I CONTROLLI SUPERATI"
);

if (failed.length) {
  process.exit(1);
}
