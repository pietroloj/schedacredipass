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
        regime_fiscale: { type: "string" },

        /*
         * CU / CUD - DIPENDENTI E PENSIONATI
         */
        reddito_lordo_annuo: { type: "string" },
        irpef: { type: "string" },
        addizionale_regionale: { type: "string" },
        addizionale_comunale_acconto_anno: { type: "string" },
        addizionale_comunale_saldo_anno: { type: "string" },
        addizionale_comunale_acconto_anno_successivo: { type: "string" },
        giorni_lavorati: { type: "string" },

        data_assunzione: { type: "string" },
        tempo_indeterminato: { type: "boolean" },
        qualifica_quadro_dirigente: { type: "boolean" },

        /*
         * BUSTA PAGA
         * stipendio_lordo_mensile_ordinario deve contenere SOLO:
         * stipendio base + contingenza + superminimo.
         */
        stipendio_lordo_mensile_ordinario: { type: "string" },
        numero_mensilita: { type: "string" },
        contributi_previdenziali_percentuale_bp: { type: "string" },

        /*
         * Questi tre campi servono al calcolo BP.
         * L'AI deve trascriverli solo se già disponibili/calcolati
         * nel documento o nel contesto: non deve inventare aliquote.
         */
        irpef_annua_calcolata_bp: { type: "string" },
        addizionale_regionale_annua_bp: { type: "string" },
        addizionale_comunale_annua_bp: { type: "string" },

        netto_mensile_rilevato_documento: { type: "string" },

        /*
         * TRASFERTE
         */
        importo_trasferte_periodo: { type: "string" },
        numero_buste_paga_trasferte: { type: "string" },

        cessione_del_quinto_presente: { type: "boolean" },
        pignoramento_presente: { type: "boolean" },

        /*
         * MODELLO REDDITI / UNICO - ORDINARIO STANDARD
         */
        rn1: { type: "string" },
        rn3: { type: "string" },
        rn26: { type: "string" },
        rv2: { type: "string" },
        rv10: { type: "string" },

        /*
         * FORFETTARIO
         */
        lm36: { type: "string" },

        /*
         * CONCORDATO PREVENTIVO BIENNALE - FORFETTARIO
         */
        lm34: { type: "string" },
        lm35: { type: "string" },

        /*
         * CONCORDATO PREVENTIVO BIENNALE - ORDINARIO
         */
        concordato_preventivo_biennale: { type: "boolean" },
        cp10: { type: "string" },
        cp_oneri_deducibili: { type: "string" },
        cp_imposta_netta: { type: "string" },
        cp_addizionale_regionale: { type: "string" },
        cp_addizionale_comunale: { type: "string" },

        /*
         * REGOLE SINGOLO MODELLO UNICO
         */
        anno_attivita_incompleto: { type: "boolean" },
        modello_unico_singolo_ammissibile: { type: "boolean" },

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
        "regime_fiscale",

        "reddito_lordo_annuo",
        "irpef",
        "addizionale_regionale",
        "addizionale_comunale_acconto_anno",
        "addizionale_comunale_saldo_anno",
        "addizionale_comunale_acconto_anno_successivo",
        "giorni_lavorati",
        "data_assunzione",
        "tempo_indeterminato",
        "qualifica_quadro_dirigente",

        "stipendio_lordo_mensile_ordinario",
        "numero_mensilita",
        "contributi_previdenziali_percentuale_bp",
        "irpef_annua_calcolata_bp",
        "addizionale_regionale_annua_bp",
        "addizionale_comunale_annua_bp",
        "netto_mensile_rilevato_documento",
        "importo_trasferte_periodo",
        "numero_buste_paga_trasferte",

        "cessione_del_quinto_presente",
        "pignoramento_presente",

        "rn1",
        "rn3",
        "rn26",
        "rv2",
        "rv10",

        "lm36",
        "lm34",
        "lm35",

        "concordato_preventivo_biennale",
        "cp10",
        "cp_oneri_deducibili",
        "cp_imposta_netta",
        "cp_addizionale_regionale",
        "cp_addizionale_comunale",

        "anno_attivita_incompleto",
        "modello_unico_singolo_ammissibile",

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
