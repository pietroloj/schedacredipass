const { DOC_TYPES } = require("../config/documents");
const { stripNumericSuffix } = require("../utils/strings");
const { parseMimeTypeFromDataUrl, base64ToBuffer, mimeSupported } = require("../utils/files");

function getExpectedSides(codiceBase) {
  if (codiceBase === "doc_ci") return { front: true, back: true };
  if (codiceBase === "doc_ts") return { front: true, back: false };
  return { front: false, back: false };
}

function technicalPrecheck({ files, tipoDocumentoAtteso }) {
  const codiceBase = stripNumericSuffix(tipoDocumentoAtteso);
  const expectedSides = getExpectedSides(codiceBase);

  if (!DOC_TYPES.includes(codiceBase)) {
    return { ok: false, motivo: `Tipo documento non supportato: ${codiceBase}` };
  }
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, motivo: "Nessun file ricevuto." };
  }

  for (const file of files) {
    const mime = parseMimeTypeFromDataUrl(file.base64 || "");
    if (!mimeSupported(mime)) return { ok: false, motivo: `Formato file non supportato: ${mime}` };
    const buffer = base64ToBuffer(file.base64);
    if (!buffer || buffer.length < 500) return { ok: false, motivo: "File vuoto o non valido." };
  }

  if (expectedSides.front && !files.find((f) => f.side === "front")) return { ok: false, motivo: "Fronte mancante." };
  if (expectedSides.back && !files.find((f) => f.side === "back")) return { ok: false, motivo: "Retro mancante." };

  return { ok: true, motivo: "" };
}

module.exports = { technicalPrecheck, getExpectedSides };
