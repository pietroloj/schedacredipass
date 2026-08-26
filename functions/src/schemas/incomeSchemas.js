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

        /*
         * CERTIFICAZIONE UNICA / CUD
         */
        reddito_lordo_annuo: { type: "string" },
        irpef: { type: "string" },
        addizionale_regionale: { type: "string" },

        // CU punti 26, 27 e 29: devono restare separati.
        addizionale_comunale_acconto_anno: { type: "string" },
        addizionale_comunale_saldo_anno: { type: "string" },
        addizionale_comunale_acconto_anno_successivo: { type: "string" },

        giorni_lavorati: { type: "string" },

        /*
         * DATO INFORMATIVO.
         * Non viene sottratto una seconda volta dal reddito fiscale CU.
         */
        contributi_previdenziali_lavoratore: { type: "string" },

        data_assunzione: { type: "string" },
        tempo_indeterminato: { type: "boolean" },

        /*
         * BUSTA PAGA: utile come controllo, non sostituisce il calcolo CU.
         */
        netto_mensile_rilevato_documento: { type: "string" },

        cessione_del_quinto_presente: { type: "boolean" },
        pignoramento_presente: { type: "boolean" },

        /*
         * MODELLO REDDITI / UNICO.
         * Vengono estratti ma NON usati con la formula CU.
         */
        reddito_complessivo_unico: { type: "string" },
        reddito_imponibile_unico: { type: "string" },
        imposta_netta_unico: { type: "string" },
        contributi_deducibili_unico: { type: "string" },

        /*
         * ISEE
         */
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
        "giorni_lavorati",
        "contributi_previdenziali_lavoratore",
        "data_assunzione",
        "tempo_indeterminato",
        "netto_mensile_rilevato_documento",
        "cessione_del_quinto_presente",
        "pignoramento_presente",
        "reddito_complessivo_unico",
        "reddito_imponibile_unico",
        "imposta_netta_unico",
        "contributi_deducibili_unico",
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
