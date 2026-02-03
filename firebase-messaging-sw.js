/* BD642 – Firebase Cloud Messaging service worker
   Pozn.: beží na /firebase-messaging-sw.js v koreňovom hostingu.
*/

importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

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

messaging.onBackgroundMessage(function(payload) {
  console.log("BD642 FCM – background správa:", payload);

  const notificationTitle =
    (payload.notification && payload.notification.title) ||
    "Upratovací plánovač BD 642";

  const notificationOptions = {
    body: (payload.notification && payload.notification.body) || "",
    icon: "/icon-192.png",
    data: payload.data || {}
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.click_action) || "/";
  event.waitUntil(clients.openWindow(targetUrl));
});
