const assert = require("assert");

const {
  extractPracticeNumbers,
  domainMatches,
  normalizePracticeNumber,
} = require("../../functions/src/mail-matcher");

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  }
  catch (error) {
    console.error(`❌ ${name}`);
    throw error;
  }
}

test(
  "Rileva numero pratica da oggetto",
  () => {
    const nums =
      extractPracticeNumbers(
        "ING - Pratica 123456789 - ROSSI MARIO"
      );

    assert(
      nums.includes("123456789")
    );
  }
);

test(
  "Normalizza numero pratica",
  () => {
    assert.strictEqual(
      normalizePracticeNumber(
        " 12345/ABC "
      ),
      "12345/ABC"
    );
  }
);

test(
  "Riconosce sottodominio banca",
  () => {
    assert.strictEqual(
      domainMatches(
        "istruttorie.mediobancapremier.it",
        "mediobancapremier.it"
      ),
      true
    );
  }
);

test(
  "Riconosce dominio esteso Mediobanca Premier",
  () => {
    assert.strictEqual(
      domainMatches(
        "mediobancapremier.istruttorie.it",
        "mediobancapremier.istruttorie.it"
      ),
      true
    );
  }
);

console.log("");
console.log("🎉 Mail matcher: tutti i test superati.");
