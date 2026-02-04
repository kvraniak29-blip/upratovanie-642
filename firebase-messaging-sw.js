// firebase-messaging-sw.js
// Service worker pre FCM – BD 642 upratovanie

/* 
   POZOR:
   - tento súbor musí byť v koreňovom adresári webu
     (napr. https://tvoja-domena.sk/firebase-messaging-sw.js)
   - názov musí byť presne "firebase-messaging-sw.js"
*/

// Načítanie Firebase (compat verzie)
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging-compat.js");

// Rovnaká config ako v bd642_firebase_messaging.js
var firebaseConfig = {
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
  messagingSenderId: "530262860262",
  appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
  measurementId: "G-1PB3714CD6"
};

// Inicializácia Firebase v service workeri
try {
  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
} catch (e) {
  console.error("BD642 FCM [SW]: chyba pri firebase.initializeApp:", e);
}

// Získanie messaging inštancie
var messaging = null;
try {
  if (firebase.messaging) {
    messaging = firebase.messaging();
  } else {
    console.warn("BD642 FCM [SW]: firebase.messaging nie je k dispozícii.");
  }
} catch (e) {
  console.error("BD642 FCM [SW]: chyba pri získaní messaging inštancie:", e);
}

// Background správy z FCM
if (messaging) {
  messaging.onBackgroundMessage(function (payload) {
    console.log("BD642 FCM [SW]: prijatá background správa:", payload);

    var notif = payload.notification || {};
    var data = payload.data || {};

    var title =
      notif.title || "BD 642 – nové upozornenie";
    var options = {
      body: notif.body || "",
      icon:
        notif.icon ||
        "/icons/icon-192.png", // môžeš neskôr zmeniť na reálnu ikonu
      badge: notif.badge || "/icons/icon-72.png",
      data: {
        url: data.url || data.click_action || "/",
        rawData: data
      }
    };

    self.registration.showNotification(title, options);
  });
}

// Klik na notifikáciu – otvorí / zaostrí okno
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var targetUrl = "/";
  try {
    if (event.notification && event.notification.data) {
      targetUrl =
        event.notification.data.url ||
        event.notification.data.click_action ||
        "/";
    }
  } catch (e) {
    // necháme default "/"
  }

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.indexOf(targetUrl) !== -1 && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
