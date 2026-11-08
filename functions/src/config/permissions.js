const ROLE_DEFAULT_PERMISSIONS = {
  admin: {
    crea_pratiche: true,
    vede_rete: true,
    vede_scheda_consulenza: true,
    modifica_scheda_consulenza: true,
    modifica_operazione_mutuo: true,
    vede_documenti: true,
    carica_documenti: true,
    elimina_documenti: true,
    richiede_integrazioni: true,
    cambia_stato: true,
    vede_timeline: true,
    modifica_timeline: true,
    gestisce_reminder: true,
    invia_email: true,
    vede_ai: true,
    usa_ai: true,
    vede_bank_matching: true,
    gestisce_utenti: true,
    vede_report_rete: true
  },

  responsabile: {
    crea_pratiche: true,
    vede_rete: true,
    vede_scheda_consulenza: true,
    modifica_scheda_consulenza: true,
    modifica_operazione_mutuo: true,
    vede_documenti: true,
    carica_documenti: true,
    elimina_documenti: true,
    richiede_integrazioni: true,
    cambia_stato: true,
    vede_timeline: true,
    modifica_timeline: true,
    gestisce_reminder: true,
    invia_email: true,
    vede_ai: true,
    usa_ai: true,
    vede_bank_matching: true,
    gestisce_utenti: false,
    vede_report_rete: true
  },

  consulente: {
    crea_pratiche: true,
    vede_rete: false,
    vede_scheda_consulenza: true,
    modifica_scheda_consulenza: true,
    modifica_operazione_mutuo: true,
    vede_documenti: true,
    carica_documenti: true,
    elimina_documenti: true,
    richiede_integrazioni: true,
    cambia_stato: true,
    vede_timeline: true,
    modifica_timeline: true,
    gestisce_reminder: true,
    invia_email: true,
    vede_ai: true,
    usa_ai: true,
    vede_bank_matching: true,
    gestisce_utenti: false,
    vede_report_rete: false
  },

  collaboratore: {
    crea_pratiche: true,
    vede_rete: false,
    vede_scheda_consulenza: true,
    modifica_scheda_consulenza: true,
    modifica_operazione_mutuo: true,
    vede_documenti: true,
    carica_documenti: true,
    elimina_documenti: false,
    richiede_integrazioni: true,
    cambia_stato: true,
    vede_timeline: true,
    modifica_timeline: true,
    gestisce_reminder: true,
    invia_email: true,
    vede_ai: true,
    usa_ai: false,
    vede_bank_matching: false,
    gestisce_utenti: false,
    vede_report_rete: false
  },

  segreteria: {
    crea_pratiche: false,
    vede_rete: true,
    vede_scheda_consulenza: false,
    modifica_scheda_consulenza: false,
    modifica_operazione_mutuo: false,
    vede_documenti: true,
    carica_documenti: true,
    elimina_documenti: false,
    richiede_integrazioni: true,
    cambia_stato: true,
    vede_timeline: true,
    modifica_timeline: true,
    gestisce_reminder: true,
    invia_email: true,
    vede_ai: false,
    usa_ai: false,
    vede_bank_matching: false,
    gestisce_utenti: false,
    vede_report_rete: false
  },

  segnalatore: {
    crea_pratiche: false,
    vede_rete: false,
    vede_scheda_consulenza: false,
    modifica_scheda_consulenza: false,
    modifica_operazione_mutuo: false,
    vede_documenti: false,
    carica_documenti: false,
    elimina_documenti: false,
    richiede_integrazioni: false,
    cambia_stato: false,
    vede_timeline: false,
    modifica_timeline: false,
    gestisce_reminder: false,
    invia_email: false,
    vede_ai: false,
    usa_ai: false,
    vede_bank_matching: false,
    gestisce_utenti: false,
    vede_report_rete: false
  }
};

for (const [role, values] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
  values.pagina_archivio = role !== 'segnalatore';
  values.pagina_area_operativa = role !== 'segnalatore';
  values.pagina_dashboard = role !== 'segnalatore';
  values.pagina_gestionale = role !== 'segnalatore';
  values.pagina_notifiche = role !== 'segnalatore';
  values.pagina_email = role !== 'segnalatore';
  values.pagina_impostazioni = role !== 'segnalatore';
  values.pagina_provenienza = role !== 'segnalatore';
  values.pagina_agenzie = role === 'admin';
  values.vede_social_hub = !['segreteria','segnalatore'].includes(role);
}

function normalizeRole(role) {
  const r = String(role || "consulente").trim().toLowerCase();
  return ROLE_DEFAULT_PERMISSIONS[r] ? r : "consulente";
}

function mergePermissions(role, custom = {}) {
  const normalized = normalizeRole(role);
  return {
    ...ROLE_DEFAULT_PERMISSIONS[normalized],
    ...(custom && typeof custom === "object" ? custom : {})
  };
}

module.exports = {
  ROLE_DEFAULT_PERMISSIONS,
  normalizeRole,
  mergePermissions
};
