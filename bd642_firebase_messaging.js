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
  //    (hodnoty z Firebase konzoly – nemeniť, pokiaľ ich neprepíšeš aj tam)
  var firebaseConfig = {
    apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
    authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
    projectId: "bd-642-26-upratovanie-d2851",
    storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
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
  var db = null;
  var FieldValue = null;
  try {
    if (firebase.firestore) {
      db = firebase.firestore();
      FieldValue = firebase.firestore.FieldValue || null;
      console.log("BD642 FCM: Firestore inicializovaný.");
    } else {
      console.warn("BD642 FCM: firebase.firestore nie je dostupné.");
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
      // staršie SDK môže nemť isSupported – berieme ako podporované
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

    // Aj tak exportneme funkciu BD642_ZapnutUpozornenia, ale vždy vráti chybu
    window.BD642_ZapnutUpozornenia = async function () {
      return {
        ok: false,
        dovod: "MESSAGING_NEPODPOROVANE"
      };
    };

    console.warn("BD642 FCM: Messaging nepodporovaný – končím inicializáciu.");
    return;
  }

  /**
   * Pomocná funkcia: získa (alebo zaregistruje) service worker pre FCM.
   * Hľadá existujúci firebase-messaging-sw.js, ak nie je, zaregistruje ho.
   */
  async function getBd642ServiceWorkerRegistration() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service worker nie je podporovaný týmto prehliadačom.");
    }

    // Skúsime nájsť existujúci SW s naším skriptom
    var registrations = [];
    try {
      registrations = await navigator.serviceWorker.getRegistrations();
    } catch (e) {
      console.warn("BD642 FCM: nepodarilo sa získať zoznam SW registrácií:", e);
    }

    if (registrations && registrations.length) {
      for (var i = 0; i < registrations.length; i++) {
        var reg = registrations[i];
        try {
          if (
            reg.active &&
            reg.active.scriptURL &&
            reg.active.scriptURL.indexOf("firebase-messaging-sw.js") !== -1
          ) {
            return reg;
          }
        } catch (_) {
          // ignorovať
        }
      }
    }

    // Ak sme nenašli, zaregistrujeme firebase-messaging-sw.js v root scope
    try {
      var reg2 = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
      console.log("BD642 FCM: service worker zaregistrovaný:", reg2);
      return reg2;
    } catch (e) {
      console.error("BD642 FCM: chyba pri registrácii service workera:", e);
      throw e;
    }
  }

  /**
   * Uloží FCM token do Firestore.
   *
   * Token ukladáme:
   *   - do kolekcie fcm_tokens/{token}
   *   - ak poznáme rodinu, zároveň do rodiny/{rodina}/fcm_tokens/{token},
   *     aby sme vedeli poslať jednu správu celej rodine (všetkým zariadeniam).
   */
  async function ulozTokenDoFirestore(token) {
    if (!db) {
      console.warn("BD642 FCM: Firestore nie je dostupný – token sa neuloží.");
      return { ulozene: false, dovod: "FIRESTORE_NEDOSTUPNY" };
    }

    try {
      var terazIso = new Date().toISOString();

      // Rodina – berieme z localStorage (bd642_meFamily)
      var rodina = null;
      var rola = null;
      if (typeof localStorage !== "undefined") {
        try {
          rodina = (localStorage.getItem("bd642_meFamily") || "").trim() || null;
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
        aktualizovane_server: FieldValue && FieldValue.serverTimestamp
          ? FieldValue.serverTimestamp()
          : null
      };

      // Hlavná kolekcia všetkých tokenov
      var tokensCol = db.collection("fcm_tokens");
      var docRef = tokensCol.doc(token);
      await docRef.set(data, { merge: true });

      // Ak poznáme rodinu, uložíme token aj pod rodinu/{rodina}/fcm_tokens
      if (rodina) {
        var docRefRodiny = db
          .collection("rodiny")
          .doc(rodina)
          .collection("fcm_tokens")
          .doc(token);
        await docRefRodiny.set(data, { merge: true });
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
   * Vnútorná funkcia na zapnutie upozornení:
   * - skontroluje podporu Notifikácií, Service Worker a Push
   * - požiada o povolenie
   * - získa FCM token (registrácia do WebPush)
   * - uloží token do Firestore naviazaný na rodinu
   */
  async function vnutorneZapnutUpozornenia() {
    // 1) Notification API
    if (typeof Notification === "undefined") {
      console.warn("BD642 FCM: Notification API nie je dostupné.");
      return {
        ok: false,
        dovod: "NOTIFICATION_API_NEDOSTUPNE"
      };
    }

    if (Notification.permission === "denied") {
      console.warn("BD642 FCM: Upozornenia sú blokované (Notification.permission = denied).");
      return {
        ok: false,
        dovod: "NOTIFICATION_ZABLOKOVANE"
      };
    }

    // 2) Service worker + PushManager
    if (!("serviceWorker" in navigator)) {
      console.warn("BD642 FCM: Service worker nie je podporovaný.");
      return {
        ok: false,
        dovod: "SERVICE_WORKER_NEPODPOROVANY"
      };
    }
    if (!("PushManager" in window)) {
      console.warn("BD642 FCM: PushManager nie je podporovaný.");
      return {
        ok: false,
        dovod: "PUSHMANAGER_NEPODPOROVANY"
      };
    }

    try {
      // Požiadame o povolenie notifikácií
      var permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.warn(
          "BD642 FCM: Používateľ nepovolil upozornenia (permission =",
          permission,
          ")"
        );
        return {
          ok: false,
          dovod: "NOTIFICATION_NEPOVOLENE"
        };
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
        return {
          ok: false,
          dovod: "TOKEN_PRAZDNY"
        };
      }

      console.log("BD642 FCM: získaný token:", token);

      // Uložíme token do Firestore naviazaný na rodinu
      var uloz = await ulozTokenDoFirestore(token);
      if (!uloz || !uloz.ulozene) {
        console.warn(
          "BD642 FCM: token sa nepodarilo uložiť do Firestore, dovod:",
          uloz && uloz.dovod
        );
        // Aj tak vrátime ok + token – v krajnom prípade vie backend riešiť ručne
        return {
          ok: true,
          token: token,
          upozornenie: "TOKEN_NEULOZENY_DO_FIRESTORE"
        };
      }

      return {
        ok: true,
        token: token
      };
    } catch (e) {
      console.error("BD642 FCM: chyba pri zapínaní upozornení:", e);
      return {
        ok: false,
        dovod: "CHYBA_ZAPNUTIA",
        detail: String(e && e.message ? e.message : e)
      };
    }
  }

  // --- REAKCIA NA FOREGROUND SPRÁVY ----------------------------

  if (messaging && messagingPodporovane) {
    messaging.onMessage(function (payload) {
      try {
        console.log("BD642 FCM: foreground správa:", payload);
        // Tu môžeš doplniť vlastné zobrazenie v UI (toasty, badge, atď.)
      } catch (e) {
        console.error("BD642 FCM: chyba v onMessage handleri:", e);
      }
    });
  }

  // --- EXPORTY PRE APPKU ---------------------------------------

  // Funkcia, ktorú volá appka pri stlačení "Zapnúť push"
  window.BD642_ZapnutUpozornenia = async function () {
    return await vnutorneZapnutUpozornenia();
  };

  // Jednoduché API na manuálne použitie / debug
  window.BD642_FCM = {
    podporovane: !!messagingPodporovane,
    debug: function () {
      return {
        messagingPodporovane: messagingPodporovane,
        dbPripojene: !!db
      };
    },
    /**
     * Vynúti refresh / znovuzískanie tokenu (napr. po zmene nastavení).
     * Token sa uloží do Firestore tým istým spôsobom (naviazanie na rodinu).
     */
    refreshToken: async function () {
      try {
        var swReg = await getBd642ServiceWorkerRegistration();
        var token = await messaging.getToken({
          vapidKey: vapidPublicKey,
          serviceWorkerRegistration: swReg
        });
        if (!token) {
          return { ok: false, dovod: "TOKEN_PRAZDNY" };
        }
        await ulozTokenDoFirestore(token);
        return { ok: true, token: token };
      } catch (e) {
        console.error("BD642 FCM: chyba pri refreshToken:", e);
        return {
          ok: false,
          dovod: "CHYBA_REFRESH",
          detail: String(e && e.message ? e.message : e)
        };
      }
    },
    /**
     * Priamo uloží token do Firestore (ak by si ho mal z iného zdroja).
     */
    ulozTokenManualne: function (token) {
      return ulozTokenDoFirestore(token);
    }
  };
})();
