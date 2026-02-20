/* global firebase */

// bd642_firebase_messaging.js
// BD642 – Firebase Messaging (FCM) klient (SDK v8)
// FIX: useServiceWorker + onTokenRefresh + robustnejšie dôvody/logy

(function () {
  "use strict";

  if (typeof firebase === "undefined") {
    console.error("BD642 FCM: firebase SDK nie je načítané.");
    window.BD642_FCM = { podporovane: false, dovod: "FIREBASE_CHYBA" };
    window.BD642_ZapnutUpozornenia = async () => ({ ok: false, dovod: "FIREBASE_CHYBA" });
    return;
  }

  var firebaseConfig = {
    apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
    authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
    projectId: "bd-642-26-upratovanie-d2851",
    storageBucket: "bd-642-26-upratovanie-d2851.appspot.com",
    messagingSenderId: "530262860262",
    appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
    measurementId: "G-2ZDWWZBKRR"
  };

  var vapidPublicKey =
    "BHnnUHjr7ujW1Do0bJBbZqL8G9WmJsVmjE859krH6eS3uJ9YUSAex7cnjEJxATx2dXbcPN7Xv9zzppRDE4ZFWZw";

  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      console.log("BD642 FCM: Firebase App inicializovaný.");
    }
  } catch (e) {
    console.error("BD642 FCM: firebase.initializeApp chyba:", e);
  }

  // Firestore
  var db = null;
  var FieldValue = null;
  try {
    if (firebase.firestore) {
      db = firebase.firestore();
      FieldValue = firebase.firestore.FieldValue || null;
    } else {
      console.warn("BD642 FCM: firestore SDK nie je načítané (firebase-firestore.js).");
    }
  } catch (e2) {
    console.error("BD642 FCM: firestore init chyba:", e2);
  }

  // Messaging support
  var messaging = null;
  var messagingPodporovane = false;

  try {
    if (firebase.messaging && typeof firebase.messaging.isSupported === "function") {
      messagingPodporovane = firebase.messaging.isSupported();
    } else if (firebase.messaging) {
      messagingPodporovane = true;
    }

    if (messagingPodporovane) {
      messaging = firebase.messaging();
    }
  } catch (e3) {
    console.error("BD642 FCM: messaging init chyba:", e3);
    messagingPodporovane = false;
    messaging = null;
  }

  if (!messagingPodporovane || !messaging) {
    window.BD642_FCM = { podporovane: false, dovod: "MESSAGING_NEPODPOROVANE" };
    window.BD642_ZapnutUpozornenia = async () => ({ ok: false, dovod: "MESSAGING_NEPODPOROVANE" });
    return;
  }

  function getRodinaPreToken() {
    try {
      var rodinaPrihlasena = (localStorage.getItem("bd642_meFamily") || "").trim();
      var rodinaPush = (localStorage.getItem("bd642_pushFamily") || "").trim();
      var rodina = rodinaPrihlasena || rodinaPush || "";
      if (rodinaPrihlasena && rodinaPrihlasena !== rodinaPush) {
        localStorage.setItem("bd642_pushFamily", rodinaPrihlasena);
      }
      return rodina || null;
    } catch (_) {
      return null;
    }
  }

  async function ulozTokenDoFirestore(token) {
    if (!db) return { ulozene: false, dovod: "FIRESTORE_NEDOSTUPNY" };

    try {
      var rodina = getRodinaPreToken();
      var rola = (localStorage.getItem("bd642_role") || "").trim() || null;

      var data = {
        token: token,
        rodina: rodina,
        rola: rola,
        userAgent: navigator.userAgent || "",
        jazyk: navigator.language || "",
        url: location.href || "",
        aktualizovane: new Date().toISOString(),
        aktualizovane_server:
          FieldValue && FieldValue.serverTimestamp ? FieldValue.serverTimestamp() : null
      };

      // globálne (debug/prehľad)
      await db.collection("fcm_tokens").doc(token).set(data, { merge: true });

      // dôležité pre Functions.tick (odtiaľ berie tokeny)
      if (rodina) {
        await db.collection("rodiny").doc(rodina).collection("fcm_tokens").doc(token).set(data, { merge: true });
      }

      return { ulozene: true, rodina: rodina || null };
    } catch (e) {
      console.error("BD642 FCM: ulozTokenDoFirestore chyba:", e);
      return { ulozene: false, dovod: "FIRESTORE_CHYBA", detail: String(e && e.message ? e.message : e) };
    }
  }

  async function getBd642ServiceWorkerRegistration() {
    if (!("serviceWorker" in navigator)) throw new Error("SW_NEPODPOROVANY");

    // najprv skús existujúci
    try {
      var regs = await navigator.serviceWorker.getRegistrations();
      for (var i = 0; i < regs.length; i++) {
        var reg = regs[i];
        var sw = (reg && (reg.active || reg.waiting || reg.installing)) || null;
        if (sw && sw.scriptURL && sw.scriptURL.indexOf("firebase-messaging-sw.js") !== -1) {
          return reg;
        }
      }
    } catch (_) {}

    // ak nie je, zaregistruj (relatívne k index.html)
    return await navigator.serviceWorker.register("./firebase-messaging-sw.js", { scope: "./" });
  }

  async function vnutorneZapnutUpozornenia() {
    // Notification API
    if (typeof Notification === "undefined") return { ok: false, dovod: "NOTIFICATION_API_NEDOSTUPNE" };
    if (Notification.permission === "denied") return { ok: false, dovod: "NOTIFICATION_ZABLOKOVANE" };

    if (!("serviceWorker" in navigator)) return { ok: false, dovod: "SERVICE_WORKER_NEPODPOROVANY" };
    if (!("PushManager" in window)) return { ok: false, dovod: "PUSHMANAGER_NEPODPOROVANY" };

    // Pozor: na iOS mimo Safari/PWA to často skončí ako nepodporované
    var perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, dovod: "NOTIFICATION_NEPOVOLENE" };

    try {
      var swReg = await getBd642ServiceWorkerRegistration();

      // DÔLEŽITÉ pre SDK v8 – spáruj messaging s týmto SW
      try {
        if (typeof messaging.useServiceWorker === "function") messaging.useServiceWorker(swReg);
      } catch (eUse) {
        console.warn("BD642 FCM: useServiceWorker zlyhalo (nie fatálne):", eUse);
      }

      var token = await messaging.getToken({
        vapidKey: vapidPublicKey,
        serviceWorkerRegistration: swReg
      });

      if (!token) return { ok: false, dovod: "TOKEN_PRAZDNY" };

      var uloz = await ulozTokenDoFirestore(token);
      if (!uloz.ulozene) {
        return { ok: true, token: token, upozornenie: "TOKEN_NEULOZENY_DO_FIRESTORE", detail: uloz.dovod || null };
      }

      return { ok: true, token: token };
    } catch (e) {
      console.error("BD642 FCM: zapnutie chyba:", e);
      return { ok: false, dovod: "CHYBA_ZAPNUTIA", detail: String(e && e.message ? e.message : e) };
    }
  }

  // Foreground správy (len log)
  try {
    messaging.onMessage(function (payload) {
      console.log("BD642 FCM: foreground message:", payload);
    });
  } catch (_) {}

  // Token refresh (SDK v8)
  try {
    if (typeof messaging.onTokenRefresh === "function") {
      messaging.onTokenRefresh(async function () {
        try {
          console.warn("BD642 FCM: token refresh – získavam nový token…");
          var swReg = await getBd642ServiceWorkerRegistration();
          try {
            if (typeof messaging.useServiceWorker === "function") messaging.useServiceWorker(swReg);
          } catch (_) {}
          var t = await messaging.getToken({ vapidKey: vapidPublicKey, serviceWorkerRegistration: swReg });
          if (t) await ulozTokenDoFirestore(t);
          console.warn("BD642 FCM: token refresh hotovo.");
        } catch (e) {
          console.error("BD642 FCM: token refresh chyba:", e);
        }
      });
    }
  } catch (_) {}

  window.BD642_ZapnutUpozornenia = async function () {
    return await vnutorneZapnutUpozornenia();
  };

  window.BD642_FCM = {
    podporovane: true,
    debug: function () {
      return {
        messagingPodporovane: true,
        dbPripojene: !!db,
        notificationPermission: (typeof Notification !== "undefined" ? Notification.permission : "N/A"),
        pushManager: ("PushManager" in window),
        serviceWorker: ("serviceWorker" in navigator)
      };
    },
    refreshToken: async function () {
      try {
        var swReg = await getBd642ServiceWorkerRegistration();
        try {
          if (typeof messaging.useServiceWorker === "function") messaging.useServiceWorker(swReg);
        } catch (_) {}
        var token = await messaging.getToken({ vapidKey: vapidPublicKey, serviceWorkerRegistration: swReg });
        if (!token) return { ok: false, dovod: "TOKEN_PRAZDNY" };
        await ulozTokenDoFirestore(token);
        return { ok: true, token: token };
      } catch (e) {
        return { ok: false, dovod: "CHYBA_REFRESH", detail: String(e && e.message ? e.message : e) };
      }
    }
  };
})();