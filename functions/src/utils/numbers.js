function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(
    String(value)
      .trim()
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "")
  );
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatNumberIT(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

module.exports = { normalizeNumber, round2, formatNumberIT };
