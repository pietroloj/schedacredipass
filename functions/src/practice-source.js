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

  return String(
    practice.stato
    ??
    practice.stato_pratica
    ??
    practice.workflowStatus
    ??
    "non_definito"
  )
  .trim()
  .toLowerCase();
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
          dateMillis(
            practice.updatedAt
            ??
            practice.aggiornatoIl
            ??
            practice.createdAt
            ??
            practice.creatoIl
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

        if (
          practice
            .documentazioneCompleta ===
            false
          ||
          practice
            .documentiCompleti ===
            false
        ) {
          incompleteDocs +=
            1;
        }

        const source =
          practice.provenienza
          ||
          {};

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

      }


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

        deliberate,

        stipulated,

        staleOver7Days,

        incompleteDocs,

        countsByState,

        countsBySource,

        agencies,
      };

    }
  );


module.exports = {
  SOURCE_CATEGORIES,
  salvaProvenienzaPratica,
  listaAgenzieImmobiliari,
  dashboardGestionaleDati,
};
