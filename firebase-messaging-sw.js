// firebase-messaging-sw.js
// Service worker pre FCM – BD 642
// Musí byť v tom istom "root scope", kde beží app (na GitHub Pages typicky v subceste projektu).

importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging-compat.js");

var firebaseConfig = {
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
  messagingSenderId: "530262860262",
  appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
  measurementId: "G-1PB3714CD6"
};

try {
  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
} catch (e) {
  console.error("BD642 FCM [SW]: firebase.initializeApp chyba:", e);
}

var messaging = null;
try {
  if (firebase.messaging) messaging = firebase.messaging();
} catch (e2) {
  console.error("BD642 FCM [SW]: firebase.messaging chyba:", e2);
}

function safeGet(obj, path, defVal) {
  try {
    var parts = path.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length; i++) cur = cur[parts[i]];
    return (cur === undefined || cur === null) ? defVal : cur;
  } catch (_) {
    return defVal;
  }
}

if (messaging) {
  messaging.onBackgroundMessage(function (payload) {
    console.log("BD642 FCM [SW]: background správa:", payload);

    var title = safeGet(payload, "notification.title", "BD 642 – upozornenie");
    var body = safeGet(payload, "notification.body", "");

    // preferuj payload.data.url, inak fallback na scope root
    var url = safeGet(payload, "data.url", null) || safeGet(payload, "data.click_action", null);

    // scope root = miesto, kde je SW zaregistrovaný
    var scopeRoot = (self.registration && self.registration.scope) ? self.registration.scope : "/";

    var targetUrl = url || scopeRoot;

    var options = {
      body: body,
      icon: safeGet(payload, "notification.icon", "icon-192.png"),
      badge: safeGet(payload, "notification.badge", "icon-192.png"),
      data: { url: targetUrl }
    };

    self.registration.showNotification(title, options);
  });
}

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var targetUrl = "/";
  try {
    if (event.notification && event.notification.data && event.notification.data.url) {
      targetUrl = event.notification.data.url;
    }
  } catch (_) {}

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client && "focus" in client) {
          // ak už máme otvorené okno v rovnakom scope, iba ho zaostríme
          if (targetUrl && client.url && client.url.indexOf(targetUrl) !== -1) {
            return client.focus();
          }
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
