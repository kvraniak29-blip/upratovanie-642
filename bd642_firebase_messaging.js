/* global firebase */

// bd642_firebase_messaging.js
// Klientsky kód pre prácu s Firebase Messaging (FCM) + Firestore
// - inicializácia Firebase
// - získanie / uloženie FCM tokenu
// - napojenie na service worker (firebase-messaging-sw.js)
// - export jednoduchých funkcií pre appku (BD642_ZapnutUpozornenia, BD642_FCM.*)

(function () {
  "use strict";

  // Skontrolujeme, či je k dispozícii firebase
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

  // Konfigurácia pre projekt bd-642-26-upratovanie-d2851
  var firebaseConfig = {
    apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
    authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
    projectId: "bd-642-26-upratovanie-d2851",
    storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
    messagingSenderId: "530262860262",
    appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
    measurementId: "G-2ZDWWZBKRR"
  };

  // Public VAPID key pre WebPush (musí sedieť s nastavením vo Firebase)
  var vapidPublicKey =
    "BHnnUHjr7ujW1DoObJBbZqL8G9WmJsVmjE859krH6eS3uJ9YUSAex7cnjEJxATx2dXbcPN7Xv9zzppRDE4ZFWZw";

  // Inicializácia Firebase app (robíme ju opatrne, aby sme neinitovali 2x)
  var app;
  if (!firebase.apps || !firebase.apps.length) {
    app = firebase.initializeApp(firebaseConfig);
  } else {
    app = firebase.app();
  }

  // Firestore (pre ukladanie FCM tokenov naviazaných na rodinu)
  var db = null;
  var FieldValue = null;
  try {
    if (firebase.firestore) {
      db = firebase.firestore();
      FieldValue = firebase.firestore.FieldValue || null;
    }
  } catch (e) {
    console.warn("BD642 FCM: Firestore nie je k dispozícii:", e);
  }

  // Zisťujeme, či je podporovaný Messaging (teda WebPush) v danom prehliadači
  var messaging = null;
  var messagingPodporovane = false;
  try {
    messagingPodporovane = firebase.messaging && firebase.messaging.isSupported
      ? firebase.messaging.isSupported()
      : false;

    if (messagingPodporovane) {
      messaging = firebase.messaging();
    }
  } catch (e) {
    console.warn("BD642 FCM: Messaging nie je podporovaný alebo nastala chyba:", e);
    messagingPodporovane = false;
  }

  /**
   * Pomocná funkcia: získa (alebo zaregistruje) service worker pre FCM.
   * Hľadá existujúci firebase-messaging-sw.js v rámci aktuálneho scope,
   * ak nie je, zaregistruje ho.
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
          if (reg.active && reg.active.scriptURL &&
              reg.active.scriptURL.indexOf("firebase-messaging-sw.js") !== -1) {
            return reg;
          }
        } catch (_) {
          // ignorujeme
        }
      }
    }

    // Ak sme nenašli, zaregistrujeme firebase-messaging-sw.js v root scope
    // (na GitHub Pages / Firebase Hostingu to býva ./firebase-messaging-sw.js)
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
   * Zistí, pre ktorú rodinu má byť FCM token uložený.
   * - Primárne berie aktuálne prihlásenú rodinu (bd642_meFamily).
   * - Ak nie je nikto prihlásený, použije poslednú rodinu, pre ktorú bol push zapnutý (bd642_pushFamily).
   * - Hodnota bd642_pushFamily sa NIKDY automaticky nemaže pri odhlásení,
   *   takže token ostáva natrvalo naviazaný na túto rodinu, kým ho ručne nevypneme.
   */
  function getRodinaPreToken() {
    try {
      if (typeof localStorage === "undefined") {
        return null;
      }
      var rodinaPrihlasena = (localStorage.getItem("bd642_meFamily") || "").trim();
      var rodinaPush = (localStorage.getItem("bd642_pushFamily") || "").trim();

      // ak je niekto prihlásený, prevezmeme túto rodinu a zároveň ju uložíme ako "trvalú"
      var rodina = rodinaPrihlasena || rodinaPush || "";

      if (rodina && rodina !== rodinaPush) {
        try {
          localStorage.setItem("bd642_pushFamily", rodina);
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
   *
   * Token ukladáme:
   *   - primárne do kolekcie rodiny/{rodina}/fcm_tokens/{token},
   *     aby bolo možné jednoducho poslať push celej rodine
   *     (backend si zoberie všetky tokeny z tejto kolekcie a pošle na ne správu)
   *   - fallback do fcm_tokens/{token}, ak rodinu naozaj nevieme určiť
   */
  async function ulozTokenDoFirestore(token) {
    if (!db) {
      console.warn("BD642 FCM: Firestore nie je dostupný – token sa neuloží.");
      return { ulozene: false, dovod: "FIRESTORE_NEDOSTUPNY" };
    }

    try {
      var terazIso = new Date().toISOString();
      var rodina = getRodinaPreToken(); // TRVALÉ naviazanie na rodinu
      var rola = (typeof localStorage !== "undefined"
        ? (localStorage.getItem("bd642_role") || "").trim()
        : "");

      var data = {
        token: token,
        rodina: rodina || null,
        rola: rola || null,
        userAgent: navigator.userAgent || "",
        jazyk: navigator.language || "",
        url: (typeof location !== "undefined" ? location.href : ""),
        aktualizovane: terazIso,
        aktualizovane_server: FieldValue && FieldValue.serverTimestamp
          ? FieldValue.serverTimestamp()
          : null
      };

      // tokeny ukladáme do rodiny/{rodina}/fcm_tokens, aby bolo jednoduché poslať
      // jednu push správu celej rodine (všetkým zariadeniam s tokenom tejto rodiny)
      var kolekcia;
      if (rodina) {
        kolekcia = db.collection("rodiny").doc(rodina).collection("fcm_tokens");
      } else {
        // fallback len ak naozaj nevieme rodinu – napr. systémové/dev zariadenie
        kolekcia = db.collection("fcm_tokens");
      }

      await kolekcia.doc(token).set(data, { merge: true });

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

  /**
   * Vnútorná funkcia na zapnutie upozornení:
   * - skontroluje podporu Notifikácií, Service Worker a Push
   * - požiada o povolenie
   * - získa FCM token (registrácia do WebPush)
   * - uloží token do Firestore naviazaný na rodinu
   */
  async function vnutorneZapnutUpozornenia() {
    if (!messagingPodporovane || !messaging) {
      console.warn("BD642 FCM: WebPush (Firebase Messaging) nie je podporovaný.");
      return {
        ok: false,
        dovod: "MESSAGING_NEPODPOROVANE"
      };
    }

    // 1) Notifikácie v prehliadači
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
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.warn("BD642 FCM: Používateľ nepovolil upozornenia (permission =", permission, ")");
        return {
          ok: false,
          dovod: "NOTIFICATION_NEPOVOLENE"
        };
      }

      // Získame / zaregistrujeme service worker pre FCM
      const swReg = await getBd642ServiceWorkerRegistration();

      // Získame FCM token
      const token = await messaging.getToken({
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

      // Uložíme token do Firestore naviazaný na RODINU
      const uloz = await ulozTokenDoFirestore(token);
      if (!uloz || !uloz.ulozene) {
        console.warn("BD642 FCM: token sa nepodarilo uložiť do Firestore, dovod:", uloz && uloz.dovod);
        // Aj tak vrátime ok + token – backend si môže v krajnom prípade pomôcť manuálne
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
        // Tu prípadne môžeš doplniť vlastné zobrazenie v UI (toasty, badge, atď.)
      } catch (e) {
        console.error("BD642 FCM: chyba v onMessage handleri:", e);
      }
    });
  }

  // --- exporty pre appku ---------------------------------------

  // Jednoduchá funkcia, ktorú voláme z appky, keď chce používateľ zapnúť upozornenia
  window.BD642_ZapnutUpozornenia = async function () {
    return await vnutorneZapnutUpozornenia();
  };

  // Malé API na manuálne volanie z appky (ak by bolo treba)
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
      if (!messagingPodporovane || !messaging) {
        return { ok: false, dovod: "MESSAGING_NEPODPOROVANE" };
      }
      try {
        const swReg = await getBd642ServiceWorkerRegistration();
        const token = await messaging.getToken({
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
        return { ok: false, dovod: "CHYBA_REFRESH", detail: String(e && e.message ? e.message : e) };
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
