/* global firebase */

// bd642_firebase_messaging.js
// BD642 – Firebase Messaging (FCM) klient (SDK v8)
// Fixy:
// - absolútna registrácia SW: "/firebase-messaging-sw.js" + scope "/"
// - storageBucket opravený na appspot.com
// - robustný výber existujúceho SW (active/waiting/installing)
// - useServiceWorker (v8) + getToken(serviceWorkerRegistration)
// - Android Chrome fallback (ak isSupported() klame)
// - onTokenRefresh (v8) + refresh + delete + diagnostika

(function () {
  "use strict";

  // 1) Kontrola firebase
  if (typeof firebase === "undefined") {
    console.error("BD642 FCM: firebase SDK nie je načítané.");
    window.BD642_FCM = { podporovane: false, dovod: "FIREBASE_CHYBA" };
    window.BD642_ZapnutUpozornenia = async function () { return { ok: false, dovod: "FIREBASE_CHYBA" }; };
    return;
  }

  // 2) Firebase config (OPRAVENÝ storageBucket)
  var firebaseConfig = {
    apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
    authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
    projectId: "bd-642-26-upratovanie-d2851",
    storageBucket: "bd-642-26-upratovanie-d2851.appspot.com",
    messagingSenderId: "530262860262",
    appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
    measurementId: "G-2ZDWWZBKRR"
  };

  // 3) VAPID (musí sedieť v Firebase)
  var vapidPublicKey =
    "BHnnUHjr7ujW1Do0bJBbZqL8G9WmJsVmjE859krH6eS3uJ9YUSAex7cnjEJxATx2dXbcPN7Xv9zzppRDE4ZFWZw";

  // 4) init app
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
  } catch (e) {
    console.error("BD642 FCM: firebase.initializeApp chyba:", e);
  }

  // 5) Firestore (ak je načítaný SDK)
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

  // 6) Messaging support
  var messaging = null;
  var messagingPodporovane = false;

  function jeAndroidChromeBezWebView() {
    try {
      var ua = (navigator.userAgent || "").toLowerCase();
      return ua.indexOf("android") !== -1 && ua.indexOf("chrome/") !== -1 && ua.indexOf("wv") === -1;
    } catch (_) { return false; }
  }

  try {
    if (firebase.messaging && typeof firebase.messaging.isSupported === "function") {
      messagingPodporovane = firebase.messaging.isSupported();
    } else if (firebase.messaging) {
      messagingPodporovane = true;
    }

    if (messagingPodporovane) {
      messaging = firebase.messaging();
    } else if (firebase.messaging && jeAndroidChromeBezWebView()) {
      // fallback: Android Chrome vie klamať cez isSupported()
      messaging = firebase.messaging();
      messagingPodporovane = true;
      console.warn("BD642 FCM: isSupported() false, ale Android Chrome – skúšam messaging fallback.");
    }
  } catch (e3) {
    console.error("BD642 FCM: messaging init chyba:", e3);
    messagingPodporovane = false;
    messaging = null;
  }

  if (!messagingPodporovane || !messaging) {
    window.BD642_FCM = { podporovane: false, dovod: "MESSAGING_NEPODPOROVANE" };
    window.BD642_ZapnutUpozornenia = async function () { return { ok: false, dovod: "MESSAGING_NEPODPOROVANE" }; };
    return;
  }

  function getRodinaPreToken() {
    try {
      if (typeof localStorage === "undefined") return null;
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
      var rola = null;
      try { rola = (localStorage.getItem("bd642_role") || "").trim() || null; } catch (_) {}

      var data = {
        token: token,
        rodina: rodina,
        rola: rola,
        userAgent: navigator.userAgent || "",
        jazyk: navigator.language || "",
        url: (typeof location !== "undefined" ? (location.href || "") : ""),
        aktualizovane: new Date().toISOString(),
        aktualizovane_server: (FieldValue && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : null
      };

      await db.collection("fcm_tokens").doc(token).set(data, { merge: true });

      // dôležité pre posielanie „na rodinu“
      if (rodina) {
        await db.collection("rodiny").doc(rodina).collection("fcm_tokens").doc(token).set(data, { merge: true });
      }

      return { ulozene: true, rodina: rodina || null };
    } catch (e) {
      console.error("BD642 FCM: ulozTokenDoFirestore chyba:", e);
      return { ulozene: false, dovod: "FIRESTORE_CHYBA", detail: String(e && e.message ? e.message : e) };
    }
  }

  function scriptUrlJeNasz(sw) {
    try { return !!(sw && sw.scriptURL && sw.scriptURL.indexOf("/firebase-messaging-sw.js") !== -1); } catch (_) { return false; }
  }

  async function getBd642ServiceWorkerRegistration() {
    if (!("serviceWorker" in navigator)) throw new Error("SW_NEPODPOROVANY");

    // 1) skús nájsť existujúci (active/waiting/installing)
    try {
      var regs = await navigator.serviceWorker.getRegistrations();
      for (var i = 0; i < regs.length; i++) {
        var reg = regs[i];
        var sw = (reg && (reg.active || reg.waiting || reg.installing)) || null;
        if (sw && (scriptUrlJeNasz(sw) || (sw.scriptURL && sw.scriptURL.indexOf("firebase-messaging-sw.js") !== -1))) {
          try { await reg.update(); } catch (_) {}
          return reg;
        }
      }
    } catch (_) {}

    // 2) zaregistruj na ROOT (kritické pre PWA/SPA)
    var reg2 = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });

    // počkaj na ready (aby bol kontroler)
    try { await navigator.serviceWorker.ready; } catch (_) {}
    try { await reg2.update(); } catch (_) {}

    return reg2;
  }

  async function vnutorneZapnutUpozornenia() {
    // Notification API
    if (typeof Notification === "undefined") return { ok: false, dovod: "NOTIFICATION_API_NEDOSTUPNE" };
    if (Notification.permission === "denied") return { ok: false, dovod: "NOTIFICATION_ZABLOKOVANE" };

    if (!("serviceWorker" in navigator)) return { ok: false, dovod: "SERVICE_WORKER_NEPODPOROVANY" };
    if (!("PushManager" in window)) return { ok: false, dovod: "PUSHMANAGER_NEPODPOROVANY" };

    // vyžiadať povolenie
    var perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, dovod: "NOTIFICATION_NEPOVOLENE" };

    try {
      var swReg = await getBd642ServiceWorkerRegistration();

      // v8 compat – spáruj messaging so SW (plus aj cez getToken param)
      try { if (typeof messaging.useServiceWorker === "function") messaging.useServiceWorker(swReg); } catch (_) {}

      var token = await messaging.getToken({
        vapidKey: vapidPublicKey,
        serviceWorkerRegistration: swReg
      });

      if (!token) return { ok: false, dovod: "TOKEN_PRAZDNY" };

      var uloz = await ulozTokenDoFirestore(token);
      if (!uloz.ulozene) {
        return { ok: true, token: token, upozornenie: "TOKEN_NEULOZENY_DO_FIRESTORE", detail: uloz.dovod || null };
      }

      return { ok: true, token: token, rodina: uloz.rodina || null };
    } catch (e) {
      console.error("BD642 FCM: zapnutie chyba:", e);
      return { ok: false, dovod: "CHYBA_ZAPNUTIA", detail: String(e && e.message ? e.message : e) };
    }
  }

  // Foreground správy (log)
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
          try { if (typeof messaging.useServiceWorker === "function") messaging.useServiceWorker(swReg); } catch (_) {}
          var t = await messaging.getToken({ vapidKey: vapidPublicKey, serviceWorkerRegistration: swReg });
          if (t) await ulozTokenDoFirestore(t);
          console.warn("BD642 FCM: token refresh hotovo.");
        } catch (e) {
          console.error("BD642 FCM: token refresh chyba:", e);
        }
      });
    }
  } catch (_) {}

  // EXPORTY
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
        serviceWorker: ("serviceWorker" in navigator),
        controller: (navigator.serviceWorker && navigator.serviceWorker.controller) ? true : false,
        pageUrl: (typeof location !== "undefined" ? location.href : "")
      };
    },

    diag: async function () {
      var out = { ok: true, kroky: [] };
      try {
        out.kroky.push({ krok: "permission", hodnota: (typeof Notification !== "undefined" ? Notification.permission : "N/A") });
        if ("serviceWorker" in navigator) {
          var regs = await navigator.serviceWorker.getRegistrations();
          out.kroky.push({ krok: "sw_registracie", pocet: regs.length });
          out.kroky.push({ krok: "sw_controller", hodnota: !!navigator.serviceWorker.controller });
          for (var i = 0; i < regs.length; i++) {
            var r = regs[i];
            var sw = (r && (r.active || r.waiting || r.installing)) || null;
            out.kroky.push({ krok: "sw_" + i, scope: (r && r.scope) || null, scriptURL: (sw && sw.scriptURL) || null });
          }
        } else {
          out.kroky.push({ krok: "sw", chyba: "NIE" });
        }
      } catch (e) {
        out.ok = false;
        out.chyba = String(e && e.message ? e.message : e);
      }
      return out;
    },

    refreshToken: async function () {
      try {
        var swReg = await getBd642ServiceWorkerRegistration();
        try { if (typeof messaging.useServiceWorker === "function") messaging.useServiceWorker(swReg); } catch (_) {}
        var token = await messaging.getToken({ vapidKey: vapidPublicKey, serviceWorkerRegistration: swReg });
        if (!token) return { ok: false, dovod: "TOKEN_PRAZDNY" };
        await ulozTokenDoFirestore(token);
        return { ok: true, token: token };
      } catch (e) {
        return { ok: false, dovod: "CHYBA_REFRESH", detail: String(e && e.message ? e.message : e) };
      }
    },

    deleteToken: async function () {
      try {
        var token = null;
        try {
          var swReg = await getBd642ServiceWorkerRegistration();
          try { if (typeof messaging.useServiceWorker === "function") messaging.useServiceWorker(swReg); } catch (_) {}
          token = await messaging.getToken({ vapidKey: vapidPublicKey, serviceWorkerRegistration: swReg });
        } catch (_) {}

        var ok = true;
        if (token && typeof messaging.deleteToken === "function") {
          ok = await messaging.deleteToken(token);
        }
        return { ok: !!ok, token: token || null };
      } catch (e) {
        return { ok: false, dovod: "CHYBA_DELETE", detail: String(e && e.message ? e.message : e) };
      }
    }
  };
})();