const identityExtractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    valido: { type: "boolean" },
    motivo_errore: { type: "string" },
    tipo_documento_rilevato: { type: "string" },
    dati_estratti: {
      type: "object",
      additionalProperties: false,
      properties: {
        nome: { type: "string" },
        cognome: { type: "string" },
        codice_fiscale: { type: "string" },
        data_nascita: { type: "string" },
        luogo_nascita: { type: "string" },
        numero_documento: { type: "string" },
        data_rilascio: { type: "string" },
        data_scadenza: { type: "string" },
        ente_rilascio: { type: "string" },
        indirizzo_residenza: { type: "string" },
      },
      required: [
        "nome", "cognome", "codice_fiscale", "data_nascita", "luogo_nascita",
        "numero_documento", "data_rilascio", "data_scadenza", "ente_rilascio", "indirizzo_residenza",
      ],
    },
    campi_principali_legibili: { type: "boolean" },
    note_documento: { type: "string" },
  },
  required: ["valido", "motivo_errore", "tipo_documento_rilevato", "dati_estratti", "campi_principali_legibili", "note_documento"],
};

module.exports = { identityExtractionSchema };
