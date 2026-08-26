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
        tipo_reddito: { type: "string" },

        // CU / CUD
        reddito_lordo_annuo: { type: "string" },
        irpef: { type: "string" },
        addizionale_regionale: { type: "string" },

        // CU: punti 26, 27 e 29 tenuti distinti
        addizionale_comunale_acconto_anno: { type: "string" },
        addizionale_comunale_saldo_anno: { type: "string" },
        addizionale_comunale_acconto_anno_successivo: { type: "string" },

        // Informativo: non viene sottratto una seconda volta quando
        // il reddito del punto 1/2/3 è imponibile fiscale CU.
        contributi_previdenziali_lavoratore: { type: "string" },

        giorni_lavorati: { type: "string" },
        data_assunzione: { type: "string" },
        tempo_indeterminato: { type: "boolean" },

        // Solo controllo/coerenza, non fonte primaria del calcolo CU
        netto_mensile_rilevato_documento: { type: "string" },

        cessione_del_quinto_presente: { type: "boolean" },
        pignoramento_presente: { type: "boolean" },

        // ISEE
        valore_isee: { type: "string" },
        protocollo_isee: { type: "string" },
        validita_isee: { type: "string" }
      },

      required: [
        "anno_fiscale",
        "tipo_reddito",
        "reddito_lordo_annuo",
        "irpef",
        "addizionale_regionale",
        "addizionale_comunale_acconto_anno",
        "addizionale_comunale_saldo_anno",
        "addizionale_comunale_acconto_anno_successivo",
        "contributi_previdenziali_lavoratore",
        "giorni_lavorati",
        "data_assunzione",
        "tempo_indeterminato",
        "netto_mensile_rilevato_documento",
        "cessione_del_quinto_presente",
        "pignoramento_presente",
        "valore_isee",
        "protocollo_isee",
        "validita_isee"
      ]
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
    "dati_estratti",
    "criticita_documentali",
    "punti_forza_documentali",
    "note_analista"
  ]
};

module.exports = { incomeExtractionSchema };
