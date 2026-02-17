param(
  [Parameter(Mandatory=$false)]
  [string]$ProjectPath = (Get-Location).Path,

  [switch]$DeployFirebase,
  [switch]$PushGit
)

# ================================
# BD642 – PWA + FCM FIX (all-in-one)
# SPUSTENIE: BEŽNE (nie správca)
# VOLITEĽNE:
#  -DeployFirebase  => firebase deploy
#  -PushGit         => git add/commit/push
# ================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-Dir([string]$p){ if(!(Test-Path $p)){ New-Item -ItemType Directory -Path $p | Out-Null } }

function Rotate-Logs([string]$logRoot, [string]$baseName){
  New-Dir $logRoot
  $stare = Join-Path $logRoot "stare"
  New-Dir $stare

  $txt = Join-Path $logRoot "$baseName.txt"
  $json = Join-Path $logRoot "$baseName.json"

  foreach($f in @($txt,$json)){
    if(Test-Path $f){
      $ts = Get-Date -Format "yyyyMMdd_HHmmss"
      $dest = Join-Path $stare ("{0}_{1}{2}" -f [IO.Path]::GetFileNameWithoutExtension($f), $ts, [IO.Path]::GetExtension($f))
      Move-Item $f $dest -Force
    }
  }

  # drž max 3 posledné na typ (txt/json) v "stare"
  $files = Get-ChildItem $stare -File | Sort-Object LastWriteTime -Descending
  $groups = $files | Group-Object Extension
  foreach($g in $groups){
    $keep = $g.Group | Select-Object -First 3
    $del = $g.Group | Select-Object -Skip 3
    foreach($d in $del){ Remove-Item $d.FullName -Force -ErrorAction SilentlyContinue }
  }

  return @{ txt=$txt; json=$json }
}

function Write-Json([string]$path, [object]$obj){
  ($obj | ConvertTo-Json -Depth 20) | Set-Content -Encoding UTF8 -Path $path
}

function Backup-File([string]$src, [string]$backupDir){
  if(Test-Path $src){
    Copy-Item $src -Destination (Join-Path $backupDir ([IO.Path]::GetFileName($src))) -Force
  }
}

$ProjectPath = (Resolve-Path $ProjectPath).Path
$LogRoot = Join-Path $ProjectPath "Logy"
$logFiles = Rotate-Logs -logRoot $LogRoot -baseName "BD642_FCM_PWA_FIX"
$logTxt = $logFiles.txt
$logJson = $logFiles.json

$state = [ordered]@{
  projectPath = $ProjectPath
  time = (Get-Date).ToString("s")
  steps = @()
  pass = $false
}

function Log-Step([string]$name, [string]$status, [string]$detail=""){
  $line = "[{0}] {1}: {2} {3}" -f (Get-Date -Format "HH:mm:ss"), $status, $name, $detail
  Add-Content -Encoding UTF8 -Path $logTxt -Value $line
  $state.steps += [ordered]@{ time=(Get-Date).ToString("s"); name=$name; status=$status; detail=$detail }
}

