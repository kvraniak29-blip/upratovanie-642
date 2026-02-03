// bd642_firebase_messaging.js
// FCM pre BD 642 + funkcia BD642_ZapnutUpozornenia používaná z index.html

(function () {
  "use strict";

  // --- Firebase config (NEMENIŤ) ---
  var firebaseConfig = {
    apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
    authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
    projectId: "bd-642-26-upratovanie-d2851",
    storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
    messagingSenderId: "530262860262",
    appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
    measurementId: "G-1PB3714CD6"
  };

  var vapidPublicKey =
    "BHnnUHjr7ujW1Do0bJBbZqL8G9WmJsVmjE859krH6eS3uJ9YUSAex7cnjEJxATx2dXbcPN7Xv9zzppRDE4ZFWZw";

  // --- Kontrola, či je načítaný firebase z <script> v index.html ---

  if (typeof firebase === "undefined") {
    console.error(
      "BD642 FCM: objekt 'firebase' nie je dostupný – skontroluj includy firebase-app.js a firebase-messaging.js v index.html."
    );
    window.BD642_FCM = { initFailed: "firebase_missing" };
    // necháme aj tak definovanú BD642_ZapnutUpozornenia nižšie (vráti NEPODPOROVANE)
  }

  // Inicializácia aplikácie (ak ešte neprebehla)
  try {
    if (typeof firebase !== "undefined") {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri firebase.initializeApp:", e);
  }

  // Messaging inštancia
  var messaging = null;
  try {
    if (typeof firebase !== "undefined" && firebase.messaging) {
      messaging = firebase.messaging();
    } else {
      console.warn(
        "BD642 FCM: firebase.messaging nie je k dispozícii – skontroluj firebase-messaging.js."
      );
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri získaní firebase.messaging():", e);
  }

  // Firestore (VOLITEĽNÉ) – momentálne ho v index.html nesťahuješ,
  // takže db ostane null a token sa len vypíše do konzoly.
  var db = null;
  var fieldValue = null;

  try {
    if (typeof firebase !== "undefined" && firebase.firestore) {
      db = firebase.firestore();
      if (
        firebase.firestore.FieldValue &&
        typeof firebase.firestore.FieldValue.serverTimestamp === "function"
      ) {
        fieldValue = firebase.firestore.FieldValue;
      }
      console.log("BD642 FCM: Firestore inicializovaný.");
    } else {
      console.warn(
        "BD642 FCM: firebase.firestore nie je k dispozícii – tokeny sa budú len logovať do konzoly."
      );
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri inicializácii Firestore:", e);
  }

  // --- Pomocné funkcie ---

  async function ulozTokenDoFirestore(token) {
    console.log("BD642 FCM token:", token);
    console.log(
      "Tento token si môžeš uložiť do databázy – zatiaľ je len v konzole, ak Firestore nie je dostupný."
    );

    if (!db) {
      // Firestore nie je k dispozícii – nič ďalšie nerobíme
      return;
    }

    try {
      var teraz = new Date();
      var data = {
        token: token,
        prehliadac: navigator.userAgent || "",
        aktualizovane: teraz.toISOString()
      };

      if (fieldValue) {
        data.vytvoreneServerom = fieldValue.serverTimestamp();
      } else {
        data.vytvoreneLocal = teraz.toISOString();
      }

      // Kolekcia "fcm_tokens", dokument = samotný token
      await db.collection("fcm_tokens").doc(token).set(data, { merge: true });

      console.log(
        "BD642 FCM: token uložený do Firestore do kolekcie 'fcm_tokens'."
      );
    } catch (e) {
      console.error(
        "BD642 FCM: chyba pri ukladaní FCM tokenu do Firestore:",
        e
      );
    }
  }

  // --- Hlavná funkcia, ktorú volá UI z index.html ---

  async function zapnutUpozornenia() {
    // 1) Podpora Notification API
    if (typeof Notification === "undefined") {
      console.warn("BD642 FCM: Notification API nie je podporované.");
      return { ok: false, dovod: "NEPODPOROVANE" };
    }

    // 2) Povolenie notifikácií
    if (Notification.permission === "denied") {
      console.warn("BD642 FCM: notifikácie sú zamietnuté v prehliadači.");
      return { ok: false, dovod: "NEPOVOLENE" };
    }

    if (Notification.permission !== "granted") {
      try {
        var perm = await Notification.requestPermission();
        if (perm !== "granted") {
          console.warn("BD642 FCM: používateľ nepovolil notifikácie.");
          return { ok: false, dovod: "NEPOVOLENE" };
        }
      } catch (e) {
        console.error("BD642 FCM: chyba pri žiadaní povolenia:", e);
        return { ok: false, dovod: "INA_CHYBA" };
      }
    }

    // 3) Podpora FCM / service worker
    if (!messaging) {
      console.warn("BD642 FCM: messaging nie je inicializovaný.");
      return { ok: false, dovod: "NEPODPOROVANE" };
    }

    var swReg = null;
    if ("serviceWorker" in navigator) {
      try {
        swReg = await navigator.serviceWorker.ready;
      } catch (e) {
        console.warn(
          "BD642 FCM: serviceWorker.ready zlyhal, skúsime bez neho:",
          e
        );
      }
    } else {
      console.warn("BD642 FCM: service worker nie je podporovaný.");
    }

    // 4) Získanie tokenu
    try {
      var getTokenOptions = { vapidKey: vapidPublicKey };
      if (swReg) {
        // pre väčšinu prehliadačov funguje aj takto
        getTokenOptions.serviceWorkerRegistration = swReg;
      }

      var currentToken = await messaging.getToken(getTokenOptions);

      if (!currentToken) {
        console.warn(
          "BD642 FCM: token sa nepodarilo získať (prázdny výsledok)."
        );
        return { ok: false, dovod: "TOKEN_CHYBA" };
      }

      await ulozTokenDoFirestore(currentToken);

      console.log("BD642 FCM: token získaný a spracovaný.");
      return { ok: true, token: currentToken };
    } catch (err) {
      console.error("BD642 FCM: chyba pri získavaní FCM tokenu:", err);
      return { ok: false, dovod: "INA_CHYBA" };
    }
  }

  // Foreground správy – len logujeme
  if (messaging) {
    messaging.onMessage(function (payload) {
      console.log("BD642 FCM: prijatá správa (foreground):", payload);
    });
  }

  // --- Export do globálu, aby na to vedel siahnuť index.html ---

  window.BD642_ZapnutUpozornenia = zapnutUpozornenia;

  // Pomocný objekt, ak by si ho niekde používal
  window.BD642_FCM = {
    refreshToken: async function () {
      var r = await zapnutUpozornenia();
      return r && r.ok ? r.token : null;
    },
    ulozTokenManualne: ulozTokenDoFirestore
  };

  // NEspúšťam automaticky žiadne získavanie tokenu.
  // Token sa rieši až po kliknutí na "Zapnúť push" v UI.
})();
