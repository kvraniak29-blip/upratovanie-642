// bd642_firebase_messaging.js
// FCM pre BD 642 – bezpečná verzia pre PC aj mobily
// - žiadne useServiceWorker()
// - rozumné kontroly podpory (desktop, Android, iOS)
// - vráti objekt { ok: true/false, dovod, token }

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

  // Pomocný helper na čistý výsledok
  function resultFail(code) {
    return { ok: false, dovod: code || "INA_CHYBA" };
  }

  // --- Základná kontrola: firebase skripty musia byť načítané ---
  if (typeof firebase === "undefined") {
    console.error(
      "BD642 FCM: objekt 'firebase' nie je dostupný – skontroluj includy firebase-app-compat.js a firebase-messaging-compat.js v index.html."
    );
    window.BD642_ZapnutUpozornenia = async function () {
      return resultFail("FIREBASE_CHYBA");
    };
    window.BD642_FCM = {
      refreshToken: async function () {
        return null;
      },
      ulozTokenManualne: function () {}
    };
    return;
  }

  // Inicializácia Firebase app (ak ešte neprebehla)
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri firebase.initializeApp:", e);
  }

  // --- Kontrola podpory FCM v danom prostredí ---
  var messaging = null;
  var fcmSupported = false;

  try {
    if (firebase.messaging && typeof firebase.messaging.isSupported === "function") {
      // Novšie prostredia – bezpečnejšie zistiť podporu
      fcmSupported = firebase.messaging.isSupported();
    } else if (firebase.messaging) {
      // Starší compat – predpokladáme podporu, ale ešte to odfiltrujeme podľa SW/Push nižšie
      fcmSupported = true;
    } else {
      fcmSupported = false;
    }

    if (!fcmSupported) {
      console.warn("BD642 FCM: firebase.messaging.isSupported() = false.");
    } else {
      messaging = firebase.messaging();
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri získaní messaging inštancie:", e);
    fcmSupported = false;
  }

  // Firestore – VOLITEĽNÉ (ak nemáš firebase-firestore-compat.js, db ostane null)
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
        "BD642 FCM: firebase.firestore nie je k dispozícii – tokeny sa budú len logovať do konzoly."
      );
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri inicializácii Firestore:", e);
  }

  // --- Uloženie tokenu (ak je Firestore dostupný) ---
  async function ulozTokenDoFirestore(token) {
    console.log("BD642 FCM token:", token);
    console.log(
      "Tento token si môžeš uložiť do databázy – zatiaľ je len v konzole, ak Firestore nie je dostupný."
    );

    if (!db) return;

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
        "BD642 FCM: token uložený do Firestore do kolekcie 'fcm_tokens'."
      );
    } catch (e) {
      console.error(
        "BD642 FCM: chyba pri ukladaní FCM tokenu do Firestore:",
        e
      );
    }
  }

  // --- Hlavná logika pre získanie tokenu ---
  async function vnutorneZapnutUpozornenia() {
    // 0) Podpora základných API (desktop / Android Chrome)
    if (
      typeof Notification === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      console.warn(
        "BD642 FCM: Prehliadač nepodporuje kombináciu Notification + ServiceWorker + PushManager."
      );
      return resultFail("NEPODPOROVANE");
    }

    if (!fcmSupported || !messaging) {
      console.warn("BD642 FCM: messaging nie je podporovaný v tomto prostredí.");
      return resultFail("NEPODPOROVANE");
    }

    // 1) Povolenie notifikácií
    if (Notification.permission === "denied") {
      console.warn("BD642 FCM: notifikácie sú zamietnuté v prehliadači.");
      return resultFail("NEPOVOLENE");
    }

    if (Notification.permission !== "granted") {
      try {
        var perm = await Notification.requestPermission();
        if (perm !== "granted") {
          console.warn("BD642 FCM: používateľ nepovolil notifikácie.");
          return resultFail("NEPOVOLENE");
        }
      } catch (e) {
        console.error("BD642 FCM: chyba pri žiadaní povolenia:", e);
        return resultFail("INA_CHYBA");
      }
    }

    // 2) Service worker – použijeme aktuálny controlling SW, ak existuje
    var swReg = null;
    try {
      swReg = await navigator.serviceWorker.getRegistration();
      if (!swReg) {
        // fallback – počkáme na ready (ak inde registruješ SW)
        swReg = await navigator.serviceWorker.ready;
      }
    } catch (e) {
      console.warn(
        "BD642 FCM: problém so získaním service worker registrácie:",
        e
      );
    }

    // 3) Získanie tokenu – BEZ useServiceWorker()
    try {
      var getTokenOptions = { vapidKey: vapidPublicKey };
      if (swReg) {
        getTokenOptions.serviceWorkerRegistration = swReg;
      }

      var currentToken = await messaging.getToken(getTokenOptions);

      if (!currentToken) {
        console.warn(
          "BD642 FCM: token sa nepodarilo získať (prázdny výsledok)."
        );
        return resultFail("TOKEN_CHYBA");
      }

      await ulozTokenDoFirestore(currentToken);
      console.log("BD642 FCM: token získaný a spracovaný.");
      return { ok: true, token: currentToken };
    } catch (err) {
      console.error("BD642 FCM: chyba pri získavaní FCM tokenu:", err);
      return resultFail("INA_CHYBA");
    }
  }

  // Foreground správy – len logujeme
  if (messaging) {
    try {
      messaging.onMessage(function (payload) {
        console.log("BD642 FCM: prijatá správa (foreground):", payload);
      });
    } catch (e) {
      console.error("BD642 FCM: chyba v onMessage handleri:", e);
    }
  }

  // --- Export do globálu, aby na to vedel siahnuť index.html ---

  window.BD642_ZapnutUpozornenia = async function () {
    try {
      return await vnutorneZapnutUpozornenia();
    } catch (e) {
      console.error("BD642 FCM: neošetrená chyba:", e);
      return resultFail("INA_CHYBA");
    }
  };

  window.BD642_FCM = {
    refreshToken: async function () {
      var r = await vnutorneZapnutUpozornenia();
      return r && r.ok ? r.token : null;
    },
    ulozTokenManualne: ulozTokenDoFirestore
  };
})();
