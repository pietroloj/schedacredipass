const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin =
  require("firebase-admin");


if (!admin.apps.length) {
  admin.initializeApp();
}


const db =
  admin.firestore();


const SOURCE_CATEGORIES = [
  "agenzia_immobiliare",
  "passaparola",
  "diretto",
  "web",
  "altro",
];


function cleanText(
  value,
  max = 240
) {
  return String(
    value
    ??
    ""
  )
  .trim()
  .slice(
    0,
    max
  );
}


function normalizeSource(
  input = {}
) {

  const categoria =
    cleanText(
      input.categoria
    )
    .toLowerCase();

  if (
    !SOURCE_CATEGORIES
      .includes(
        categoria
      )
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Categoria provenienza non valida."
    );
  }

  const normalized = {
    categoria,

    agenziaId:
      null,

    agenziaNome:
      null,

    referenteId:
      null,

    referenteNome:
      null,

    segnalatoDa:
      null,

    tipoSegnalatore:
      null,

    canaleWeb:
      null,

    campagnaWeb:
      null,

    altroDettaglio:
      null,
  };


  if (
    categoria ===
    "agenzia_immobiliare"
  ) {

    normalized.agenziaId =
      cleanText(
        input.agenziaId
      )
      ||
      null;

    normalized.agenziaNome =
      cleanText(
        input.agenziaNome
      )
      ||
      null;

    normalized.referenteId =
      cleanText(
        input.referenteId
      )
      ||
      null;

    normalized.referenteNome =
      cleanText(
        input.referenteNome
      )
      ||
      null;

    if (
      !normalized.agenziaId
      &&
      !normalized.agenziaNome
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Per una pratica da agenzia immobiliare serve almeno il nome dell'agenzia."
      );
    }
  }


  if (
    categoria ===
    "passaparola"
  ) {
    normalized.segnalatoDa =
      cleanText(
        input.segnalatoDa
      )
      ||
      null;

    normalized.tipoSegnalatore =
      cleanText(
        input.tipoSegnalatore
      )
      ||
      null;
  }


  if (
    categoria ===
    "web"
  ) {
    normalized.canaleWeb =
      cleanText(
        input.canaleWeb
      )
      ||
      null;

    normalized.campagnaWeb =
      cleanText(
        input.campagnaWeb
      )
      ||
      null;
  }


  if (
    categoria ===
    "altro"
  ) {
    normalized.altroDettaglio =
      cleanText(
        input.altroDettaglio
      )
      ||
      null;
  }


  return normalized;
}


const salvaProvenienzaPratica =
  onCall(
    {
      region:
        "us-central1",
    },

    async request => {

      const uid =
        request.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "Accesso richiesto."
        );
      }

      const practiceId =
        cleanText(
          request.data
            ?.practiceId
        );

      if (!practiceId) {
        throw new HttpsError(
          "invalid-argument",
          "practiceId mancante."
        );
      }

      const provenienza =
        normalizeSource(
          request.data
            ?.provenienza
          ||
          {}
        );

      const practiceRef =
        db
          .collection(
            "pratiche_mutuo"
          )
          .doc(
            practiceId
          );

      await practiceRef.set(
        {
          provenienza: {
            ...provenienza,

            updatedAt:
              admin.firestore
                .FieldValue
                .serverTimestamp(),

            updatedBy:
              uid,
          },
        },
        {
          merge:
            true,
        }
      );

      /*
       * Se l'utente indica un'agenzia, la registriamo/aggiorniamo
       * anche nella rubrica agenzie per riutilizzarla in futuro.
       */
      if (
        provenienza
          .categoria ===
          "agenzia_immobiliare"
        &&
        provenienza
          .agenziaNome
      ) {

        const agencyId =
          provenienza
            .agenziaId
          ||
          provenienza
            .agenziaNome
            .toLowerCase()
            .normalize(
              "NFD"
            )
            .replace(
              /[\u0300-\u036f]/g,
              ""
            )
            .replace(
              /[^a-z0-9]+/g,
              "_"
            )
            .replace(
              /^_+|_+$/g,
              ""
            )
            .slice(
              0,
              120
            );

        await db
          .collection(
            "agenzie_immobiliari"
          )
          .doc(
            agencyId
          )
          .set(
            {
              nome:
                provenienza
                  .agenziaNome,

              attiva:
                true,

              updatedAt:
                admin.firestore
                  .FieldValue
                  .serverTimestamp(),
            },
            {
              merge:
                true,
            }
          );

      }


      attentionPractices.sort(
        (a, b) => {
          const scoreA =
            (a.ferma_oltre_7_giorni ? 100 : 0)
            + (a.documentazione_incompleta ? 50 : 0)
            + (a.da_istruire ? 20 : 0)
            + Number(a.giorni_inattivita || 0);

          const scoreB =
            (b.ferma_oltre_7_giorni ? 100 : 0)
            + (b.documentazione_incompleta ? 50 : 0)
            + (b.da_istruire ? 20 : 0)
            + Number(b.giorni_inattivita || 0);

          return scoreB - scoreA;
        }
      );


      return {
        ok:
          true,

        provenienza,
      };

    }
  );


