const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

function parseMimeTypeFromDataUrl(dataUrl = "") {
  const match = dataUrl.match(/^data:([^;]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

function base64ToBuffer(dataUrlOrBase64) {
  const base64 = String(dataUrlOrBase64).includes("base64,")
    ? String(dataUrlOrBase64).split("base64,")[1]
    : String(dataUrlOrBase64);
  return Buffer.from(base64, "base64");
}

function extensionFromMime(mime = "") {
  const map = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
  };
  return map[mime] || ".bin";
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function mimeSupported(mime) {
  return [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ].includes(mime);
}

async function persistTempFile(dataUrl) {
  const mimeType = parseMimeTypeFromDataUrl(dataUrl);
  const ext = extensionFromMime(mimeType);
  const tmpPath = path.join(os.tmpdir(), `doc-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  const buffer = base64ToBuffer(dataUrl);
  fs.writeFileSync(tmpPath, buffer);
  return { tmpPath, mimeType, bytes: buffer.length, sha256: sha256Buffer(buffer) };
}

module.exports = {
  parseMimeTypeFromDataUrl,
  base64ToBuffer,
  extensionFromMime,
  sha256Buffer,
  mimeSupported,
  persistTempFile,
};
