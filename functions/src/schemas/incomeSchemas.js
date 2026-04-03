const incomeExtractionSchema = {
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
        anno_fiscale: { type: "string" },
        reddito_lordo_annuo: { type: "string" },
        irpef: { type: "string" },
        addizionale_regionale: { type: "string" },
        addizionale_comunale: { type: "string" },
        contributi_previdenziali_lavoratore: { type: "string" },
        data_assunzione: { type: "string" },
        tempo_indeterminato: { type: "boolean" },
        giorni_lavorati: { type: "string" },
        netto_mensile_rilevato_documento: { type: "string" },
        cessione_del_quinto_presente: { type: "boolean" },
        pignoramento_presente: { type: "boolean" },
        valore_isee: { type: "string" },
        protocollo_isee: { type: "string" },
        validita_isee: { type: "string" },
      },
      required: [
        "anno_fiscale", "reddito_lordo_annuo", "irpef", "addizionale_regionale",
        "addizionale_comunale", "contributi_previdenziali_lavoratore", "data_assunzione",
        "tempo_indeterminato", "giorni_lavorati", "netto_mensile_rilevato_documento",
        "cessione_del_quinto_presente", "pignoramento_presente", "valore_isee",
        "protocollo_isee", "validita_isee",
      ],
    },
    criticita_documentali: { type: "array", items: { type: "string" } },
    punti_forza_documentali: { type: "array", items: { type: "string" } },
    note_analista: { type: "string" },
  },
  required: [
    "valido", "motivo_errore", "tipo_documento_rilevato", "dati_estratti",
    "criticita_documentali", "punti_forza_documentali", "note_analista",
  ],
};

module.exports = { incomeExtractionSchema };
