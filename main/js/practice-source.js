/*
|--------------------------------------------------------------------------
| WIDGET PROVENIENZA PRATICA
|--------------------------------------------------------------------------
|
| Può essere incluso nel form di creazione/modifica pratica.
|
*/

window.CredipassPracticeSource = {

  categories: [
    {
      value:
        "agenzia_immobiliare",

      label:
        "Agenzia immobiliare",
    },
    {
      value:
        "passaparola",

      label:
        "Passaparola",
    },
    {
      value:
        "diretto",

      label:
        "Diretto",
    },
    {
      value:
        "web",

      label:
        "Web",
    },
    {
      value:
        "altro",

      label:
        "Altro",
    },
  ],


  async save({
    practiceId,
    provenienza,
  }) {

    const fn =
      window
        .CREDIPASS_FIREBASE
        .functions;

    const callable =
      fn.httpsCallable(
        "salvaProvenienzaPratica"
      );

    const result =
      await callable({
        practiceId,
        provenienza,
      });

    return result.data;

  },


  async agencies() {

    const fn =
      window
        .CREDIPASS_FIREBASE
        .functions;

    const callable =
      fn.httpsCallable(
        "listaAgenzieImmobiliari"
      );

    const result =
      await callable();

    return result.data
      ?.agencies
      ||
      [];

  },

};
