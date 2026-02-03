// bd642_firebase_messaging.js
// Jednoduchý modul pre FCM + uloženie tokenu do Firestore (ak je k dispozícii)

(function () {
  "use strict";

  // --- Firebase config – TENTO NECHAJ TAK, ako si mi poslal ---
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

  // --- Kontroly základov ---

  if (typeof firebase === "undefined") {
    console.error(
      "BD642 FCM: objekt 'firebase' nie je dostupný – skontroluj includy v index.html."
    );
    window.BD642_FCM = { initFailed: "firebase_missing" };
    return;
  }

  // Inicializácia aplikácie, ak ešte neprebehla
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
        "BD642 FCM: firebase.messaging nie je k dispozícii – skontroluj firebase-messaging-compat.js v index.html."
      );
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri získaní firebase.messaging()", e);
  }

  // Firestore je voliteľný – ak knižnica nie je načítaná, len logujeme token
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

  // --- Pomocné funkcie ---

  async function ulozTokenDoFirestore(token) {
    console.log("BD642 FCM token:", token);
    console.log(
      "Tento token si ulož (napr. do databázy/Firestore) – zatiaľ je len v konzole, ak Firestore nie je dostupný."
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

      // Zber "fcm_tokens", dokument = samotný token
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

  async function ziskajAFixniToken() {
    if (!messaging) {
      console.error(
        "BD642 FCM: messaging nie je inicializovaný, token nezískam."
      );
      return;
    }

    try {
      // Wait na service worker (ak ho používaš)
      if ("serviceWorker" in navigator) {
        try {
          await navigator.serviceWorker.ready;
        } catch (e) {
          console.warn(
            "BD642 FCM: serviceWorker.ready zlyhal, pokračujem aj tak:",
            e
          );
        }
      }

      var currentToken = await messaging.getToken({
        vapidKey: vapidPublicKey
      });

      if (currentToken) {
        await ulozTokenDoFirestore(currentToken);
      } else {
        console.warn(
          "BD642 FCM: Token sa nepodarilo získať (možno neudelené oprávnenia)."
        );
      }
    } catch (err) {
      console.error("BD642 FCM: chyba pri získavaní FCM tokenu:", err);
    }
  }

  // Reakcia na prichádzajúce správy (keď je stránka otvorená)
  if (messaging) {
    messaging.onMessage(function (payload) {
      console.log("BD642 FCM: prijatá správa (foreground):", payload);
    });
  }

  // --- Export do globálu, aby tvoja app mohla modul skontrolovať ---

  window.BD642_FCM = {
    refreshToken: ziskajAFixniToken,
    ulozTokenManualne: ulozTokenDoFirestore
  };

  // Hneď po načítaní sa pokúsime token získať a uložiť
  ziskajAFixniToken();
})();
