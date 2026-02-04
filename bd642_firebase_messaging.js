// bd642_firebase_messaging.js
// FCM + Firestore pre BD 642 (Firebase JS SDK v8)
// - kompatibilné pre GitHub Pages (subcesta) aj desktop
// - zachováva API: window.BD642_ZapnutUpozornenia()

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

  function ok(token, extra) {
    var r = { ok: true, token: token };
    if (extra && typeof extra === "object") {
      for (var k in extra) r[k] = extra[k];
    }
    return r;
  }
  function fail(code, detail) {
    var r = { ok: false, dovod: code || "INA_CHYBA" };
    if (detail) r.detail = String(detail);
    return r;
  }

  // --- kontrola SDK ---
  if (typeof firebase === "undefined") {
    console.error("BD642 FCM: firebase nie je dostupný (skontroluj script includy v index.html).");
    window.BD642_ZapnutUpozornenia = async function () {
      return fail("FIREBASE_CHYBA");
    };
    window.BD642_FCM = {
      refreshToken: async function () { return null; },
      ulozTokenManualne: async function () { return null; }
    };
    return;
  }

  // --- init app ---
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      console.log("BD642 FCM: firebase.initializeApp OK");
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri firebase.initializeApp:", e);
  }

  // --- messaging ---
  var messaging = null;
  var fcmSupported = false;

  try {
    if (firebase.messaging && typeof firebase.messaging.isSupported === "function") {
      fcmSupported = firebase.messaging.isSupported();
    } else if (firebase.messaging) {
      fcmSupported = true;
    } else {
      fcmSupported = false;
    }

    if (fcmSupported) {
      messaging = firebase.messaging();
    } else {
      console.warn("BD642 FCM: messaging nie je podporovaný v tomto prostredí.");
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri získaní messaging inštancie:", e);
    fcmSupported = false;
  }

  // --- Firestore ---
  var db = null;
  var FieldValue = null;

  try {
    if (firebase.firestore) {
      db = firebase.firestore();
      if (firebase.firestore.FieldValue) FieldValue = firebase.firestore.FieldValue;
      console.log("BD642 FCM: Firestore inicializovaný.");
    } else {
      console.warn("BD642 FCM: firebase.firestore nie je k dispozícii (chýba firebase-firestore.js).");
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri inicializácii Firestore:", e);
  }

  // --- helper: nájdi / zaregistruj náš SW (aj v subceste) ---
  function endsWithSw(u) {
    try { return String(u || "").indexOf("firebase-messaging-sw.js") !== -1; } catch (_) { return false; }
  }

  async function getBd642ServiceWorkerRegistration() {
    if (!("serviceWorker" in navigator)) return null;

    var swUrl = new URL("./firebase-messaging-sw.js", location.href).toString();

    // 1) skús existujúce registrácie
    try {
      var regs = await navigator.serviceWorker.getRegistrations();
      for (var i = 0; i < regs.length; i++) {
        var r = regs[i];
        var a = r && r.active ? r.active.scriptURL : "";
        var w = r && r.waiting ? r.waiting.scriptURL : "";
        var ins = r && r.installing ? r.installing.scriptURL : "";
        if (endsWithSw(a) || endsWithSw(w) || endsWithSw(ins)) {
          return r;
        }
      }
    } catch (e) {
      // ignor
    }

    // 2) ak nie je, zaregistruj relatívne (scope bude aktuálna zložka)
    try {
      var reg = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
      return reg;
    } catch (e2) {
      console.warn("BD642 FCM: nepodarilo sa zaregistrovať SW z bd642_firebase_messaging.js:", e2);
    }

    // 3) fallback: ready
    try {
      var ready = await navigator.serviceWorker.ready;
      return ready || null;
    } catch (e3) {
      return null;
    }
  }

  // --- uloženie tokenu do Firestore ---
  async function ulozTokenDoFirestore(token) {
    if (!db) {
      console.warn("BD642 FCM: Firestore nie je dostupný – token sa neuloží.");
      return { ulozene: false, dovod: "FIRESTORE_NEDOSTUPNY" };
    }

    try {
      var terazIso = new Date().toISOString();
      var rodina = (localStorage.getItem("bd642_meFamily") || "").trim();
      var rola = (localStorage.getItem("bd642_role") || "").trim();

      var data = {
        token: token,
        rodina: rodina || null,
        rola: rola || null,
        userAgent: navigator.userAgent || "",
        jazyk: navigator.language || "",
        url: location.href || "",
        aktualizovane: terazIso
      };

      if (FieldValue && typeof FieldValue.serverTimestamp === "function") {
        data.serverUpdatedAt = FieldValue.serverTimestamp();
        // prvé uloženie vs ďalšie updaty – pre prvú verziu necháme rovnaké
        data.serverCreatedAt = FieldValue.serverTimestamp();
      }

      // NOVÁ LOGIKA:
      // ak je rodina zadaná, ukladáme tokeny do:
      //   rodiny/{rodina}/fcm_tokens/{token}
      // inak fallback na pôvodné:
      //   fcm_tokens/{token}
      var kolekciaRef;
      if (rodina) {
        kolekciaRef = db
          .collection("rodiny")
          .doc(rodina)
          .collection("fcm_tokens");
      } else {
        kolekciaRef = db.collection("fcm_tokens");
      }

      await kolekciaRef.doc(token).set(data, { merge: true });

      console.log(
        "BD642 FCM: token uložený do Firestore " +
          (rodina ? "rodiny/" + rodina + "/fcm_tokens/" : "fcm_tokens/") +
          token
      );
      return { ulozene: true };
    } catch (e) {
      console.error("BD642 FCM: chyba pri ukladaní tokenu do Firestore:", e);
      return {
        ulozene: false,
        dovod: "FIRESTORE_CHYBA",
        detail: String(e && e.message ? e.message : e)
      };
    }
  }

  // --- hlavná logika ---
  async function vnutorneZapnutUpozornenia() {
    // základné API
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return fail("NEPODPOROVANE");
    }
    if (!fcmSupported || !messaging) {
      return fail("NEPODPOROVANE");
    }

    // povolenie notifikácií
    if (Notification.permission === "denied") return fail("NEPOVOLENE");

    if (Notification.permission !== "granted") {
      try {
        var perm = await Notification.requestPermission();
        if (perm !== "granted") return fail("NEPOVOLENE");
      } catch (ePerm) {
        return fail("INA_CHYBA", ePerm);
      }
    }

    // nájdi náš SW
    var swReg = await getBd642ServiceWorkerRegistration();
    if (!swReg) {
      console.warn("BD642 FCM: nepodarilo sa získať SW registráciu.");
      // bez SW registrácie to často na Androide padá
      return fail("SW_CHYBA");
    }

    // getToken
    try {
      var opt = { vapidKey: vapidPublicKey, serviceWorkerRegistration: swReg };
      var token = await messaging.getToken(opt);

      if (!token) return fail("TOKEN_CHYBA");

      var uloz = await ulozTokenDoFirestore(token);

      // Token je platný aj keď Firestore zápis zlyhá – vrátime ok:true + info
      if (uloz && uloz.ulozene === false) {
        return ok(token, { upozornenie: "TOKEN_OK_FIRESTORE_FAIL", fire: uloz });
      }

      return ok(token);
    } catch (eTok) {
      console.error("BD642 FCM: chyba pri získavaní tokenu:", eTok);
      return fail("TOKEN_CHYBA", eTok);
    }
  }

  // foreground správy – len log
  if (messaging) {
    try {
      messaging.onMessage(function (payload) {
        console.log("BD642 FCM: foreground správa:", payload);
      });
    } catch (eOn) {
      console.error("BD642 FCM: chyba v onMessage:", eOn);
    }
  }

  // --- exporty ---
  window.BD642_ZapnutUpozornenia = async function () {
    try {
      return await vnutorneZapnutUpozornenia();
    } catch (e) {
      console.error("BD642 FCM: neošetrená chyba:", e);
      return fail("INA_CHYBA", e);
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