try {
  Log-Step "Start" "INFO" ("ProjectPath=" + $ProjectPath)

  if(!(Test-Path (Join-Path $ProjectPath "index.html"))){
    throw "Nenašiel som index.html v ProjectPath. Nastav správny -ProjectPath."
  }

  $backupDir = Join-Path $LogRoot ("Zalohy\BD642_FIX_{0}" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
  New-Dir $backupDir
  Log-Step "BackupDir" "OK" $backupDir

  # --- Súbory ktoré budeme upravovať / vytvárať ---
  $swPath = Join-Path $ProjectPath "firebase-messaging-sw.js"
  $manifestPath = Join-Path $ProjectPath "manifest.webmanifest"
  if(!(Test-Path $manifestPath)){
    # niektoré projekty používajú manifest.json
    $alt = Join-Path $ProjectPath "manifest.json"
    if(Test-Path $alt){ $manifestPath = $alt }
  }

  $clientPath = Join-Path $ProjectPath "bd642_firebase_messaging.js"
  $firebaseJson = Join-Path $ProjectPath "firebase.json"

  foreach($f in @($swPath,$manifestPath,$clientPath,$firebaseJson)){
    Backup-File $f $backupDir
  }
  Log-Step "BackupFiles" "OK" "Záloha hotová"

  # --- 1) Service Worker (PWA + FCM) – V8 kompatibilita + fetch respondWith ---
  $swContent = @'
// firebase-messaging-sw.js
// BD642 – Service Worker pre FCM + PWA installability (Firebase SDK v8 kompat)

importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js");
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js");

var firebaseConfig = {
  apiKey: "AIzaSyDi9bmbWut2ph5emweyfOoa6FCF8xNUO8I",
  authDomain: "bd-642-26-upratovanie-d2851.firebaseapp.com",
  projectId: "bd-642-26-upratovanie-d2851",
  storageBucket: "bd-642-26-upratovanie-d2851.firebasestorage.app",
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
self.addEventListener("install", function(event){
  try { self.skipWaiting(); } catch(e) {}
});

self.addEventListener("activate", function(event){
  event.waitUntil((async function(){
    try { await self.clients.claim(); } catch(e) {}
  })());
});

// --- PWA installability: fetch handler MUSÍ reálne existovať a respondWith() ---
self.addEventListener("fetch", function(event){
  // Nechceme cache logiku – len štandardný sieťový fetch.
  try {
    event.respondWith(fetch(event.request));
  } catch (e) {
    // fallback (nemá zabiť SW)
  }
});

// --- Jednotný handler pre background správy (V8 aj novšie) ---
function showBgNotification(payload){
  try {
    var title = safeGet(payload, "notification.title", "BD 642 – upozornenie");
    var body  = safeGet(payload, "notification.body", "");

    // preferuj data.url, fallback na click_action
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
  } catch (e) {
    // nič
  }
}

// Firebase SDK v8: setBackgroundMessageHandler
if (messaging && typeof messaging.setBackgroundMessageHandler === "function") {
  messaging.setBackgroundMessageHandler(function(payload){
    showBgNotification(payload);
    // v8 očakáva Promise
    return Promise.resolve();
  });
}

// Niektoré verzie/kompat: onBackgroundMessage
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
      // ak už app beží, fokus
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        try {
          if (client && "focus" in client) {
            // preferuj rovnaký origin
            if (client.url && targetUrl && client.url.indexOf(new URL(targetUrl).origin) === 0) {
              return client.focus();
            }
          }
        } catch(_) {}
      }
      // inak otvor nové okno
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
'@

  Set-Content -Encoding UTF8 -Path $swPath -Value $swContent
  Log-Step "Write firebase-messaging-sw.js" "OK" $swPath

  # --- 2) Manifest – doplň maskable + start_url stabilne (bez query id) ---
  $manifestObj = @{
    name = "Upratovací plánovač BD 642"
    short_name = "BD642"
    description = "Harmonogram upratovania BD 642 + lokálne a push upozornenia."
    lang = "sk"
    start_url = "./"
    scope = "./"
    display = "standalone"
    display_override = @("standalone","minimal-ui","browser")
    background_color = "#0b1220"
    theme_color = "#0b1220"
    icons = @(
      @{ purpose="any"; sizes="192x192"; type="image/png"; src="./icon-192.png" },
      @{ purpose="maskable"; sizes="192x192"; type="image/png"; src="./icon-192.png" },
      @{ purpose="any"; sizes="512x512"; type="image/png"; src="./icon-512.png" },
      @{ purpose="maskable"; sizes="512x512"; type="image/png"; src="./icon-512.png" }
    )
  }

  # ak existuje pôvodný manifest, necháme čo sa dá (ale opravíme kritické)
  if(Test-Path $manifestPath){
    try {
      $raw = Get-Content $manifestPath -Raw -ErrorAction Stop
      $existing = $raw | ConvertFrom-Json -ErrorAction Stop
      if($existing.name){ $manifestObj.name = $existing.name }
      if($existing.short_name){ $manifestObj.short_name = $existing.short_name }
      if($existing.description){ $manifestObj.description = $existing.description }
      if($existing.background_color){ $manifestObj.background_color = $existing.background_color }
      if($existing.theme_color){ $manifestObj.theme_color = $existing.theme_color }
      if($existing.lang){ $manifestObj.lang = $existing.lang }
    } catch {
      # ak je manifest nevalidný, prepíšeme ho našim
    }
  }

  Write-Json -path $manifestPath -obj $manifestObj
  Log-Step "Write manifest" "OK" $manifestPath

  # --- 3) firebase.json – ak existuje, doplň NO-CACHE pre SW + manifest (kritické) ---
  if(Test-Path $firebaseJson){
    try {
      $fj = (Get-Content $firebaseJson -Raw) | ConvertFrom-Json

      # hosting môže byť objekt alebo pole
      $hostings = @()
      if($fj.hosting -is [System.Array]) { $hostings = $fj.hosting }
      elseif($fj.hosting) { $hostings = @($fj.hosting) }

      foreach($h in $hostings){
        if(-not $h.headers){ $h | Add-Member -NotePropertyName headers -NotePropertyValue @() }
        # odstráň duplicitné záznamy pre tieto globy
        $h.headers = @($h.headers | Where-Object { $_.source -notin @("/firebase-messaging-sw.js","/manifest.webmanifest","/manifest.json") })

        $h.headers += @{
          source = "/firebase-messaging-sw.js"
          headers = @(
            @{ key="Cache-Control"; value="no-cache, no-store, must-revalidate" },
            @{ key="Pragma"; value="no-cache" },
            @{ key="Expires"; value="0" }
          )
        }

        $h.headers += @{
          source = "/manifest.webmanifest"
          headers = @(
            @{ key="Cache-Control"; value="no-cache, no-store, must-revalidate" },
            @{ key="Pragma"; value="no-cache" },
            @{ key="Expires"; value="0" }
          )
        }

        $h.headers += @{
          source = "/manifest.json"
          headers = @(
            @{ key="Cache-Control"; value="no-cache, no-store, must-revalidate" },
            @{ key="Pragma"; value="no-cache" },
            @{ key="Expires"; value="0" }
          )
        }
      }

      # zapíš späť
      $fj | ConvertTo-Json -Depth 50 | Set-Content -Encoding UTF8 -Path $firebaseJson
      Log-Step "Patch firebase.json headers" "OK" $firebaseJson
    } catch {
      Log-Step "Patch firebase.json headers" "WARN" ("Nepodarilo sa upraviť firebase.json: " + $_.Exception.Message)
    }
  } else {
    Log-Step "firebase.json" "INFO" "Súbor neexistuje – preskakujem."
  }

  # --- 4) Rýchla kontrola CLI (len status, nič nemení) ---
  function Has-Cmd($c){ return [bool](Get-Command $c -ErrorAction SilentlyContinue) }

  if(Has-Cmd "firebase"){
    try {
      $out = firebase login:list 2>$null
      Log-Step "Firebase CLI" "OK" "firebase login:list prebehol"
    } catch {
      Log-Step "Firebase CLI" "WARN" "firebase je, ale login:list zlyhal – ak treba, sprav: firebase login"
    }
  } else {
    Log-Step "Firebase CLI" "WARN" "firebase CLI nie je v PATH (nainštaluj: npm i -g firebase-tools)."
  }

  if(Has-Cmd "gh"){
    try {
      gh auth status 2>$null | Out-Null
      Log-Step "GitHub CLI" "OK" "gh auth status prebehol"
    } catch {
      Log-Step "GitHub CLI" "WARN" "gh je, ale auth status zlyhal – ak treba, sprav: gh auth login"
    }
  } else {
    Log-Step "GitHub CLI" "WARN" "GitHub CLI nie je v PATH."
  }

  if(Has-Cmd "git"){
    try {
      $s = git status --porcelain
      Log-Step "Git status" "OK" ("Zmeny=" + ($(if($s){ "ÁNO" } else { "NIE" })))
    } catch {
      Log-Step "Git status" "WARN" "git status zlyhal."
    }
  } else {
    Log-Step "Git" "WARN" "Git nie je v PATH."
  }

  # --- 5) Deploy / Push (len ak si zapneš prepínače) ---
  if($PushGit){
    if(!(Has-Cmd "git")){ throw "PushGit: git nie je dostupný." }
    git add -A | Out-Null
    git commit -m "BD642: fix PWA installability + FCM SW background (v8) + no-cache headers" | Out-Null
    git push | Out-Null
    Log-Step "Git push" "OK" "Hotovo"
  }

  if($DeployFirebase){
    if(!(Has-Cmd "firebase")){ throw "DeployFirebase: firebase CLI nie je dostupný." }
    firebase deploy
    Log-Step "firebase deploy" "OK" "Hotovo"
  }

  $state.pass = $true
  Log-Step "RESULT" "PASS" "Hotovo"
}
catch {
  $state.pass = $false
  Log-Step "RESULT" "FAIL" $_.Exception.Message
}
finally {
  Write-Json -path $logJson -obj $state
  "LOG TXT: $logTxt"
  "LOG JSON: $logJson"
  if(-not $state.pass){
    exit 1
  }
}