const listaAgenzieImmobiliari =
  onCall(
    {
      region:
        "us-central1",
    },

    async request => {

      if (
        !request.auth?.uid
      ) {
        throw new HttpsError(
          "unauthenticated",
          "Accesso richiesto."
        );
      }

      const snap =
        await db
          .collection(
            "agenzie_immobiliari"
          )
          .where(
            "attiva",
            "==",
            true
          )
          .limit(
            500
          )
          .get();

      const agencies =
        snap.docs
          .map(
            doc => ({
              id:
                doc.id,

              nome:
                doc.data()
                  ?.nome
                ||
                doc.id,
            })
          )
          .sort(
            (
              a,
              b
            ) =>
              a.nome
                .localeCompare(
                  b.nome,
                  "it"
                )
          );

      return {
        ok:
          true,

        agencies,
      };

    }
  );


function getState(
  practice = {}
) {
  const candidates = [
    practice.stato_pratica,
    practice.stato,
    practice.workflowStatus,
  ];

  for (const value of candidates) {
    const clean = cleanText(value).toLowerCase();
    if (clean) return clean;
  }

  return "da_istruire";
}


function normalizePracticeSource(practice = {}) {
  /*
   * Fonte autorevole: i campi usati dalla Dashboard Consulente.
   * Manteniamo l'oggetto provenienza come fallback per compatibilità.
   */
  const legacy = practice.provenienza || {};
  const tipo = cleanText(practice.tipo_fonte_pratica).toUpperCase();

  if (tipo === "AGENZIA_IMMOBILIARE") {
    return {
      categoria: "agenzia_immobiliare",
      agenziaId: cleanText(legacy.agenziaId) || null,
      agenziaNome:
        cleanText(practice.segnalatore_riferimento)
        || cleanText(legacy.agenziaNome)
        || "Agenzia non specificata",
      referenteId: cleanText(legacy.referenteId) || null,
      referenteNome:
        cleanText(legacy.referenteNome)
        || cleanText(practice.segnalatore_riferimento)
        || null,
      email:
        cleanText(practice.segnalatore_email)
        || null,
    };
  }

  if (tipo === "SEGNALATORE") {
    return {
      categoria: "passaparola",
      segnalatoDa:
        cleanText(practice.segnalatore_riferimento)
        || cleanText(legacy.segnalatoDa)
        || null,
      email:
        cleanText(practice.segnalatore_email)
        || null,
    };
  }

  if (tipo === "DIRETTA") {
    return { categoria: "diretto" };
  }

  const legacyCategory =
    SOURCE_CATEGORIES.includes(cleanText(legacy.categoria).toLowerCase())
      ? cleanText(legacy.categoria).toLowerCase()
      : "diretto";

  return {
    ...legacy,
    categoria: legacyCategory,
  };
}


