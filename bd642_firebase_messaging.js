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
      jePodporovane: function () { return false; },
      zapnutUpozornenia: function () {
        return Promise.resolve({ ok: false, dovod: "NEPODPOROVANE", detail: "FIREBASE_CHYBA" });
      },
      vypisatTokenDoKonzoly: function () {},
      refreshToken: function () {
        return Promise.resolve({ ok: false, dovod: "NEPODPOROVANE" });
      },
      ulozTokenManualne: function () {
        return Promise.resolve({ ok: false, dovod: "NEPODPOROVANE" });
      }
    };
    window.BD642_ZapnutUpozornenia = async function () {
      return { ok: false, dovod: "NEPODPOROVANE", detail: "FIREBASE_CHYBA" };
    };
    return;
  }

  // Tu očakávame, že firebase už máš inicializovaný v index.html
  // (firebase.initializeApp(...)) a máš k dispozícii firebase.messaging()

  let messagingPodporovane = true;
  let messaging = null;

  try {
    if (!firebase.messaging) {
      console.warn("BD642 FCM: firebase.messaging nie je k dispozícii.");
      messagingPodporovane = false;
    } else {
      messaging = firebase.messaging();
      if (typeof messaging.isSupported === "function") {
        try {
          messagingPodporovane = messaging.isSupported();
        } catch (e) {
          console.warn("BD642 FCM: chyba pri messaging.isSupported(), budeme predpokladať podporu:", e);
          messagingPodporovane = true;
        }
      } else {
        messagingPodporovane = true;
      }
    }
  } catch (e) {
    console.error("BD642 FCM: neočakávaná chyba pri inicializácii messagingu:", e);
    messagingPodporovane = false;
  }

  // Pomocná funkcia: vráti informáciu, či je Messaging podporný
  function jeMessagingPodporovane() {
    return !!(messagingPodporovane && messaging);
  }

  // --- Práca s Firestore – ukladanie tokenov podľa rodiny ------------------

  let firestore = null;
  try {
    if (firebase.firestore) {
      firestore = firebase.firestore();
    } else {
      console.warn("BD642 FCM: firebase.firestore nie je k dispozícii – tokeny sa nebudú ukladať.");
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri inicializácii Firestore:", e);
  }

  /**
   * Získa identifikátor rodiny z localStorage (alebo iného zdroja).
   * Tu predpokladáme, že si ho niekde ukladáš pri prihlásení.
   */
  function ziskajAktualnuRodinuId() {
    try {
      const ulozene = window.localStorage.getItem("bd642_rodina_id");
      if (ulozene && typeof ulozene === "string" && ulozene.trim() !== "") {
        return ulozene.trim();
      }
    } catch (e) {
      console.warn("BD642 FCM: nepodarilo sa načítať bd642_rodina_id z localStorage:", e);
    }
    return null;
  }

  /**
   * Uloženie FCM tokenu do Firestore pod danú rodinu.
   * ŠTRUKTÚRA:
   *   rodiny/{rodinaId}/fcm_tokens/{token}
   *
   * Token sa NEMAŽE automaticky pri odhlásení – ostáva trvalý,
   * kým ho niekto vyslovene neodstráni zo systému.
   */
  async function ulozTokenDoFirestore(token) {
    if (!firestore) {
      console.warn("BD642 FCM: Firestore nie je k dispozícii – token nevieme uložiť.");
      return { ok: false, dovod: "FIRESTORE_NEDOSTUPNE" };
    }

    const rodinaId = ziskajAktualnuRodinuId();
    if (!rodinaId) {
      console.warn("BD642 FCM: rodinaId nie je nastavené – token sa neuloží.");
      return { ok: false, dovod: "RODINA_NEZNAMA" };
    }

    try {
      const now = new Date();
      const docRef = firestore
        .collection("rodiny")
        .doc(rodinaId)
        .collection("fcm_tokens")
        .doc(token);

      await docRef.set(
        {
          token: token,
          rodinaId: rodinaId,
          naposledyAktualizovane: firebase.firestore.FieldValue.serverTimestamp(),
          naposledyAktualizovaneLocal: now.toISOString(),
          aktivne: true
        },
        { merge: true }
      );

      console.log("BD642 FCM: token uložený pre rodinu", rodinaId, token);
      return { ok: true };
    } catch (e) {
      console.error("BD642 FCM: chyba pri ukladaní tokenu do Firestore:", e);
      return { ok: false, dovod: "ULOZENIE_CHYBA", detail: e && e.message ? e.message : String(e) };
    }
  }

  // --- Získanie registrácie service workera pre Messaging -------------------

  async function getBd642ServiceWorkerRegistration() {
    if (!("serviceWorker" in navigator)) {
      console.warn("BD642 FCM: Service Worker nie je podporovaný v tomto prehliadači.");
      return null;
    }

    try {
      // Použijeme už existujúcu registráciu pre aktuálnu aplikáciu, ak je.
      const registrations = await navigator.serviceWorker.getRegistrations();
      const existingForScope = registrations.find((reg) => {
        return reg.active && reg.active.scriptURL && reg.active.scriptURL.includes("firebase-messaging-sw.js");
      });

      if (existingForScope) {
        console.log("BD642 FCM: našli sme existujúci firebase-messaging-sw.js:", existingForScope);
        return existingForScope;
      }

      // Ak nič nenašlo, zaregistrujeme nanovo (relatívne ku koreňu webu).
      const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      console.log("BD642 FCM: service worker firebase-messaging-sw.js zaregistrovaný:", reg);
      return reg;
    } catch (e) {
      console.error("BD642 FCM: chyba pri práci so service workerom:", e);
      return null;
    }
  }

  // --- Zapnutie upozornení – vnútorná logika -------------------------------

  async function vnutorneZapnutUpozornenia() {
    if (!jeMessagingPodporovane()) {
      return { ok: false, dovod: "MESSAGING_NEPODPOROVANE", detail: "messaging nepodporovaný" };
    }

    if (!("Notification" in window)) {
      return { ok: false, dovod: "NOTIFICATION_API_NEDOSTUPNE", detail: "Notification API nie je k dispozícii" };
    }

    // 1) overíme stav oprávnení
    if (Notification.permission === "denied") {
      return {
        ok: false,
        dovod: "NOTIFICATION_PERMISSION_ZAMIETNUTE",
        detail: "Používateľ už notifikácie zamietol"
      };
    }

    // 2) Ak je "default", vypýtame si povolenie
    if (Notification.permission === "default") {
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        return {
          ok: false,
          dovod: "NOTIFICATION_PERMISSION_ZAMIETNUTE",
          detail: "Používateľ notifikácie nepovolil"
        };
      }
    }

    // 3) Registrácia service workera
    const registration = await getBd642ServiceWorkerRegistration();
    if (!registration) {
      return { ok: false, dovod: "SW_NEDOSTUPNY", detail: "Nepodarilo sa získať registráciu SW" };
    }

    // 4) Získanie FCM tokenu
    try {
      const vapidKey = "TU_DAJ_SVOJ_VAPID_KEY_Z_FIREBASE"; // už máš nastavené v pôvodnom kóde
      const token = await messaging.getToken({
        vapidKey: vapidKey,
        serviceWorkerRegistration: registration
      });

      if (!token) {
        return { ok: false, dovod: "TOKEN_CHYBA", detail: "getToken vrátil prázdnu hodnotu" };
      }

      // 5) Uloženie tokenu do Firestore pod danú rodinu (trvalo)
      const ulozRes = await ulozTokenDoFirestore(token);
      if (!ulozRes.ok) {
        console.warn("BD642 FCM: token sa nepodarilo uložiť do Firestore, ale token máme:", ulozRes);
        // Notifikácie aj tak môžu fungovať, takže token vrátime
      }

      console.log("BD642 FCM: získaný FCM token:", token);
      return { ok: true, token: token };
    } catch (e) {
      console.error("BD642 FCM: chyba pri získavaní FCM tokenu:", e);
      return {
        ok: false,
        dovod: "TOKEN_CHYBA",
        detail: e && e.message ? e.message : String(e)
      };
    }
  }

  // --- Verejné API pre appku -----------------------------------------------

  window.BD642_ZapnutUpozornenia = async function () {
    try {
      // 1) Základná detekcia podpory
      if (!messagingPodporovane || !messaging) {
        return {
          ok: false,
          dovod: "NEPODPOROVANE",
          detail: "MESSAGING_NEPODPOROVANE"
        };
      }

      if (!("Notification" in window)) {
        return {
          ok: false,
          dovod: "NEPODPOROVANE",
          detail: "NOTIFICATION_API_NEDOSTUPNE"
        };
      }

      // 2) Vnútorná logika – reálne zapnutie a uloženie tokenu
      const res = await vnutorneZapnutUpozornenia();

      if (res && res.ok && res.token) {
        // Pre HTML appku posielame len {ok:true, token}
        return { ok: true, token: res.token };
      }

      // 3) Namapujeme vnútorné dôvody na jednoduché kódy pre UI
      const internal = res && res.dovod ? res.dovod : "NEZNAME";
      let dovod;

      if (
        internal === "MESSAGING_NEPODPOROVANE" ||
        internal === "NOTIFICATION_API_NEDOSTUPNE" ||
        internal === "SW_NEDOSTUPNY"
      ) {
        dovod = "NEPODPOROVANE";
      } else if (internal === "NOTIFICATION_PERMISSION_ZAMIETNUTE") {
        dovod = "NEPOVOLENE";
      } else {
        dovod = "ERR";
      }

      return {
        ok: false,
        dovod,
        detail: internal
      };
    } catch (e) {
      console.error("BD642_ZapnutUpozornenia – neošetrená chyba:", e);
      return {
        ok: false,
        dovod: "ERR",
        detail: e && e.message ? e.message : String(e)
      };
    }
  };

  // Malé API na manuálne volanie z appky, ak by si chcel
  window.BD642_FCM = {
    jePodporovane: function () {
      return jeMessagingPodporovane();
    },
    /**
     * Zabalenie vnutorneZapnutUpozornenia – môžeš použiť aj priamo, ale odporúčam BD642_ZapnutUpozornenia,
     * lebo vracia už "zjednodušené" dôvody pre UI.
     */
    zapnutUpozornenia: function () {
      return vnutorneZapnutUpozornenia();
    },
    /**
     * Len vypíše aktuálny token do konzoly (ak sa dá získať).
     */
    vypisatTokenDoKonzoly: async function () {
      if (!jeMessagingPodporovane()) {
        console.warn("BD642 FCM: Messaging nepodporovaný, token nevypisujem.");
        return;
      }
      try {
        const registration = await getBd642ServiceWorkerRegistration();
        if (!registration) {
          console.warn("BD642 FCM: Service worker nie je zaregistrovaný, token nezískame.");
          return;
        }
        const vapidKey = "TU_DAJ_SVOJ_VAPID_KEY_Z_FIREBASE";
        const token = await messaging.getToken({
          vapidKey: vapidKey,
          serviceWorkerRegistration: registration
        });
        console.log("BD642 FCM: aktuálny token:", token);
      } catch (e) {
        console.error("BD642 FCM: chyba pri vypisovaní tokenu:", e);
      }
    },
    /**
     * Vynútenie refreshu tokenu (napr. ak si menil VAPID key a podobne).
     */
    refreshToken: async function () {
      if (!jeMessagingPodporovane()) {
        return { ok: false, dovod: "MESSAGING_NEPODPOROVANE" };
      }
      try {
        await messaging.deleteToken();
        const registration = await getBd642ServiceWorkerRegistration();
        if (!registration) {
          return { ok: false, dovod: "SW_NEDOSTUPNY" };
        }
        const vapidKey = "TU_DAJ_SVOJ_VAPID_KEY_Z_FIREBASE";
        const token = await messaging.getToken({
          vapidKey: vapidKey,
          serviceWorkerRegistration: registration
        });
        if (!token) {
          return { ok: false, dovod: "TOKEN_CHYBA" };
        }
        const ulozRes = await ulozTokenDoFirestore(token);
        if (!ulozRes.ok) {
          console.warn("BD642 FCM: token po refreshi sa nepodarilo uložiť do Firestore:", ulozRes);
        }
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
