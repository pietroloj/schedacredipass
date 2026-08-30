const fs = require("fs");
const path = require("path");

const required = [
  "functions/src/services/openaiClient.js",
  "functions/src/services/classifiers.js",
  "functions/src/services/extractors.identity.js",
  "functions/src/services/extractors.income.js",
  "functions/src/services/extractors.bank.js",
  "functions/src/services/extractors.realEstate.js",
  "functions/src/services/practiceIncomeCalculator.js",
  "functions/src/services/practiceFinancialCalculator.js",
];

let failed = false;

for (const file of required) {
  if (!fs.existsSync(path.resolve(file))) {
    console.error(`❌ File AI mancante: ${file}`);
    failed = true;
  }
  else {
    console.log(`✅ ${file}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log("");
console.log("🎉 Struttura AI presente.");