function latestPracticeActivityMillis(practice = {}) {
  const values = [
    practice.stato_pratica_aggiornato_il,
    practice.provenienza_aggiornata_il,
    practice.ultimo_aggiornamento_scheda,
    practice.ultimoAggiornamentoIntegrazione,
    practice.attivita_interna_aggiornata_il,
    practice.documentReminderUltimaAttivitaClienteIl,
    practice.documentReminderUltimoInvioIl,
    practice.updatedAt,
    practice.aggiornatoIl,
    practice.createdAt,
    practice.creatoIl,
  ];

  if (Array.isArray(practice.attivita_cliente_log)) {
    for (const event of practice.attivita_cliente_log) {
      if (event && event.data_ms) values.push(Number(event.data_ms));
    }
  }

  if (Array.isArray(practice.attivita_interne)) {
    for (const event of practice.attivita_interne) {
      if (event && event.creato_il) values.push(event.creato_il);
      if (event && event.data_ms) values.push(Number(event.data_ms));
    }
  }

  return Math.max(
    0,
    ...values.map(dateMillis).filter(Boolean)
  );
}


function practiceDocsIncomplete(practice = {}) {
  const required =
    Array.isArray(practice.documenti_richiesti_portale)
      ? practice.documenti_richiesti_portale
          .map(x => cleanText(x).replace(/^doc_/, ""))
          .filter(Boolean)
      : [];

  if (required.length) {
    return required.some(id => practice[`doc_${id}`] !== true);
  }

  if (practice.documentazioneCompleta === false) return true;
  if (practice.documentiCompleti === false) return true;

  return false;
}


function dateMillis(
  value
) {

  if (
    value
    &&
    typeof value.toMillis ===
      "function"
  ) {
    return value.toMillis();
  }

  if (
    typeof value === "number"
    &&
    Number.isFinite(value)
  ) {
    return value;
  }

  const parsed =
    new Date(
      value
      ||
      0
    )
    .getTime();

  return Number.isFinite(
    parsed
  )
    ? parsed
    : 0;
}


function practiceDisplayName(practice = {}) {
  const direct =
    cleanText(practice.nome_cliente)
    || cleanText(practice.cliente_nome)
    || cleanText(practice.nominativo)
    || cleanText(practice.nomeRichiedente)
    || cleanText(practice.nome_ricerca);

  if (direct) return direct;

  const full =
    [
      cleanText(practice.nome),
      cleanText(practice.cognome),
    ]
      .filter(Boolean)
      .join(" ");

  return full || cleanText(practice.id) || "Pratica";
}


function missingPracticeDocuments(practice = {}) {
  const required =
    Array.isArray(practice.documenti_richiesti_portale)
      ? practice.documenti_richiesti_portale
          .map(x => cleanText(x).replace(/^doc_/, ""))
          .filter(Boolean)
      : [];

  return required
    .filter(id => practice[`doc_${id}`] !== true)
    .map(id => id.replace(/_/g, " "));
}


function stateIsToProcess(state = "") {
  const s = cleanText(state).toLowerCase();

  return (
    !s
    || s === "non_definito"
    || s === "da_istruire"
    || s.includes("richiest")
    || s.includes("istruire")
    || s.includes("nuova")
    || s.includes("nuovo")
  );
}


function stateIsProcessing(state = "") {
  const s = cleanText(state).toLowerCase();

  return (
    s.includes("istruttor")
    || s.includes("lavoraz")
    || s.includes("caricat")
    || s.includes("banca")
  );
}


