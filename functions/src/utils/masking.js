function maskValue(value = "", visibleStart = 3, visibleEnd = 2) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (s.length <= visibleStart + visibleEnd) return "*".repeat(s.length);
  return `${s.slice(0, visibleStart)}${"*".repeat(s.length - visibleStart - visibleEnd)}${s.slice(-visibleEnd)}`;
}

function maskSensitiveIdentityFields(dati = {}) {
  return {
    ...dati,
    codice_fiscale: maskValue(dati.codice_fiscale, 3, 2),
    numero_documento: maskValue(dati.numero_documento, 2, 2),
  };
}

module.exports = { maskValue, maskSensitiveIdentityFields };
