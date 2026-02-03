// bd642_firebase_messaging.js
// FCM pre BD 642 – web push (desktop + Android) + ukladanie tokenu (ak je Firestore)

(function () {
  "use strict";

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

  if (typeof firebase === "undefined") {
    console.error(
      "BD642 FCM: objekt 'firebase' nie je dostupný – skontroluj includy v index.html."
    );
    window.BD642_ZapnutUpozornenia = async function () {
      return { ok: false, dovod: "FIREBASE_CHYBA" };
    };
    window.BD642_FCM = { initFailed: "firebase_missing" };
    return;
  }

  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri firebase.initializeApp", e);
  }

  var messaging = null;
  try {
    if (firebase.messaging) {
      messaging = firebase.messaging();
    } else {
      console.error(
        "BD642 FCM: firebase.messaging nie je k dispozícii – skontroluj firebase-messaging.js."
      );
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri získaní firebase.messaging()", e);
  }

  var db = null;
  var fieldValue = null;

  try {
    if (firebase.firestore) {
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
        "BD642 FCM: firebase.firestore nie je k dispozícii – tokeny budú len v konzole."
      );
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri inicializácii Firestore", e);
  }

  var registeredServiceWorker = null;

  function setServiceWorker(reg) {
    registeredServiceWorker = reg;
  }

  async function ulozTokenDoFirestore(token) {
    console.log("BD642 FCM token:", token);

    if (!db) {
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

      await db.collection("fcm_tokens").doc(token).set(data, { merge: true });

      console.log(
        "BD642 FCM: Token uložený do Firestore do zberu 'fcm_tokens'."
      );
    } catch (e) {
      console.error(
        "BD642 FCM: chyba pri ukladaní FCM tokenu do Firestore:",
        e
      );
    }
  }

  async function ziskajAleboVytvorToken() {
    if (!messaging) {
      console.error("BD642 FCM: messaging nie je inicializovaný.");
      return { ok: false, dovod: "MESSAGING_CHYBA" };
    }

    try {
      if (registeredServiceWorker && messaging.useServiceWorker) {
        messaging.useServiceWorker(registeredServiceWorker);
      }

      var currentToken = await messaging.getToken({
        vapidKey: vapidPublicKey
      });

      if (!currentToken) {
        console.warn(
          "BD642 FCM: Token sa nepodarilo získať (pravdepodobne neudelené oprávnenia)."
        );
        return { ok: false, dovod: "TOKEN_PRAZDNY" };
      }

      await ulozTokenDoFirestore(currentToken);
      return { ok: true, token: currentToken };
    } catch (err) {
      console.error("BD642 FCM: chyba pri získavaní FCM tokenu:", err);
      return { ok: false, dovod: "VYNIMKA" };
    }
  }

  if (messaging) {
    messaging.onMessage(function (payload) {
      console.log("BD642 FCM: prijatá správa (foreground):", payload);
    });
  }

  async function zapnutUpozornenia() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      return { ok: false, dovod: "NEPODPOROVANE" };
    }

    var perm = Notification.permission;
    if (perm !== "granted") {
      try {
        perm = await Notification.requestPermission();
      } catch (e) {
        console.error("BD642 FCM: chyba pri requestPermission", e);
      }
    }

    if (perm !== "granted") {
      return { ok: false, dovod: "NEPOVOLENE" };
    }

    return await ziskajAleboVytvorToken();
  }

  window.BD642_ZapnutUpozornenia = zapnutUpozornenia;

  window.BD642_FCM = {
    setServiceWorker: setServiceWorker,
    refreshToken: ziskajAleboVytvorToken,
    ulozTokenManualne: ulozTokenDoFirestore
  };
})();