function buildAutomaticSuggestion({
  state,
  daysInactive,
  missingDocs = [],
  isStale = false,
  isIncomplete = false,
}) {
  const actions = [];

  if (stateIsToProcess(state)) {
    actions.push(
      "Avviare l'istruttoria: verificare anagrafica, finalità, importo richiesto e documentazione minima necessaria."
    );
  }

  if (isIncomplete) {
    if (missingDocs.length) {
      actions.push(
        `Richiedere o verificare i documenti mancanti: ${missingDocs.slice(0, 6).join(", ")}${missingDocs.length > 6 ? "…" : ""}.`
      );
    } else {
      actions.push(
        "Verificare la checklist documentale e richiedere le integrazioni ancora necessarie."
      );
    }
  }

  if (isStale) {
    actions.push(
      `La pratica non registra attività utile da ${daysInactive} giorni: contattare cliente/banca e registrare il prossimo passo nella timeline.`
    );
  }

  if (stateIsProcessing(state) && !isIncomplete) {
    actions.push(
      "Verificare se ci sono richieste pendenti della banca, esiti da sollecitare o passaggi successivi da pianificare."
    );
  }

  if (!actions.length) {
    actions.push(
      "Controllare lo stato corrente, l'ultima attività e definire il prossimo passaggio operativo."
    );
  }

  return actions.join(" ");
}


async function userCanAccessPractice(uid, profile, practice = {}) {
  const role =
    cleanText(profile?.ruolo).toLowerCase();

  if (role === "admin") return true;

  const ownerUid =
    cleanText(practice.consulente_uid)
    || cleanText(practice.workspace_uid)
    || cleanText(practice.owner_uid);

  if (!ownerUid) return false;
  if (ownerUid === uid) return true;

  const directVisible =
    Array.isArray(profile?.collaboratori_visibili)
      ? profile.collaboratori_visibili.map(x => cleanText(x)).filter(Boolean)
      : [];

  if (role === "responsabile") {
    if (directVisible.includes(ownerUid)) return true;

    const ownerSnap =
      await db.collection("consulenti").doc(ownerUid).get();

    return (
      ownerSnap.exists
      && cleanText(ownerSnap.data()?.responsabile_uid) === uid
    );
  }

  if (role === "segreteria") {
    if (directVisible.includes(ownerUid)) return true;

    const ownerSnap =
      await db.collection("consulenti").doc(ownerUid).get();

    if (!ownerSnap.exists) return false;

    const managerUid =
      cleanText(ownerSnap.data()?.responsabile_uid);

    return !!managerUid && directVisible.includes(managerUid);
  }

  return false;
}


