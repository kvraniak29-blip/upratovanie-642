# Fix-BD642-FCM.ps1
# Spusť v priečinku, kde je index.html, bd642_firebase_messaging.js, firebase-messaging-sw.js, manifest.webmanifest

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Get-Location).Path
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $root ".backup\$ts"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

function Backup-File($path) {
  if (Test-Path $path) {
    Copy-Item -Force $path (Join-Path $backupDir (Split-Path $path -Leaf))
  }
}

$bdJs = Join-Path $root "bd642_firebase_messaging.js"
$swJs = Join-Path $root "firebase-messaging-sw.js"
$idx  = Join-Path $root "index.html"
$man  = Join-Path $root "manifest.webmanifest"

Backup-File $bdJs
Backup-File $swJs
Backup-File $idx
Backup-File $man

# --- bd642_firebase_messaging.js (stabilizácia SW ready + rodina token + Android heuristika) ---
$bd642Content = @'
/* global firebase */

// bd642_firebase_messaging.js
// Klientsky kód pre prácu s Firebase Messaging (FCM)
// - inicializácia Firebase
// - získanie / uloženie FCM tokenu
// - napojenie na service worker (firebase-messaging-sw.js)
// - export jednoduchých funkcií pre appku (BD642_ZapnutUpozornenia, BD642_FCM.*)

