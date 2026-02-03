/* BD642 – Firebase Cloud Messaging integrácia
   Tento súbor je generovaný skriptom. Ak ho upravuješ ručne, ber to do úvahy pri ďalších generovaniach.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js";

// Firebase konfigurácia pre BD 642 – Upratovanie
const firebaseConfig = {
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
  messagingSenderId: "530262860262",
  appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
  measurementId: "G-1PB3714CD6"
};

// Verejný VAPID kľúč pre Web Push
const vapidKey = "BHnnUHjr7ujW1Do0bJBbZqL8G9WmJsVmjE859krH6eS3uJ9YUSAex7cnjEJxATx2dXbcPN7Xv9zzppRDE4ZFWZw";

// Inicializácia Firebase aplikácie a Messaging
const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

// Registrácia service workera pre FCM
async function registerBD642ServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    console.warn("BD642 FCM: Service Worker nie je podporovaný v tomto prehliadači.");
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    console.log("BD642 FCM: Service worker zaregistrovaný:", reg);
    return reg;
  } catch (err) {
    console.error("BD642 FCM: Chyba pri registrácii service workera:", err);
    return null;
  }
}

// Hlavná funkcia, ktorú volá HTML tlačidlo „Zapnúť push“
async function BD642_ZapnutUpozornenia() {
  try {
    if (!("Notification" in window)) {
      console.warn("BD642 FCM: Notifikácie nie sú podporované.");
      return { ok: false, dovod: "NEPODPOROVANE" };
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("BD642 FCM: Notifikácie neboli povolené:", permission);
      return { ok: false, dovod: "NEPOVOLENE" };
    }

    const reg = await registerBD642ServiceWorker();
    if (!reg) {
      return { ok: false, dovod: "SW_FAIL" };
    }

    let token;
    try {
      token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: reg
      });
    } catch (errToken) {
      console.error("BD642 FCM: Chyba pri získavaní tokenu:", errToken);
      return { ok: false, dovod: "CHYBA", detail: String(errToken) };
    }

    if (!token) {
      console.warn("BD642 FCM: Token sa nepodarilo získať");
      return { ok: false, dovod: "TOKEN_EMPTY" };
    }

    console.log("BD642 FCM token:", token);
    console.log("Tento token si ulož (napr. do DB alebo Firestore) – zatiaľ je len v konzole.");
    return { ok: true, token };
  } catch (err) {
    console.error("BD642 FCM: Neočakávaná chyba:", err);
    return { ok: false, dovod: "CHYBA", detail: String(err) };
  }
}

// Foreground správy (keď je stránka otvorená)
onMessage(messaging, (payload) => {
  console.log("BD642 FCM – foreground správa:", payload);
});

window.BD642_ZapnutUpozornenia = BD642_ZapnutUpozornenia;
