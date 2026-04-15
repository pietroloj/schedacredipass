const OpenAI = require("openai");
const fs = require("fs");
const { persistTempFile } = require("../utils/files");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "dummy" }) || "dummy_key";

const MODELS = {
  FAST: process.env.OPENAI_MODEL_FAST || "gpt-5.4-mini",
  MAIN: process.env.OPENAI_MODEL_MAIN || "gpt-5.4",
};

async function uploadFileToOpenAI(dataUrl) {
  const { tmpPath, mimeType, bytes, sha256 } = await persistTempFile(dataUrl);
  try {
    const uploaded = await client.files.create({
      file: fs.createReadStream(tmpPath),
      purpose: "user_data",
    });
    return { fileId: uploaded.id, mimeType, bytes, sha256 };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

function buildContentItemForFile({ originalBase64, fileId, mimeType, label }) {
  if (mimeType === "application/pdf") {
    return [
      { type: "input_text", text: label },
      { type: "input_file", file_id: fileId },
    ];
  }
  return [
    { type: "input_text", text: label },
    { type: "input_image", image_url: originalBase64, detail: "high" },
  ];
}

async function uploadAndPrepareContents(files) {
  const results = [];
  for (const file of files) {
    const upload = await uploadFileToOpenAI(file.base64);
    const label = file.side === "front" ? "FILE FRONTE" : file.side === "back" ? "FILE RETRO" : "FILE DOCUMENTO";
    results.push({
      side: file.side || "single",
      originalBase64: file.base64,
      ...upload,
      contentItems: buildContentItemForFile({
        originalBase64: file.base64,
        fileId: upload.fileId,
        mimeType: upload.mimeType,
        label,
      }),
    });
  }
  return results;
}

async function structuredCall({ model, schemaName, schema, systemText, userText, contentItems }) {
  const response = await client.responses.create({
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: systemText }] },
      { role: "user", content: [{ type: "input_text", text: userText }, ...contentItems] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema,
      },
    },
  });
  return JSON.parse(response.output_text);
}

module.exports = { client, MODELS, uploadAndPrepareContents, structuredCall };
