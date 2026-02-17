/* global firebase */

// bd642_firebase_messaging.js
// Klientsky kód pre prácu s Firebase Messaging (FCM)
// - inicializácia Firebase
// - získanie / uloženie FCM tokenu
// - napojenie na service worker (firebase-messaging-sw.js)
// - export jednoduchých funkcií pre appku (BD642_ZapnutUpozornenia, BD642_FCM.*)

(function () {
  "use strict";

  // 1) Kontrola, či je k dispozícii firebase (SDK v8 compat)
  if (typeof firebase === "undefined") {
    console.error("BD642 FCM: Knižnica firebase nie je načítaná.");
    window.BD642_FCM = {
      podporovane: false,
      dovod: "FIREBASE_CHYBA",
      debug: function () {
        return "Firebase nie je dostupný – skontroluj <script> s firebase SDK.";
      }
    };
    return;
  }

  // 2) Konfigurácia Firebase pre projekt bd-642-26-upratovanie-d2851
  //    (hodnoty z Firebase konzoly – NEMENIŤ, pokiaľ ich neprepíšeš aj tam)
  var firebaseConfig = {
    apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
    authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
    projectId: "bd-642-26-upratovanie-d2851",
    // OPRAVA: pre Web SDK v8 používaj appspot.com (štandardný storage bucket)
    storageBucket: "bd-642-26-upratovanie-d2851.appspot.com",
    messagingSenderId: "530262860262",
    appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
    measurementId: "G-2ZDWWZBKRR"
  };

  // 3) Public VAPID key pre WebPush (musí sedieť s "current pair" vo Firebase)
  var vapidPublicKey =
    "BHnnUHjr7ujW1Do0bJBbZqL8G9WmJsVmjE859krH6eS3uJ9YUSAex7cnjEJxATx2dXbcPN7Xv9zzppRDE4ZFWZw";

  // 4) Inicializácia Firebase App (opatrne, aby sme neinicializovali 2×)
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      console.log("BD642 FCM: Firebase App inicializovaný (DEFAULT).");
    } else {
      console.log("BD642 FCM: Firebase App už existuje, používam existujúci.");
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri firebase.initializeApp:", e);
  }

  // 5) Firestore (pre ukladanie FCM tokenov naviazaných na rodinu)
  // POZN.: v HTML musí byť načítané aj firebase-firestore.js, inak db ostane null.
  var db = null;
  var FieldValue = null;
  try {
    if (firebase.firestore) {
      db = firebase.firestore();
      FieldValue = firebase.firestore.FieldValue || null;
      console.log("BD642 FCM: Firestore inicializovaný.");
    } else {
      console.warn(
        "BD642 FCM: firebase.firestore nie je dostupné. " +
          "Skontroluj, či máš v HTML načítané firebase-firestore.js (SDK v8)."
      );
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri inicializácii Firestore:", e);
  }

  // 6) Messaging – zisťujeme, či je podporovaný v tomto prostredí
  var messaging = null;
  var messagingPodporovane = false;
  try {
    if (firebase.messaging && typeof firebase.messaging.isSupported === "function") {
      messagingPodporovane = firebase.messaging.isSupported();
    } else if (firebase.messaging) {
      // staršie SDK môže nemáť isSupported – berieme ako podporované
      messagingPodporovane = true;
    } else {
      messagingPodporovane = false;
    }

    if (messagingPodporovane) {
      messaging = firebase.messaging();
      console.log("BD642 FCM: Messaging inicializovaný a podporovaný.");
    } else {
      console.warn("BD642 FCM: Messaging nie je podporovaný v tomto prehliadači.");
    }

    // Fallback pre niektoré kombinácie Chrome na Androide:
    if (!messagingPodporovane && firebase.messaging) {
      try {
        var ua = (navigator.userAgent || "").toLowerCase();
        var jeAndroidChrome =
          ua.indexOf("android") !== -1 &&
          ua.indexOf("chrome/") !== -1 &&
          ua.indexOf("wv") === -1; // vylúčime Android WebView

        if (jeAndroidChrome) {
          messaging = firebase.messaging();
          messagingPodporovane = true;
          console.log(
            "BD642 FCM: isSupported() vrátilo false, ale ide o Chrome na Androide – " +
              "skúšam messaging aj tak (fallback)."
          );
        }
      } catch (e2) {
        console.warn("BD642 FCM: fallback inicializácie messagingu na Androide zlyhal:", e2);
        messaging = null;
        messagingPodporovane = false;
      }
    }
  } catch (e) {
    console.error("BD642 FCM: neočakávaná chyba pri inicializácii messagingu:", e);
    messagingPodporovane = false;
  }

  // Ak Messaging nie je podporovaný, pripravíme jednoduché API, aby appka nespadla.
  if (!messagingPodporovane || !messaging) {
    window.BD642_FCM = {
      podporovane: false,
      dovod: "MESSAGING_NEPODPOROVANE",
      debug: function () {
        return {
          messagingPodporovane: messagingPodporovane,
          dbPripojene: !!db
        };
      },
      refreshToken: async function () {
        return { ok: false, dovod: "MESSAGING_NEPODPOROVANE" };
      },
      ulozTokenManualne: async function () {
        return { ok: false, dovod: "MESSAGING_NEPODPOROVANE" };
      }
    };

    window.BD642_ZapnutUpozornenia = async function () {
      return { ok: false, dovod: "MESSAGING_NEPODPOROVANE" };
    };

    console.warn("BD642 FCM: Messaging nepodporovaný – končím inicializáciu.");
    return;
  }

  /**
   * Zistí, pre ktorú rodinu má byť FCM token uložený (trvalé naviazanie).
   */
  function getRodinaPreToken() {
    if (typeof localStorage === "undefined") return null;

    try {
      var rodinaPrihlasena = (localStorage.getItem("bd642_meFamily") || "").trim();
      var rodinaPush = (localStorage.getItem("bd642_pushFamily") || "").trim();
      var rodina = rodinaPrihlasena || rodinaPush || "";

      if (rodinaPrihlasena && rodinaPrihlasena !== rodinaPush) {
        try {
          localStorage.setItem("bd642_pushFamily", rodinaPrihlasena);
        } catch (e) {
          console.warn("BD642 FCM: nepodarilo sa uložiť bd642_pushFamily:", e);
        }
      }
      return rodina || null;
    } catch (e) {
      console.warn("BD642 FCM: chyba v getRodinaPreToken:", e);
      return null;
    }
  }

  /**
   * Uloží FCM token do Firestore.
   */
  async function ulozTokenDoFirestore(token) {
    if (!db) {
      console.warn("BD642 FCM: Firestore nie je dostupný – token sa neuloží.");
      return { ulozene: false, dovod: "FIRESTORE_NEDOSTUPNY" };
    }

    try {
      var terazIso = new Date().toISOString();

      var rodina = null;
      var rola = null;
      if (typeof localStorage !== "undefined") {
        try {
          rodina = getRodinaPreToken();
          rola = (localStorage.getItem("bd642_role") || "").trim() || null;
        } catch (e) {
          console.warn("BD642 FCM: nepodarilo sa načítať údaje z localStorage:", e);
        }
      }

      var data = {
        token: token,
        rodina: rodina,
        rola: rola,
        userAgent: navigator.userAgent || "",
        jazyk: navigator.language || "",
        url: (typeof location !== "undefined" ? location.href : ""),
        aktualizovane: terazIso,
        aktualizovane_server:
          FieldValue && FieldValue.serverTimestamp ? FieldValue.serverTimestamp() : null
      };

      // fcm_tokens/{token}
      await db.collection("fcm_tokens").doc(token).set(data, { merge: true });

      // rodiny/{rodina}/fcm_tokens/{token}
      if (rodina) {
        await db
          .collection("rodiny")
          .doc(rodina)
          .collection("fcm_tokens")
          .doc(token)
          .set(data, { merge: true });
      }

      console.log(
        "BD642 FCM: token uložený do Firestore (token=" +
          token +
          ", rodina=" +
          (rodina || "null") +
          ")"
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

  /**
   * Získa (alebo zaregistruje) service worker pre FCM.
   */
  async function getBd642ServiceWorkerRegistration() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service worker nie je podporovaný týmto prehliadačom.");
    }

    var registrations = [];
    try {
      registrations = await navigator.serviceWorker.getRegistrations();
    } catch (e) {
      console.warn("BD642 FCM: nepodarilo sa získať zoznam SW registrácií:", e);
    }

    // Skúsime nájsť existujúci SW (active/waiting/installing) s naším skriptom
    if (registrations && registrations.length) {
      for (var i = 0; i < registrations.length; i++) {
        var reg = registrations[i];
        try {
          var sw =
            (reg && reg.active) ||
            (reg && reg.waiting) ||
            (reg && reg.installing) ||
            null;

          if (sw && sw.scriptURL && sw.scriptURL.indexOf("firebase-messaging-sw.js") !== -1) {
            return reg;
          }
        } catch (_) {
          // ignorovať
        }
      }
    }

    // Ak sme nenašli, zaregistrujeme firebase-messaging-sw.js v root scope (relatívne k app)
    try {
      var reg2 = await navigator.serviceWorker.register("./firebase-messaging-sw.js", {
        scope: "./"
      });
      console.log("BD642 FCM: service worker zaregistrovaný:", reg2);
      return reg2;
    } catch (e) {
      console.error("BD642 FCM: chyba pri registrácii service workera:", e);
      throw e;
    }
  }

  /**
   * Zapnutie upozornení:
   * - povolenie notifikácií
   * - SW registrácia
   * - FCM token
   * - uloženie do Firestore (ak je dostupný)
   */
  async function vnutorneZapnutUpozornenia() {
    // 1) Notification API
    if (typeof Notification === "undefined") {
      console.warn("BD642 FCM: Notification API nie je dostupné.");
      return { ok: false, dovod: "NOTIFICATION_API_NEDOSTUPNE" };
    }

    if (Notification.permission === "denied") {
      console.warn("BD642 FCM: Upozornenia sú blokované (Notification.permission = denied).");
      return { ok: false, dovod: "NOTIFICATION_ZABLOKOVANE" };
    }

    // 2) Service worker + PushManager
    if (!("serviceWorker" in navigator)) {
      console.warn("BD642 FCM: Service worker nie je podporovaný.");
      return { ok: false, dovod: "SERVICE_WORKER_NEPODPOROVANY" };
    }
    if (!("PushManager" in window)) {
      console.warn("BD642 FCM: PushManager nie je podporovaný.");
      return { ok: false, dovod: "PUSHMANAGER_NEPODPOROVANY" };
    }

    try {
      // Požiadame o povolenie notifikácií
      var permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.warn("BD642 FCM: Používateľ nepovolil upozornenia (permission =", permission, ")");
        return { ok: false, dovod: "NOTIFICATION_NEPOVOLENE" };
      }

      // Získame / zaregistrujeme service worker pre FCM
      var swReg = await getBd642ServiceWorkerRegistration();

      // Získame FCM token
      var token = await messaging.getToken({
        vapidKey: vapidPublicKey,
        serviceWorkerRegistration: swReg
      });

      if (!token) {
        console.warn("BD642 FCM: getToken vrátil prázdny token.");
        return { ok: false, dovod: "TOKEN_PRAZDNY" };
      }

      console.log("BD642 FCM: získaný token:", token);

      // Uložíme token do Firestore naviazaný na rodinu (ak db existuje)
      var uloz = await ulozTokenDoFirestore(token);
      if (!uloz || !uloz.ulozene) {
        console.warn("BD642 FCM: token sa nepodarilo uložiť do Firestore, dovod:", uloz && uloz.dovod);
        return { ok: true, token: token, upozornenie: "TOKEN_NEULOZENY_DO_FIRESTORE" };
      }

      return { ok: true, token: token };
    } catch (e) {
      console.error("BD642 FCM: chyba pri zapínaní upozornení:", e);
      return {
        ok: false,
        dovod: "CHYBA_ZAPNUTIA",
        detail: String(e && e.message ? e.message : e)
      };
    }
  }

  // --- FOREGROUND SPRÁVY ----------------------------
  if (messaging && messagingPodporovane) {
    try {
      messaging.onMessage(function (payload) {
        try {
          console.log("BD642 FCM: foreground správa:", payload);
          // TODO: sem si môžeš doplniť UI reakciu (toast, badge, refresh, ...)
        } catch (e) {
          console.error("BD642 FCM: chyba v onMessage handleri:", e);
        }
      });
    } catch (e) {
      console.warn("BD642 FCM: onMessage handler sa nepodarilo pripojiť:", e);
    }
  }

  // --- EXPORTY PRE APPKU ----------------------------

  window.BD642_ZapnutUpozornenia = async function () {
    return await vnutorneZapnutUpozornenia();
  };

  window.BD642_FCM = {
    podporovane: !!messagingPodporovane,
    debug: function () {
      return {
        messagingPodporovane: messagingPodporovane,
        dbPripojene: !!db,
        notificationPermission: (typeof Notification !== "undefined" ? Notification.permission : "N/A")
      };
    },
    refreshToken: async function () {
      try {
        var swReg = await getBd642ServiceWorkerRegistration();
        var token = await messaging.getToken({
          vapidKey: vapidPublicKey,
          serviceWorkerRegistration: swReg
        });
        if (!token) return { ok: false, dovod: "TOKEN_PRAZDNY" };
        await ulozTokenDoFirestore(token);
        return { ok: true, token: token };
      } catch (e) {
        console.error("BD642 FCM: chyba pri refreshToken:", e);
        return { ok: false, dovod: "CHYBA_REFRESH", detail: String(e && e.message ? e.message : e) };
      }
    },
    ulozTokenManualne: function (token) {
      return ulozTokenDoFirestore(token);
    }
  };
})();
