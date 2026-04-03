function classificationSchema(DOC_TYPES) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      valido: { type: "boolean" },
      tipo_documento_atteso: { type: "string", enum: DOC_TYPES },
      tipo_documento_rilevato: { type: "string", enum: [...DOC_TYPES, "altro", "non_determinabile"] },
      coerenza_documentale: { type: "boolean" },
      leggibile_umano: { type: "boolean" },
      gravemente_illeggibile: { type: "boolean" },
      confidenza_classificazione: { type: "integer", minimum: 0, maximum: 100 },
      documento_completo_inquadrato: { type: "boolean" },
      fronte_presente: { type: "boolean" },
      retro_presente: { type: "boolean" },
      problemi_oggettivi: { type: "array", items: { type: "string" } },
      motivo_errore: { type: "string" },
      note: { type: "string" },
    },
    required: [
      "valido", "tipo_documento_atteso", "tipo_documento_rilevato", "coerenza_documentale",
      "leggibile_umano", "gravemente_illeggibile", "confidenza_classificazione",
      "documento_completo_inquadrato", "fronte_presente", "retro_presente",
      "problemi_oggettivi", "motivo_errore", "note",
    ],
  };
}

function classificationRetrySchema(DOC_TYPES) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      tipo_documento_rilevato: { type: "string", enum: [...DOC_TYPES, "altro", "non_determinabile"] },
      coerenza_documentale: { type: "boolean" },
      gravemente_illeggibile: { type: "boolean" },
      confidenza_classificazione: { type: "integer", minimum: 0, maximum: 100 },
      motivo_errore: { type: "string" },
    },
    required: [
      "tipo_documento_rilevato", "coerenza_documentale", "gravemente_illeggibile",
      "confidenza_classificazione", "motivo_errore",
    ],
  };
}

module.exports = { classificationSchema, classificationRetrySchema };