const dashboardGestionaleDati =
  onCall(
    {
      region:
        "us-central1",
    },

    async request => {

      const uid =
        request.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "Accesso richiesto."
        );
      }

      /*
       * Recupera il profilo dell'utente autenticato.
       * Il report viene calcolato SOLO sul perimetro di pratiche
       * che il ruolo può effettivamente vedere.
       */
      const profileSnap =
        await db
          .collection("consulenti")
          .doc(uid)
          .get();

      if (!profileSnap.exists) {
        throw new HttpsError(
          "permission-denied",
          "Profilo consulente non trovato."
        );
      }

      const profile =
        profileSnap.data() || {};

      if (profile.attivo === false) {
        throw new HttpsError(
          "permission-denied",
          "Profilo consulente non attivo."
        );
      }

      const role =
        cleanText(
          profile.ruolo
        )
          .toLowerCase();

      const directVisible =
        Array.isArray(
          profile.collaboratori_visibili
        )
          ? profile.collaboratori_visibili
              .map(x => cleanText(x))
              .filter(Boolean)
          : [];

      /*
       * Carichiamo le pratiche e applichiamo il perimetro lato backend.
       * In questo modo NON basta modificare l'HTML per vedere dati
       * appartenenti ad altri consulenti.
       */
      const snap =
        await db
          .collection(
            "pratiche_mutuo"
          )
          .limit(
            5000
          )
          .get();

      const allPractices =
        snap.docs
          .map(
            doc => ({
              id:
                doc.id,

              ...(
                doc.data()
                ||
                {}
              ),
            })
          );

      let practices = [];

      if (role === "admin") {
        practices =
          allPractices;
      }

      else if (role === "consulente") {
        /*
         * CONSULENTE:
         * esclusivamente pratiche assegnate tramite consulente_uid.
         *
         * Per vecchie pratiche che non hanno ancora consulente_uid,
         * usiamo workspace_uid/owner_uid solo come fallback legacy.
         *
         * collega_segnalato_uid NON attribuisce visibilità.
         */
        practices =
          allPractices.filter(
            practice => {
              const consultantUid =
                cleanText(
                  practice.consulente_uid
                );

              const legacyOwnerUid =
                !consultantUid
                  ? cleanText(
                      practice.workspace_uid
                      ||
                      practice.owner_uid
                    )
                  : "";

              return (
                consultantUid
                ||
                legacyOwnerUid
              ) === uid;
            }
          );
      }

      else if (role === "responsabile") {
        /*
         * RESPONSABILE:
         * proprie pratiche + pratiche dei consulenti assegnati.
         *
         * Oltre a collaboratori_visibili leggiamo anche responsabile_uid
         * dai profili, così la nuova gerarchia resta la fonte autorevole.
         */
        const managedSnap =
          await db
            .collection("consulenti")
            .where(
              "responsabile_uid",
              "==",
              uid
            )
            .get();

        const managedUids =
          new Set(
            [
              uid,
              ...directVisible,
              ...managedSnap.docs.map(
                doc => doc.id
              ),
            ]
              .map(x => cleanText(x))
              .filter(Boolean)
          );

        practices =
          allPractices.filter(
            practice => {
              const consultantUid =
                cleanText(
                  practice.consulente_uid
                );

              const ownerUid =
                consultantUid
                ||
                cleanText(
                  practice.workspace_uid
                  ||
                  practice.owner_uid
                );

              return (
                !!ownerUid &&
                managedUids.has(ownerUid)
              );
            }
          );
      }

      else if (role === "segreteria") {
        /*
         * SEGRETERIA / BACKOFFICE:
         * - utenti assegnati direttamente;
         * - Responsabili assegnati;
         * - tutti i consulenti dei Responsabili assegnati.
         */
        const visibleUids =
          new Set(
            [
              uid,
              ...directVisible,
            ]
              .map(x => cleanText(x))
              .filter(Boolean)
          );

        const assignedManagers =
          new Set();

        for (const visibleUid of directVisible) {
          const visibleProfileSnap =
            await db
              .collection("consulenti")
              .doc(visibleUid)
              .get();

          if (!visibleProfileSnap.exists) {
            continue;
          }

          const visibleProfile =
            visibleProfileSnap.data() || {};

          if (
            cleanText(
              visibleProfile.ruolo
            ).toLowerCase() ===
            "responsabile"
          ) {
            assignedManagers.add(
              visibleUid
            );
          }
        }

        for (const managerUid of assignedManagers) {
          const teamSnap =
            await db
              .collection("consulenti")
              .where(
                "responsabile_uid",
                "==",
                managerUid
              )
              .get();

          teamSnap.docs.forEach(
            doc =>
              visibleUids.add(
                doc.id
              )
          );
        }

        practices =
          allPractices.filter(
            practice => {
              const consultantUid =
                cleanText(
                  practice.consulente_uid
                );

              const ownerUid =
                consultantUid
                ||
                cleanText(
                  practice.workspace_uid
                  ||
                  practice.owner_uid
                );

              return (
                !!ownerUid &&
                visibleUids.has(ownerUid)
              );
            }
          );
      }

      else {
        throw new HttpsError(
          "permission-denied",
          "Ruolo non autorizzato alla dashboard gestionale."
        );
      }

      const now =
        Date.now();

      const sevenDays =
        7
        *
        24
        *
        60
        *
        60
        *
        1000;

      const countsByState =
        {};

      const countsBySource = {
        agenzia_immobiliare:
          0,

        passaparola:
          0,

        diretto:
          0,

        web:
          0,

        altro:
          0,

        non_definito:
          0,
      };

      const agencyMap =
        new Map();

      let staleOver7Days =
        0;

      let incompleteDocs =
        0;

      let deliberate =
        0;

      let stipulated =
        0;

      const consultantMap =
        new Map();

      const attentionPractices = [];
      let toProcess = 0;
      let processing = 0;


      for (
        const practice of
        practices
      ) {

        const state =
          getState(
            practice
          );

        countsByState[
          state
        ] =
          (
            countsByState[
              state
            ]
            ||
            0
          )
          +
          1;

        if (
          state.includes(
            "deliber"
          )
        ) {
          deliberate +=
            1;
        }

        if (
          state.includes(
            "stipul"
          )
          ||
          state.includes(
            "atto"
          )
        ) {
          stipulated +=
            1;
        }

        const updated =
          latestPracticeActivityMillis(
            practice
          );

        if (
          updated
          &&
          now
          -
          updated
          >
          sevenDays
        ) {
          staleOver7Days +=
            1;
        }

        const isIncomplete =
          practiceDocsIncomplete(
            practice
          );

        if (isIncomplete) {
          incompleteDocs +=
            1;
        }

        if (stateIsToProcess(state)) {
          toProcess += 1;
        }

        if (stateIsProcessing(state)) {
          processing += 1;
        }

        const daysInactive =
          updated
            ? Math.max(
                0,
                Math.floor(
                  (now - updated)
                  /
                  (24 * 60 * 60 * 1000)
                )
              )
            : null;

        const isStale =
          !!updated
          &&
          now - updated > sevenDays;

        const missingDocs =
          missingPracticeDocuments(
            practice
          );

        const reasons = [];

        if (stateIsToProcess(state)) {
          reasons.push("Pratica da istruire");
        }

        if (isStale) {
          reasons.push(
            `Nessuna attività utile da ${daysInactive} giorni`
          );
        }

        if (isIncomplete) {
          reasons.push(
            missingDocs.length
              ? `${missingDocs.length} documenti richiesti risultano mancanti`
              : "Documentazione incompleta"
          );
        }

        if (reasons.length) {
          attentionPractices.push({
            id: practice.id,
            cliente: practiceDisplayName(practice),
            stato: state,
            consulente_uid:
              cleanText(practice.consulente_uid)
              || cleanText(practice.workspace_uid)
              || cleanText(practice.owner_uid),
            consulente_email:
              cleanText(practice.consulente_email),
            giorni_inattivita: daysInactive,
            ultima_attivita_ms: updated || null,
            ferma_oltre_7_giorni: isStale,
            documentazione_incompleta: isIncomplete,
            da_istruire: stateIsToProcess(state),
            documenti_mancanti: missingDocs,
            motivi: reasons,
            suggerimento_automatico:
              buildAutomaticSuggestion({
                state,
                daysInactive,
                missingDocs,
                isStale,
                isIncomplete,
              }),
          });
        }

        const source =
          normalizePracticeSource(
            practice
          );

        const category =
          SOURCE_CATEGORIES
            .includes(
              source.categoria
            )
              ? source.categoria
              : "non_definito";

        countsBySource[
          category
        ] +=
          1;


        if (
          category ===
          "agenzia_immobiliare"
        ) {

          const agencyName =
            source
              .agenziaNome
            ||
            "Agenzia non specificata";

          const key =
            source
              .agenziaId
            ||
            agencyName
              .toLowerCase();

          const current =
            agencyMap.get(
              key
            )
            ||
            {
              id:
                key,

              nome:
                agencyName,

              pratiche:
                0,

              delibere:
                0,

              stipule:
                0,

              referenti:
                new Set(),

              tempi:
                [],
            };

          current.pratiche +=
            1;

          if (
            state.includes(
              "deliber"
            )
          ) {
            current.delibere +=
              1;
          }

          if (
            state.includes(
              "stipul"
            )
            ||
            state.includes(
              "atto"
            )
          ) {
            current.stipule +=
              1;
          }

          if (
            source
              .referenteId
            ||
            source
              .referenteNome
          ) {
            current
              .referenti
              .add(
                source
                  .referenteId
                ||
                source
                  .referenteNome
              );
          }

          agencyMap.set(
            key,
            current
          );
        }

        const practiceConsultantUid =
          cleanText(
            practice.consulente_uid
            ||
            practice.workspace_uid
            ||
            practice.owner_uid
          );

        if (practiceConsultantUid) {
          const currentConsultant =
            consultantMap.get(
              practiceConsultantUid
            )
            ||
            {
              uid: practiceConsultantUid,
              nome:
                cleanText(practice.referente)
                || cleanText(practice.consulente_nome)
                || cleanText(practice.consulente_email)
                || practiceConsultantUid,
              email:
                cleanText(practice.consulente_email),
              pratiche: 0,
              delibere: 0,
              stipule: 0,
            };

          currentConsultant.pratiche += 1;

          if (state.includes("deliber")) {
            currentConsultant.delibere += 1;
          }

          if (
            state.includes("stipul")
            ||
            state.includes("atto")
          ) {
            currentConsultant.stipule += 1;
          }

          consultantMap.set(
            practiceConsultantUid,
            currentConsultant
          );
        }

      }


      /*
       * Completiamo nome/email dai profili consulenti, quando disponibili.
       */
      const consultants = [];

      for (const item of consultantMap.values()) {
        let nome = item.nome;
        let email = item.email;

        try {
          const consultantSnap =
            await db
              .collection("consulenti")
              .doc(item.uid)
              .get();

          if (consultantSnap.exists) {
            const consultantProfile =
              consultantSnap.data() || {};

            nome =
              [
                cleanText(consultantProfile.nome),
                cleanText(consultantProfile.cognome),
              ]
                .filter(Boolean)
                .join(" ")
              ||
              cleanText(consultantProfile.nome_completo)
              ||
              nome;

            email =
              cleanText(consultantProfile.email)
              ||
              email;
          }
        } catch (error) {
          console.warn(
            "Profilo consulente non disponibile:",
            item.uid,
            error
          );
        }

        consultants.push({
          ...item,
          nome,
          email,
          conversione:
            item.pratiche
              ? (
                  item.stipule
                  /
                  item.pratiche
                  *
                  100
                )
              : 0,
        });
      }

      consultants.sort(
        (a, b) =>
          b.pratiche - a.pratiche
          ||
          String(a.nome).localeCompare(
            String(b.nome),
            "it"
          )
      );


      const agencies =
        Array.from(
          agencyMap.values()
        )
        .map(
          agency => ({
            id:
              agency.id,

            nome:
              agency.nome,

            referentiAttivi:
              agency
                .referenti
                .size,

            pratiche:
              agency.pratiche,

            delibere:
              agency.delibere,

            stipule:
              agency.stipule,

            conversione:
              agency.pratiche
                ? (
                    agency.stipule
                    /
                    agency.pratiche
                    *
                    100
                  )
                : 0,
          })
        )
        .sort(
          (
            a,
            b
          ) =>
            b.pratiche
            -
            a.pratiche
        );


      return {
        ok:
          true,

        /*
         * Utile anche per verificare dal browser quale perimetro
         * è stato applicato senza esporre pratiche non autorizzate.
         */
        scope: {
          role,
          uid,
          practiceCount:
            practices.length,
        },

        totalPractices:
          practices.length,

        toProcess,

        processing,

        deliberate,

        stipulated,

        staleOver7Days,

        incompleteDocs,

        countsByState,

        countsBySource,

        agencies,

        consultants,

        attentionPractices,
      };

    }
  );


