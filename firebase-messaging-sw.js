// firebase-messaging-sw.js
// BD642 – Service Worker pre FCM + PWA installability (Firebase SDK v8 kompat)

importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js");
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js");

var firebaseConfig = {
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  storageBucket: "bd-642-26-upratovanie-d2851.appspot.com",
  messagingSenderId: "125304312299",
  appId: "1:125304312299:web:4f8f6416904fe697e82e11"
};

firebase.initializeApp(firebaseConfig);

var messaging = firebase.messaging();

// (1) FCM background handler (v8)
messaging.onBackgroundMessage(function(payload) {
  try {
    var notif = (payload && payload.notification) ? payload.notification : {};
    var title = notif.title || "BD 642 – Upozornenie";
    var body = notif.body || "";
    var url = (payload && payload.data && payload.data.url) ? payload.data.url : "./";

    return self.registration.showNotification(title, {
      body: body,
      data: { url: url },
      icon: "./icon-192.png",
      badge: "./icon-192.png"
    });
  } catch (e) {
    // fallback (nech to nespadne)
    return self.registration.showNotification("BD 642 – Upozornenie", {
      body: "Prišla správa.",
      icon: "./icon-192.png",
      badge: "./icon-192.png"
    });
  }
});

// (2) Notification click → otvor link
self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  var url = (event.notification && event.notification.data && event.notification.data.url) ? event.notification.data.url : "./";

  event.waitUntil((async function() {
    try {
      var allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (var i = 0; i < allClients.length; i++) {
        var c = allClients[i];
        if (c && "focus" in c) {
          c.postMessage({ type: "BD642_NAVIGATE", url: url });
          return c.focus();
        }
      }
      return clients.openWindow(url);
    } catch (e) {
      return clients.openWindow(url);
    }
  })());
});

// (3) PWA installability: fetch handler (Chrome/Edge vyžadujú „fetch“ v SW)
self.addEventListener("fetch", function(event) {
  // Neinterceptujeme nič – len aby existoval fetch listener
});