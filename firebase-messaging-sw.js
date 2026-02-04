// firebase-messaging-sw.js
// Service worker pre FCM – BD 642
// Musí byť v tom istom "root scope", kde beží app
// (na GitHub Pages / Firebase Hostingu v koreňovom "public").

importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js");
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js");

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

// Inicializácia Firebase v service worker-i
firebase.initializeApp(firebaseConfig);

var messaging = null;
try {
  if (firebase.messaging && firebase.messaging.isSupported && firebase.messaging.isSupported()) {
    messaging = firebase.messaging();
  }
} catch (e) {
  // Ak by prehliadač Messaging nepodporoval, nechceme spadnúť
  console.warn("BD642 SW: Firebase Messaging nie je podporovaný alebo nastala chyba:", e);
}

/**
 * Backend (Cloud Functions / server) posiela WebPush tak, že FCM payload obsahuje:
 *
 * 1) "notification": { ... } - klasický blok, ktorý FCM vie priamo zobraziť
 * 2) "data": { ... }         - vlastné dáta (rodina, url, typ, atď.)
 *
 * Tento service worker spraví:
 *  - prečíta data / notification
 *  - zobrazí notifikáciu cez self.registration.showNotification(...)
 *  - v notificationclick otvorí / dofokusuje príslušnú URL (napr. kalendár / chat)
 */

if (messaging) {
  messaging.onBackgroundMessage(function (payload) {
    // Môže prísť payload v rôznych formách, snažíme sa správať robustne
    console.log("[BD642 SW] Background message received:", payload);

    var data = (payload && payload.data) ? payload.data : {};

    // Názov / text notifikácie
    var title =
      (payload.notification && payload.notification.title) ||
      data.title ||
      "BD 642 – upozornenie";

    var body =
      (payload.notification && payload.notification.body) ||
      data.body ||
      "Máte nové upozornenie.";

    // Ikony – môžu byť doplnené aj z data
    var icon = data.icon || (payload.notification && payload.notification.icon) || "/icon-192.png";
    var badge = data.badge || (payload.notification && payload.notification.badge) || "/icon-192.png";

    // URL, na ktorú chceme kliknutím prejsť – backend ju môže posielať v data.targetUrl
    var targetUrl = data.targetUrl || data.url || "/";

    var notificationOptions = {
      body: body,
      icon: icon,
      badge: badge,
      data: {
        // uložíme si URL do data, aby sme s ňou vedeli pracovať pri clicku
        url: targetUrl,
        rawData: data
      },
      // napr. tag podľa typu, aby sa notifikácie „spájali“
      tag: data.tag || "bd642-notification",
      renotify: data.renotify === "true" || data.renotify === true
    };

    self.registration.showNotification(title, notificationOptions);
  });
}

// Reakcia na kliknutie na notifikáciu
self.addEventListener("notificationclick", function (event) {
  console.log("[BD642 SW] notificationclick:", event);

  event.notification.close();

  var targetUrl = (event.notification && event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : "/";

  // Pokúsime sa nájsť už otvorený klient (tab) s danou URL a prepnúť naň
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client && "focus" in client) {
            try {
              if (targetUrl && client.url && client.url.indexOf(targetUrl) !== -1) {
                return client.focus();
              }
            } catch (_) {}
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
