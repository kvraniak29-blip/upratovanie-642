// firebase-messaging-sw.js
// Service worker pre FCM – spracovanie push notifikácií na pozadí

importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js");
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js");

firebase.initializeApp({
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
  messagingSenderId: "530262860262",
  appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
  measurementId: "G-1PB3714CD6"
});

const messaging = firebase.messaging();

// Správy, keď appka nie je otvorená
messaging.setBackgroundMessageHandler(function (payload) {
  console.log("BD642 FCM SW: background message", payload);

  const title =
    (payload.notification && payload.notification.title) ||
    "BD 642 – Upratovanie";
  const body =
    (payload.notification && payload.notification.body) ||
    "Nové upozornenie z BD 642.";
  const icon = "/icon-192.png";

  const options = {
    body: body,
    icon: icon,
    data: payload.data || {}
  };

  return self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      function (clientList) {
        if (clientList.length > 0) {
          return clientList[0].focus();
        }
        return clients.openWindow("/");
      }
    )
  );
});