(function () {
  "use strict";

  // 1) Kontrola, či je k dispozícii firebase (SDK v8)
  if (typeof firebase === "undefined") {
    console.error("BD642 FCM: Knižnica firebase nie je načítaná.");
    window.BD642_FCM = {
      podporovane: false,
      dovod: "FIREBASE_CHYBA",
      debug: function () {
        return "Firebase nie je dostupný – skontroluj <script> s firebase SDK.";
      }
    };
    return;
  }

  // 2) Konfigurácia Firebase pre projekt bd-642-26-upratovanie-d2851
  var firebaseConfig = {
    apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
    authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
    projectId: "bd-642-26-upratovanie-d2851",
    storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
    messagingSenderId: "530262860262",
    appId: "1:530262860262:web:ceef384f16e1a6f7e6f627",
    measurementId: "G-2ZDWWZBKRR"
  };

  // 3) Public VAPID key (POZOR: bez medzier a bez newline)
  var vapidPublicKey =
    "BHnnUHjr7ujW1Do0bJBbZqL8G9WmJsVmjE859krH6eS3uJ9YUSAex7cnjEJxATx2dXbcPN7Xv9zzppRDE4ZFWZw";

  // 4) Inicializácia Firebase App
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      console.log("BD642 FCM: Firebase App inicializovaný (DEFAULT).");
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri firebase.initializeApp:", e);
  }

  // 5) Firestore
  var db = null;
  var FieldValue = null;
  try {
    if (firebase.firestore) {
      db = firebase.firestore();
      FieldValue = firebase.firestore.FieldValue || null;
      console.log("BD642 FCM: Firestore inicializovaný.");
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri inicializácii Firestore:", e);
  }

  // 6) Messaging – heuristika pre Android
  var messaging = null;
  var messagingPodporovane = false;
  try {
    var envSupports =
      typeof Notification !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window;

    if (firebase.messaging) {
      if (typeof firebase.messaging.isSupported === "function") {
        messagingPodporovane = firebase.messaging.isSupported();
        if (!messagingPodporovane && envSupports) {
          console.warn("BD642 FCM: isSupported() false, ale prostredie vyzerá OK – skúšam pokračovať.");
          messagingPodporovane = true;
        }
      } else {
        messagingPodporovane = envSupports;
      }
    }

    if (messagingPodporovane) {
      messaging = firebase.messaging();
      console.log("BD642 FCM: Messaging inicializovaný.");
    }
  } catch (e) {
    console.error("BD642 FCM: chyba pri inicializácii messagingu:", e);
    messagingPodporovane = false;
  }

  if (!messagingPodporovane || !messaging) {
    window.BD642_FCM = {
      podporovane: false,
      dovod: "MESSAGING_NEPODPOROVANE",
      debug: function () {
        return { messagingPodporovane: messagingPodporovane, dbPripojene: !!db };
      },
      refreshToken: async function () { return { ok: false, dovod: "MESSAGING_NEPODPOROVANE" }; },
      ulozTokenManualne: async function () { return { ok: false, dovod: "MESSAGING_NEPODPOROVANE" }; }
    };
    window.BD642_ZapnutUpozornenia = async function () {
      return { ok: false, dovod: "MESSAGING_NEPODPOROVANE" };
    };
    return;
  }

  // Trvalé naviazanie rodiny pre push (nezávislé od prihlásenia)
  function getRodinaPreToken() {
    if (typeof localStorage === "undefined") return null;
    try {
      var rodinaPrihlasena = (localStorage.getItem("bd642_meFamily") || "").trim();
      var rodinaPush = (localStorage.getItem("bd642_pushFamily") || "").trim();
      var rodina = rodinaPrihlasena || rodinaPush || "";

      if (rodinaPrihlasena && rodinaPrihlasena !== rodinaPush) {
        try { localStorage.setItem("bd642_pushFamily", rodinaPrihlasena); } catch (_) {}
      }
      return rodina || null;
    } catch (e) {
      console.warn("BD642 FCM: getRodinaPreToken chyba:", e);
      return null;
    }
  }

  // Stabilná SW registrácia + počkať na ready (Android)
  async function getBd642ServiceWorkerRegistration() {
    if (!("serviceWorker" in navigator)) throw new Error("SERVICE_WORKER_NEPODPOROVANY");

    // nájdi existujúci
    try {
      var regs = await navigator.serviceWorker.getRegistrations();
      for (var i = 0; i < regs.length; i++) {
        var reg = regs[i];
        var u = "";
        try { u = reg && reg.active ? reg.active.scriptURL : ""; } catch (_) {}
        if (u && u.indexOf("firebase-messaging-sw.js") !== -1) {
          // počkaj na ready (dôležité)
          try { await navigator.serviceWorker.ready; } catch (_) {}
          return reg;
        }
      }
    } catch (_) {}

    // zaregistruj
    var reg2 = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
    try { await navigator.serviceWorker.ready; } catch (_) {}
    return reg2;
  }

  async function ulozTokenDoFirestore(token) {
    if (!db) return { ulozene: false, dovod: "FIRESTORE_NEDOSTUPNY" };

    try {
      var terazIso = new Date().toISOString();
      var rodina = getRodinaPreToken();
      var rola = null;
      try { rola = (localStorage.getItem("bd642_role") || "").trim() || null; } catch (_) {}

      var data = {
        token: token,
        rodina: rodina,
        rola: rola,
        userAgent: navigator.userAgent || "",
        jazyk: navigator.language || "",
        url: (typeof location !== "undefined" ? location.href : ""),
        aktualizovane: terazIso,
        aktualizovane_server: (FieldValue && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : null
      };

      // globálne
      await db.collection("fcm_tokens").doc(token).set(data, { merge: true });

      // rodina
      if (rodina) {
        await db.collection("rodiny").doc(rodina).collection("fcm_tokens").doc(token).set(data, { merge: true });
      }

      return { ulozene: true };
    } catch (e) {
      console.error("BD642 FCM: chyba pri ukladaní tokenu:", e);
      return { ulozene: false, dovod: "FIRESTORE_CHYBA", detail: String(e && e.message ? e.message : e) };
    }
  }

  async function vnutorneZapnutUpozornenia() {
    if (typeof Notification === "undefined") return { ok: false, dovod: "NOTIFICATION_API_NEDOSTUPNE" };
    if (Notification.permission === "denied") return { ok: false, dovod: "NOTIFICATION_ZABLOKOVANE" };
    if (!("serviceWorker" in navigator)) return { ok: false, dovod: "SERVICE_WORKER_NEPODPOROVANY" };
    if (!("PushManager" in window)) return { ok: false, dovod: "PUSHMANAGER_NEPODPOROVANY" };

    try {
      var permission = await Notification.requestPermission();
      if (permission !== "granted") return { ok: false, dovod: "NOTIFICATION_NEPOVOLENE" };

      var swReg = await getBd642ServiceWorkerRegistration();

      // getToken až po SW ready
      var token = await messaging.getToken({
        vapidKey: vapidPublicKey,
        serviceWorkerRegistration: swReg
      });

      if (!token) return { ok: false, dovod: "TOKEN_PRAZDNY" };

      var uloz = await ulozTokenDoFirestore(token);
      if (!uloz || !uloz.ulozene) {
        return { ok: true, token: token, upozornenie: "TOKEN_NEULOZENY_DO_FIRESTORE" };
      }

      return { ok: true, token: token };
    } catch (e) {
      console.error("BD642 FCM: chyba pri zapínaní:", e);
      return { ok: false, dovod: "CHYBA_ZAPNUTIA", detail: String(e && e.message ? e.message : e) };
    }
  }

  if (messaging && messagingPodporovane) {
    try {
      messaging.onMessage(function (payload) {
        console.log("BD642 FCM: foreground správa:", payload);
      });
    } catch (_) {}
  }

  window.BD642_ZapnutUpozornenia = async function () {
    return await vnutorneZapnutUpozornenia();
  };

  window.BD642_FCM = {
    podporovane: !!messagingPodporovane,
    debug: function () {
      return { messagingPodporovane: messagingPodporovane, dbPripojene: !!db };
    },
    refreshToken: async function () {
      try {
        var swReg = await getBd642ServiceWorkerRegistration();
        var token = await messaging.getToken({ vapidKey: vapidPublicKey, serviceWorkerRegistration: swReg });
        if (!token) return { ok: false, dovod: "TOKEN_PRAZDNY" };
        await ulozTokenDoFirestore(token);
        return { ok: true, token: token };
      } catch (e) {
        return { ok: false, dovod: "CHYBA_REFRESH", detail: String(e && e.message ? e.message : e) };
      }
    },
    ulozTokenManualne: function (token) { return ulozTokenDoFirestore(token); }
  };
})();
'@

# --- firebase-messaging-sw.js (v8 background handler správne) ---
$swContent = @'
// firebase-messaging-sw.js
// Service worker pre FCM – BD 642
// Musí byť v tom istom "root scope", kde beží app.

importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js");
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js");

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
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return defVal;
      cur = cur[parts[i]];
    }
    return (cur === undefined || cur === null) ? defVal : cur;
  } catch (_) {
    return defVal;
  }
}

