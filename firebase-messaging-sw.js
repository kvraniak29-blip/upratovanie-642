// firebase-messaging-sw.js
// BD642 – Service Worker pre FCM (Firebase SDK v8) + PWA installability (stabilné scope-relatívne cesty)

importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js");
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js");

var firebaseConfig = {
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  storageBucket: "bd-642-26-upratovanie-d2851.appspot.com",
  messagingSenderId: "530262860262",
  appId: "1:530262860262:web:ceef384f16e1a6f7e6f627"
};

try {
  if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
} catch (e) {}

var messaging = null;
try { messaging = firebase.messaging(); } catch (e2) { messaging = null; }

function safeGet(obj, path, defVal) {
  try {
    var parts = path.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return defVal;
      cur = cur[parts[i]];
    }
    return (cur === undefined || cur === null) ? defVal : cur;
  } catch (_) { return defVal; }
}

function absInScope(relOrAbs) {
  try {
    var scope = (self.registration && self.registration.scope)
      ? self.registration.scope
      : (self.location.origin + "/");
    return new URL(relOrAbs, scope).href;
  } catch (_) {
    return relOrAbs;
  }
}

// --- rýchle prebratie novej verzie SW ---
self.addEventListener("install", function () {
  try { self.skipWaiting(); } catch (e) {}
});

self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    try { await self.clients.claim(); } catch (e) {}
  })());
});

// --- umožniť SKIP_WAITING aj cez postMessage z klienta ---
self.addEventListener("message", function (event) {
  try {
    var t = event && event.data && event.data.type ? String(event.data.type) : "";
    if (t === "SKIP_WAITING") {
      try { self.skipWaiting(); } catch (e) {}
    }
  } catch (_) {}
});

// --- PWA installability: fetch handler musí existovať (NO-OP) ---
self.addEventListener("fetch", function (_event) {});

// --- Jednotné zobrazenie notifikácie ---
function showBgNotification(payload) {
  try {
    var title = safeGet(payload, "notification.title", "BD 642 – upozornenie");
    var body  = safeGet(payload, "notification.body", "");

    // URL preferuj z data.url (posielaš z Functions)
    // Default musí byť scope-relatívny (GitHub Pages subcesta)
    var url =
      safeGet(payload, "data.url", null) ||
      safeGet(payload, "data.link", null) ||
      safeGet(payload, "data.click_action", null) ||
      safeGet(payload, "fcmOptions.link", null) ||
      "./";

    // Ikony musia byť scope-relatívne (nie "/icon-192.png"!)
    var iconRel  = safeGet(payload, "notification.icon", "./icon-192.png");
    var badgeRel = safeGet(payload, "notification.badge", "./icon-192.png");

    var options = {
      body: body,
      icon: absInScope(iconRel),
      badge: absInScope(badgeRel),
      data: { url: url }
    };

    return self.registration.showNotification(title, options);
  } catch (e) {
    try { return Promise.resolve(); } catch (_) { return; }
  }
}

// --- FCM background handler (v8) ---
if (messaging && typeof messaging.setBackgroundMessageHandler === "function") {
  messaging.setBackgroundMessageHandler(function (payload) {
    return showBgNotification(payload);
  });
}

// --- Fallback push (ak príde mimo FCM handlera) ---
self.addEventListener("push", function (event) {
  try {
    if (!event || !event.data) return;
    var data = null;
    try { data = event.data.json(); }
    catch (_) { data = { data: { body: event.data.text() } }; }
    event.waitUntil(showBgNotification(data));
  } catch (_) {}
});

// --- Klik na notifikáciu: otvor/zaostri app ---
self.addEventListener("notificationclick", function (event) {
  try { event.notification.close(); } catch (e) {}

  var targetUrl = "./";
  try {
    if (event.notification && event.notification.data && event.notification.data.url) {
      targetUrl = event.notification.data.url;
    }
  } catch (_) {}

  try {
    var scope = (self.registration && self.registration.scope)
      ? self.registration.scope
      : (self.location.origin + "/");
    targetUrl = new URL(targetUrl, scope).href;
  } catch (_) {}

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      var targetOrigin = null;
      try { targetOrigin = new URL(targetUrl).origin; } catch (_) {}

      // Fokusni existujúce okno (rovnaký origin), a ak vie, aj naviguj na cieľ
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        try {
          if (!client) continue;
          if (targetOrigin && client.url && client.url.indexOf(targetOrigin) === 0) {
            if ("navigate" in client) {
              return client.navigate(targetUrl).then(function () {
                if ("focus" in client) return client.focus();
              });
            }
            if ("focus" in client) return client.focus();
          }
        } catch (_) {}
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});