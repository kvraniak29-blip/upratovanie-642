// firebase-messaging-sw.js
// Servisný pracovník pre prijímanie push správ na pozadí

importScripts("https://www.gstatic.com/firebasejs/12.8.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.8.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
  messagingSenderId: "530262860262",
  appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
  measurementId: "G-1PB3714CD6"
});

const sprava = firebase.messaging();

// Môžeš si prispôsobiť vzhľad upozornení na pozadí
sprava.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Správa na pozadí:", payload);

  const oznamenie = payload.notification || {};
  const nadpis = oznamenie.title || "Upozornenie BD 642";
  const text = oznamenie.body || "";
  const ikona = oznamenie.icon || "/icon-192.png";

  self.registration.showNotification(nadpis, {
    body: text,
    icon: ikona
  });
});
