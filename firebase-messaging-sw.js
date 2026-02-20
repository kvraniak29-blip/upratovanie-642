// firebase-messaging-sw.js
// BD642 – Service Worker pre FCM + PWA installability (Firebase SDK v8 kompat)

importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js");
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js");

var firebaseConfig = {
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  // ZJEDNOTENÉ s klientom (v8 štandard)
  storageBucket: "bd-642-26-upratovanie-d2851.appspot.com",
  messagingSenderId: "530262860262",
  appId: "1:530262860262:web:ceef384f16e1a6f7e6f627"
};

try {
  if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
} catch (e) { /* SW nesmie spadnúť */ }

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

// --- rýchle prebratie novej verzie SW ---
self.addEventListener("install", function(){
  try { self.skipWaiting(); } catch(e) {}
});

self.addEventListener("activate", function(event){
  event.waitUntil((async function(){
    try { await self.clients.claim(); } catch(e) {}
  })());
});

// --- PWA installability: fetch handler MUSÍ existovať a použiť respondWith ---
self.addEventListener("fetch", function(event){
  try { event.respondWith(fetch(event.request)); } catch (e) {}
});

// --- Jednotný handler pre background správy (V8 aj novšie) ---
function showBgNotification(payload){
  try {
    var title = safeGet(payload, "notification.title", "BD 642 – upozornenie");
    var body  = safeGet(payload, "notification.body", "");
    var url = safeGet(payload, "data.url", null) || safeGet(payload, "data.click_action", null);

    var scopeRoot = (self.registration && self.registration.scope) ? self.registration.scope : "./";
    var targetUrl = url || scopeRoot;

    var options = {
      body: body,
      icon: safeGet(payload, "notification.icon", "icon-192.png"),
      badge: safeGet(payload, "notification.badge", "icon-192.png"),
      data: { url: targetUrl }
    };

    self.registration.showNotification(title, options);
  } catch (e) {}
}

if (messaging && typeof messaging.setBackgroundMessageHandler === "function") {
  messaging.setBackgroundMessageHandler(function(payload){
    showBgNotification(payload);
    return Promise.resolve();
  });
}

if (messaging && typeof messaging.onBackgroundMessage === "function") {
  messaging.onBackgroundMessage(function(payload){
    showBgNotification(payload);
  });
}

// --- Klik na notifikáciu: otvor/zaostri app ---
self.addEventListener("notificationclick", function(event){
  try { event.notification.close(); } catch(e) {}

  var scopeRoot = (self.registration && self.registration.scope) ? self.registration.scope : "./";
  var targetUrl = scopeRoot;

  try {
    if (event.notification && event.notification.data && event.notification.data.url) {
      targetUrl = event.notification.data.url;
    }
  } catch(_) {}

  try { targetUrl = new URL(targetUrl, scopeRoot).href; } catch(_) { targetUrl = scopeRoot; }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(clientList){
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        try {
          if (client && "focus" in client) {
            if (client.url && targetUrl && client.url.indexOf(new URL(targetUrl).origin) === 0) {
              return client.focus();
            }
          }
        } catch(_) {}
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});