// Firebase v8 SW: setBackgroundMessageHandler
if (messaging && typeof messaging.setBackgroundMessageHandler === "function") {
  messaging.setBackgroundMessageHandler(function (payload) {
    var title = safeGet(payload, "notification.title", "BD 642 – upozornenie");
    var body  = safeGet(payload, "notification.body", "");

    var url =
      safeGet(payload, "data.url", null) ||
      safeGet(payload, "data.click_action", null);

    var scopeRoot = (self.registration && self.registration.scope) ? self.registration.scope : "/";
    var targetUrl = url || scopeRoot;

    var options = {
      body: body,
      icon: safeGet(payload, "notification.icon", "icon-192.png"),
      badge: safeGet(payload, "notification.badge", "icon-192.png"),
      data: { url: targetUrl }
    };

    return self.registration.showNotification(title, options);
  });
}

// klik
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
          try {
            if (targetUrl && client.url && client.url.indexOf(targetUrl) !== -1) {
              return client.focus();
            }
          } catch (_) {}
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
'@

# Zapíš súbory (UTF-8 bez BOM)
[System.IO.File]::WriteAllText($bdJs, $bd642Content, (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText($swJs, $swContent,  (New-Object System.Text.UTF8Encoding($false)))

Write-Host "OK: Prepísané bd642_firebase_messaging.js a firebase-messaging-sw.js" -ForegroundColor Green

# --- manifest.webmanifest: doplň gcm_sender_id (časté pre Android FCM web push) ---
if (Test-Path $man) {
  $m = Get-Content -Raw -Encoding UTF8 $man
  if ($m -notmatch '"gcm_sender_id"\s*:') {
    # jednoduchý insert pred poslednú }
    $m2 = $m.TrimEnd()
    if ($m2.EndsWith("}")) {
      $m2 = $m2.TrimEnd("`r","`n"," ","`t")
      $m2 = $m2.Substring(0, $m2.Length-1)
      if ($m2.TrimEnd() -notmatch ",\s*$") { $m2 += "," }
      $m2 += "`n  `"gcm_sender_id`": `"103953800507`"`n}"
      [System.IO.File]::WriteAllText($man, $m2, (New-Object System.Text.UTF8Encoding($false)))
      Write-Host "OK: Do manifest.webmanifest doplnené gcm_sender_id" -ForegroundColor Green
    } else {
      Write-Warning "manifest.webmanifest nemá očakávaný JSON tvar – neupravené."
    }
  } else {
    Write-Host "OK: manifest.webmanifest už obsahuje gcm_sender_id" -ForegroundColor Green
  }
} else {
  Write-Warning "manifest.webmanifest nenájdený – preskakujem."
}

# --- index.html: iba kontrola includov (nemením HTML, len upozorním) ---
if (Test-Path $idx) {
  $h = Get-Content -Raw -Encoding UTF8 $idx
  $need = @(
    "https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js",
    "https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js",
    "https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js",
    "./bd642_firebase_messaging.js"
  )
  foreach ($n in $need) {
    if ($h -notmatch [regex]::Escape($n)) {
      Write-Warning "index.html: chýba include: $n"
    }
  }
}

Write-Host "Hotovo. Backup: $backupDir" -ForegroundColor Cyan
Write-Host "Pozn.: 'notifikácie na čas pri vypnutom prehliadači' vyžadujú backend, toto skriptom nevyriešiš." -ForegroundColor Yellow
