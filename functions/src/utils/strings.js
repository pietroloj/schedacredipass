const crypto = require("crypto");

function stripNumericSuffix(v = "") {
  return String(v).replace(/[0-9]/g, "");
}

function safeString(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function notEmpty(v) {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

function sha256String(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { stripNumericSuffix, safeString, notEmpty, sha256String, nowIso };
