const genericExtractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    valido: { type: "boolean" },
    motivo_errore: { type: "string" },
    note_documento: { type: "string" },
  },
  required: ["valido", "motivo_errore", "note_documento"],
};

module.exports = { genericExtractionSchema };