const dashboardPraticaSuggerimentoAI =
  onCall(
    {
      region: "us-central1",
      secrets: ["OPENAI_API_KEY"],
      timeoutSeconds: 60,
      memory: "256MiB",
    },

    async request => {
      const uid = request.auth?.uid;

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "Accesso richiesto."
        );
      }

      const practiceId =
        cleanText(request.data?.practiceId);

      if (!practiceId) {
        throw new HttpsError(
          "invalid-argument",
          "practiceId mancante."
        );
      }

      const [profileSnap, practiceSnap] =
        await Promise.all([
          db.collection("consulenti").doc(uid).get(),
          db.collection("pratiche_mutuo").doc(practiceId).get(),
        ]);

      if (!profileSnap.exists) {
        throw new HttpsError(
          "permission-denied",
          "Profilo utente non trovato."
        );
      }

      if (!practiceSnap.exists) {
        throw new HttpsError(
          "not-found",
          "Pratica non trovata."
        );
      }

      const profile = profileSnap.data() || {};
      const practice = {
        id: practiceSnap.id,
        ...(practiceSnap.data() || {}),
      };

      if (
        !(await userCanAccessPractice(
          uid,
          profile,
          practice
        ))
      ) {
        throw new HttpsError(
          "permission-denied",
          "Non puoi analizzare questa pratica."
        );
      }

      const state = getState(practice);
      const updated =
        latestPracticeActivityMillis(practice);
      const now = Date.now();
      const daysInactive =
        updated
          ? Math.max(
              0,
              Math.floor(
                (now - updated)
                /
                (24 * 60 * 60 * 1000)
              )
            )
          : null;

      const missingDocs =
        missingPracticeDocuments(practice);

      const context = {
        id: practice.id,
        cliente: practiceDisplayName(practice),
        stato: state,
        giorniInattivita: daysInactive,
        documentiMancanti: missingDocs,
        documentazioneIncompleta:
          practiceDocsIncomplete(practice),
        provenienza:
          normalizePracticeSource(practice),
        note:
          cleanText(
            practice.note_pratica
            || practice.note
            || practice.notePratica,
            1500
          ),
        ultimaAttivitaCliente:
          Array.isArray(practice.attivita_cliente_log)
            ? practice.attivita_cliente_log.slice(-5)
            : [],
        ultimeAttivitaInterne:
          Array.isArray(practice.attivita_interne)
            ? practice.attivita_interne.slice(-5)
            : [],
      };

      const apiKey =
        process.env.OPENAI_API_KEY;

      if (!apiKey) {
        throw new HttpsError(
          "failed-precondition",
          "OPENAI_API_KEY non configurata."
        );
      }

      const response =
        await fetch(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-5.6-luna",
              store: false,
              input: [
                {
                  role: "developer",
                  content:
                    "Sei un assistente operativo per pratiche di mutuo. Analizza esclusivamente i dati forniti. Non inventare documenti, esiti bancari o informazioni mancanti. Rispondi in italiano, in modo concreto e sintetico. Indica: 1) criticità rilevate; 2) prossime azioni consigliate in ordine pratico; 3) cosa verificare prima di contattare banca o cliente. Non dare garanzie di delibera o approvazione.",
                },
                {
                  role: "user",
                  content:
                    `Analizza questa pratica e suggerisci come portarla avanti:\\n${JSON.stringify(context, null, 2)}`,
                },
              ],
              max_output_tokens: 700,
            }),
          }
        );

      if (!response.ok) {
        const errorText =
          await response.text();

        console.error(
          "OpenAI dashboard suggestion:",
          response.status,
          errorText
        );

        throw new HttpsError(
          "internal",
          "Errore durante la generazione del suggerimento AI."
        );
      }

      const data =
        await response.json();

      const text =
        cleanText(
          data.output_text
          ||
          (Array.isArray(data.output)
            ? data.output
                .flatMap(item => item.content || [])
                .map(item => item.text || "")
                .filter(Boolean)
                .join("\\n")
            : ""),
          8000
        );

      return {
        ok: true,
        practiceId,
        generatedAt:
          new Date().toISOString(),
        text:
          text
          ||
          "Nessun suggerimento AI disponibile.",
      };
    }
  );


module.exports = {
  SOURCE_CATEGORIES,
  salvaProvenienzaPratica,
  listaAgenzieImmobiliari,
  dashboardGestionaleDati,
  dashboardPraticaSuggerimentoAI,
};
