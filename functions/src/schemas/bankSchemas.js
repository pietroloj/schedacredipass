const bankExtractionSchema = {
  type: "object",
  additionalProperties: false,

  properties: {
    valido: { type: "boolean" },
    motivo_errore: { type: "string" },
    tipo_documento_rilevato: { type: "string" },

    saldo_negativo_o_scoperti: { type: "boolean" },

    stipendi_rilevati: {
      type: "array",
      items: { type: "string" }
    },

    rate_rilevate: {
      type: "array",
      items: { type: "string" }
    },

    movimenti_gambling_rilevati: {
      type: "array",
      items: { type: "string" }
    },

    movimenti_ricorrenti: {
      type: "array",
      items: { type: "string" }
    },

    criticita_documentali: {
      type: "array",
      items: { type: "string" }
    },

    punti_forza_documentali: {
      type: "array",
      items: { type: "string" }
    },

    note_analista: { type: "string" }
  },

  required: [
    "valido",
    "motivo_errore",
    "tipo_documento_rilevato",
    "saldo_negativo_o_scoperti",
    "stipendi_rilevati",
    "rate_rilevate",
    "movimenti_gambling_rilevati",
    "movimenti_ricorrenti",
    "criticita_documentali",
    "punti_forza_documentali",
    "note_analista"
  ]
};

module.exports = { bankExtractionSchema };
