import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-analytics.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
  messagingSenderId: "530262860262",
  appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
  measurementId: "G-1PB3714CD6"
};

const VAPID_VEREJNY_KLUC = "BHnnUHjr7ujW1Do0bJBbZqL8G9WmJsVmjE859krH6eS3uJ9YUSAex7cnjEJxATx2dXbcPN7Xv9zzppRDE4ZFWZw";

const app = initializeApp(firebaseConfig);
try { getAnalytics(app); } catch(e) {}

async function bd642ZaregistrujServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return await navigator.serviceWorker.register("/firebase-messaging-sw.js");
}

async function bd642ZapnutUpozornenia(povinneKliknutie = true) {
  // povinneKliknutie = true -> volaj z tlačidla
  // povinneKliknutie = false -> volaj po prihlásení (len pokus)

  const podporovane = await isSupported().catch(() => false);
  if (!podporovane) {
    console.warn("Notifikácie nie sú podporované v tomto prehliadači.");
    return { ok:false, dovod:"NEPODPOROVANE" };
  }

  const swReg = await bd642ZaregistrujServiceWorker();

  if (!swReg) {
    console.warn("Service Worker sa nepodarilo zaregistrovať.");
    return { ok:false, dovod:"SERVICE_WORKER" };
  }

  // Žiadosť o povolenie – prehliadač môže bloknúť, ak to nešlo cez klik
  const povolenie = await Notification.requestPermission().catch(() => "denied");
  if (povolenie !== "granted") {
    console.warn("Používateľ nepovolil notifikácie:", povolenie);
    return { ok:false, dovod:"NEPOVOLENE", povolenie };
  }

  const messaging = getMessaging(app);

  const token = await getToken(messaging, {
    vapidKey: VAPID_VEREJNY_KLUC,
    serviceWorkerRegistration: swReg
  }).catch((e) => {
    console.error("getToken zlyhalo:", e);
    return null;
  });

  if (!token) return { ok:false, dovod:"TOKEN" };

  console.log("FCM token:", token);

  // TODO: sem si neskôr doplníme uloženie tokenu (napr. Firestore) podľa tvojho modelu používateľov
  // napr. POST na vlastný endpoint alebo Firestore zápis

  return { ok:true, token };
}

// Notifikácia keď je stránka otvorená (foreground)
(async () => {
  const podporovane = await isSupported().catch(() => false);
  if (!podporovane) return;
  const messaging = getMessaging(app);
  onMessage(messaging, (payload) => {
    console.log("Foreground správa:", payload);
    // tu si môžeš urobiť vlastné UI toast okno
  });
})();

// 2️⃣ TLAČIDLO: zavolaj window.BD642_ZapnutUpozornenia() z tvojho tlačidla
window.BD642_ZapnutUpozornenia = () => bd642ZapnutUpozornenia(true);

// 3️⃣ PO PRIHLÁSENÍ: v tvojom kóde po prihlásení zavolaj:
 // window.dispatchEvent(new Event("BD642:PoPrihlaseni"));
window.addEventListener("BD642:PoPrihlaseni", async () => {
  // pokus – môže byť bloknutý, ak neprebehol klik (záleží od prehliadača)
  await bd642ZapnutUpozornenia(false);
});