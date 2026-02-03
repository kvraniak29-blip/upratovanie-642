// bd642_firebase_messaging.js
// Správa push upozornení + ukladanie FCM tokenu do Firestore

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-messaging.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

// Konfigurácia Firebase (z konzoly)
const firebaseConfig = {
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
  messagingSenderId: "530262860262",
  appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
  measurementId: "G-1PB3714CD6"
};

// Verejný kľúč pre web push (VAPID)
const verejnyVapidKluc = "BHnnUHjr7ujW1Do0bJBbZqL8G9WmJsVmjE859krH6eS3uJ9YUSAex7cnjEJxATx2dXbcPN7Xv9zzppRDE4ZFWZw";

// Inicializácia aplikácie
const app = initializeApp(firebaseConfig);
const sprava = getMessaging(app);
const databaza = getFirestore(app);

// Pomocná funkcia – uloženie tokenu do Firestore
async function ulozTokenDoFirestore(token) {
  try {
    // zbierka: "fcm_tokeny", dokument: podľa tokenu
    const dokumentOdkaz = doc(databaza, "fcm_tokeny", token);

    await setDoc(
      dokumentOdkaz,
      {
        token: token,
        vytvorene: serverTimestamp(),
        // sem môžeš neskôr doplniť napr. meno rodiny / byt:
        // pouzivatel: "Vranjak",
      },
      { merge: true }
    );

    console.log("FCM token uložený do Firestore.");
  } catch (chyba) {
    console.error("Chyba pri ukladaní tokenu do Firestore:", chyba);
  }
}

// Požiada o povolenie na upozornenia a získa/uloží token
export async function inicializujUpozorneniaBD642() {
  try {
    console.log("Žiadam o povolenie na upozornenia...");

    const povolenie = await Notification.requestPermission();

    if (povolenie !== "granted") {
      console.warn("Upozornenia zamietnuté používateľom.");
      return;
    }

    console.log("Povolenie udelené, získavam FCM token...");

    const aktualnyToken = await getToken(sprava, {
      vapidKey: verejnyVapidKluc
    });

    if (!aktualnyToken) {
      console.warn("Token sa nepodarilo získať (pravdepodobne blokované).");
      return;
    }

    console.log("FCM token:", aktualnyToken);
    await ulozTokenDoFirestore(aktualnyToken);
  } catch (chyba) {
    console.error("Chyba pri inicializácii upozornení BD642:", chyba);
  }
}

// Spracovanie správ, kým je stránka otvorená
onMessage(sprava, (payload) => {
  console.log("Prijatá správa na popredí:", payload);
});
