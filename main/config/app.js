/*
|--------------------------------------------------------------------------
| CONFIGURAZIONE APPLICAZIONE - CONSULENZA CREDIPASS
|--------------------------------------------------------------------------
|
| Unico punto per URL e impostazioni frontend condivise.
|
*/

window.CREDIPASS_APP_CONFIG = Object.freeze({
  environment: "production",

  firebaseFunctionsRegion:
    "us-central1",

  publicBaseUrl:
    "https://consulenza-credipass.it",

  gmail: {
    connectionPage:
      "/main/gmail-connection.html",

    settingsPage:
      "/main/impostazioni.html",

    domainsPage:
      "/main/mail-domini.html",

    testPage:
      "/main/test-gmail-oauth.html",

    oauthCallback:
      "https://us-central1-consulenza-credipass.cloudfunctions.net/gmailOAuthCallback",

    functions: {
      connect:
        "creaCollegamentoGmail",

      status:
        "statoCollegamentoGmail",

      disconnect:
        "scollegaGmail",

      sync:
        "sincronizzaGmailPersonale",
    },
  },
});
