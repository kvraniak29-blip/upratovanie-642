// bd642_firebase_messaging.js
// Push notifikácie + ukladanie FCM tokenov do Firestore
// BD 642 – Upratovací plánovač

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-messaging.js";
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

// -----------------------------------------------------------------------------
// 1) Konfigurácia projektu – presne podľa Firebase konzoly
// -----------------------------------------------------------------------------
const konfiguraciaFirebase = {
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
  messagingSenderId: "530262860262",
  appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
  measurementId: "G-1PB3714CD6"
};

// Verejný VAPID kľúč pre Web Push (z Firebase konzoly)
const verejnyVapidKluc =
  "BHnnUHjr7ujW1Do0bJBbZqL8G9WmJsVmjE859krH6eS3uJ9YUSAex7cnjEJxATx2dXbcPN7Xv9zzppRDE4ZFWZw";

// Názov zberu (kolekcie) vo Firestore, kde budú uložené tokeny
const nazovZberuTokenov = "uzivatelia_tokens";

// -----------------------------------------------------------------------------
// 2) Pomocné funkcie pre logovanie
// -----------------------------------------------------------------------------
function logInfo(sprava, data) {
  if (data !== undefined) {
    console.log("BD642 FCM [INFO]: " + sprava, data);
  } else {
    console.log("BD642 FCM [INFO]: " + sprava);
  }
}

function logVarovanie(sprava, data) {
  if (data !== undefined) {
    console.warn("BD642 FCM [VAROVANIE]: " + sprava, data);
  } else {
    console.warn("BD642 FCM [VAROVANIE]: " + sprava);
  }
}

function logChyba(sprava, chyba) {
  if (chyba !== undefined) {
    console.error("BD642 FCM [CHYBA]: " + sprava, chyba);
  } else {
    console.error("BD642 FCM [CHYBA]: " + sprava);
  }
}

// -----------------------------------------------------------------------------
// 3) Uloženie FCM tokenu do Firestore
//    - zber:  uzivatelia_tokens
//    - dokument: podľa tokenu (ID je samotný token)
// -----------------------------------------------------------------------------
async function ulozTokenDoFirestore(aplikacia, token) {
  try {
    const db = getFirestore(aplikacia);

    // dokument má ID = samotný token (jednoznačné, jednoduché)
    const docRef = doc(db, nazovZberuTokenov, token);

    const data = {
      token: token,
      prehliadac: navigator.userAgent || "neznamy",
      jazyk: navigator.language || "neznamy",
      aktualizovane: serverTimestamp()
    };

    await setDoc(docRef, data, { merge: true });

    logInfo("Token bol uložený do Firestore (zber '" + nazovZberuTokenov + "').");
  } catch (e) {
    logChyba("Nepodarilo sa uložiť token do Firestore.", e);
  }
}

// -----------------------------------------------------------------------------
// 4) Hlavná inicializácia – spúšťa sa pri načítaní stránky
// -----------------------------------------------------------------------------
(async () => {
  try {
    // 4.1 Overenie podpory FCM v prehliadači
    const podpora = await isSupported();
    if (!podpora) {
      logVarovanie(
        "Prehliadač nepodporuje Firebase Cloud Messaging – push notifikácie nebudú fungovať."
      );
      return;
    }

    if (!("serviceWorker" in navigator)) {
      logVarovanie(
        "Service worker nie je podporovaný – push notifikácie nebudú fungovať."
      );
      return;
    }

    // 4.2 Inicializácia Firebase aplikácie
    const aplikacia = initializeApp(konfiguraciaFirebase);
    const messaging = getMessaging(aplikacia);

    logInfo("Firebase aplikácia pre BD642 bola inicializovaná.");

    // 4.3 Registrácia service workera
    const registraciaSW = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js"
    );
    logInfo("Service worker zaregistrovaný:", registraciaSW);

    // 4.4 Vyžiadanie povolenia na zobrazenie upozornení
    const povolenie = await Notification.requestPermission();
    logInfo("Stav povolenia notifikácií: " + povolenie);

    if (povolenie !== "granted") {
      logVarovanie(
        "Používateľ nepovolil notifikácie – token sa nezíska a neuloží."
      );
      return;
    }

    // 4.5 Získanie FCM tokenu
    const token = await getToken(messaging, {
      vapidKey: verejnyVapidKluc,
      serviceWorkerRegistration: registraciaSW
    });

    if (!token) {
      logVarovanie("FCM token sa nepodarilo získať (prázdna hodnota).");
      return;
    }

    logInfo("BD642 FCM token (pre tento prehliadač):");
    console.log(token);

    // 4.6 Uloženie tokenu do Firestore
    await ulozTokenDoFirestore(aplikacia, token);

    // 4.7 Spracovanie správ prijatých počas otvorenej stránky
    onMessage(messaging, (payload) => {
      logInfo("Prijatá FCM správa v popredí:", payload);

      // Tu môžeš neskôr doplniť vlastné zobrazenie upozornenia v UI aplikácie
      // (napr. toast, banner, zvuk a pod.).
    });
  } catch (e) {
    logChyba("Chyba pri inicializácii push notifikácií.", e);
  }
})();
