const bankExtractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    valido: { type: "boolean" },
    motivo_errore: { type: "string" },
    stipendi_rilevati: { type: "array", items: { type: "string" } },
    rate_rilevate: { type: "array", items: { type: "string" } },
    movimenti_ricorrenti: { type: "array", items: { type: "string" } },
    movimenti_gambling_rilevati: { type: "array", items: { type: "string" } },
    saldo_negativo_o_scoperti: { type: "boolean" },
    dati_finanziamento: {
      type: "object",
      additionalProperties: false,
      properties: {
        ente_finanziatore: { type: "string" },
        importo_originario: { type: "string" },
        rata_mensile: { type: "string" },
        residuo: { type: "string" },
        durata: { type: "string" },
        data_inizio: { type: "string" },
        estinzione_prevista: { type: "boolean" },
      },
      required: [
        "ente_finanziatore", "importo_originario", "rata_mensile",
        "residuo", "durata", "data_inizio", "estinzione_prevista",
      ],
    },
    note_prefattibilita: { type: "string" },
  },
  required: [
    "valido", "motivo_errore", "stipendi_rilevati", "rate_rilevate", "movimenti_ricorrenti",
    "movimenti_gambling_rilevati", "saldo_negativo_o_scoperti", "dati_finanziamento", "note_prefattibilita",
  ],
};

module.exports = { bankExtractionSchema };
