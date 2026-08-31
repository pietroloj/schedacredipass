/*
|--------------------------------------------------------------------------
| FIREBASE FRONTEND - CONFIGURAZIONE CENTRALIZZATA
|--------------------------------------------------------------------------
|
| IMPORTANTE:
| - questa è la configurazione WEB Firebase;
| - NON contiene GOOGLE_OAUTH_CLIENT_SECRET;
| - NON contiene OPENAI_API_KEY;
| - NON contiene password Gmail;
| - i segreti reali restano lato Firebase Secret Manager.
|
| Tutte le pagine devono caricare:
|
|   /main/config/app.js
|   /main/config/firebase.js
|
| dopo i Firebase SDK.
|
*/

(function initCredipassFirebase() {

  if (
    typeof firebase ===
    "undefined"
  ) {
    throw new Error(
      "Firebase SDK non caricato prima di /main/config/firebase.js"
    );
  }

  const firebaseConfig = {
    apiKey:
      "AIzaSyDDRWJpEhFb2zBB9MlkbEel_9cXOTTKBJ4",

    authDomain:
      "consulenza-credipass.firebaseapp.com",

    projectId:
      "consulenza-credipass",

    storageBucket:
      "consulenza-credipass.firebasestorage.app",
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(
      firebaseConfig
    );
  }

  const region =
    window.CREDIPASS_APP_CONFIG
      ?.firebaseFunctionsRegion
    ||
    "us-central1";

  window.CREDIPASS_FIREBASE = Object.freeze({
    config:
      Object.freeze(
        {
          ...firebaseConfig,
        }
      ),

    app:
      firebase.app(),

    auth:
      typeof firebase.auth ===
        "function"
        ? firebase.auth()
        : null,

    db:
      typeof firebase.firestore ===
        "function"
        ? firebase.firestore()
        : null,

    storage:
      typeof firebase.storage ===
        "function"
        ? firebase.storage()
        : null,

    functions:
      typeof firebase.functions ===
        "function"
        ? firebase
            .app()
            .functions(
              region
            )
        : null,

    region,
  });

})();
