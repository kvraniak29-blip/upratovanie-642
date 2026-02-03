// bd642_firebase_messaging.js
// Nastavenie Firebase pre Upratovací plánovač BD 642

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

// Konfigurácia projektu (tá, čo si posielal)
const firebaseConfig = {
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
  messagingSenderId: "530262860262",
  appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
  measurementId: "G-1PB3714CD6"
};

// Verejný VAPID kľúč (ten, čo si posielal)
const vapidPublicKey = "BHnnUHjr7ujW1Do0bJBbZqL8G9WmJsVmjE859krH6eS3uJ9YUSAex7cnjEJxATx2dXbcPN7Xv9zzppRDE4ZFWZw";

// Inicializácia aplikácie
const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);
const db = getFirestore(app);

// Uloženie FCM tokenu do Firestore
async function ulozTokenDoFirestore(token) {
  try {
    const docRef = doc(db, "fcm_tokens", token); // dokument bude mať ID = token

    await setDoc(
      docRef,
      {
        token: token,
        vytvorene: serverTimestamp(),
        poslednaAktualizacia: serverTimestamp(),
        prehliadac: window.navigator.userAgent || null,
        jazyk: window.navigator.language || null,
        zdroj: "upratovaci_planovac_bd642"
      },
      { merge: true }
    );

    console.log("BD642 FCM: token uložený do Firestore:", token);
  } catch (e) {
    console.error("BD642 FCM: chyba pri ukladaní tokenu do Firestore:", e);
  }
}

// Hlavná funkcia – registrácia notifikácií a tokenu
async function nastavFirebaseNotifikacie() {
  try {
    if (!("Notification" in window)) {
      console.warn("BD642 FCM: tento prehliadač nepodporuje oznámenia.");
      return;
    }

    // Povolenie oznámení
    if (Notification.permission === "denied") {
      console.warn("BD642 FCM: oznámenia sú ZAKÁZANÉ v prehliadači.");
      return;
    }

    if (Notification.permission !== "granted") {
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        console.warn("BD642 FCM: používateľ nepovolil oznámenia.");
        return;
      }
    }

    // Registrácia service workera
    console.log("BD642 FCM: registrujem service worker...");
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    console.log("BD642 FCM: service worker zaregistrovaný:", registration.scope);

    // Získanie FCM tokenu
    const token = await getToken(messaging, {
      vapidKey: vapidPublicKey,
      serviceWorkerRegistration: registration
    });

    if (!token) {
      console.warn("BD642 FCM: nepodarilo sa získať FCM token.");
      return;
    }

    console.log("BD642 FCM: získaný FCM token z prehliadača:", token);

    // Uložiť token do Firestore
    await ulozTokenDoFirestore(token);

  } catch (e) {
    console.error("BD642 FCM: chyba pri nastavovaní FCM:", e);
  }
}

// Spracovanie správ, keď je stránka otvorená (v popredí)
onMessage(messaging, (payload) => {
  console.log("BD642 FCM: prijatá správa v popredí:", payload);
});

// Spustiť nastavenie po načítaní stránky
window.addEventListener("load", () => {
  nastavFirebaseNotifikacie();
});
