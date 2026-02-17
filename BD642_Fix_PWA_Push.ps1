<# =========================================================
BD642 – FIX PWA install + vyčistenie index.html (all-in-one)
- opraví manifest ikony (reálne 192x192 a 512x512 z 1024)
- odstráni rozbitý duplicitný SW register blok v index.html
- presunie "BD642 AUTO SYNC" skript pred </body> (ak je po </html>)
- zálohuje zmenené súbory
SPUSTENIE: bežne (nie admin)
========================================================= #>

param(
  [string]$ProjectPath = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Write-Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Err ($m){ Write-Host "[FAIL] $m" -ForegroundColor Red }
function Write-Ok  ($m){ Write-Host "[PASS] $m" -ForegroundColor Green }

function Ensure-Dir($p){
  if(-not (Test-Path $p)){ New-Item -ItemType Directory -Path $p | Out-Null }
}

function Backup-File($src, $backupDir){
  if(Test-Path $src){
    $name = Split-Path $src -Leaf
    Copy-Item -LiteralPath $src -Destination (Join-Path $backupDir $name) -Force
  }
}

function Resize-Png($src, $dst, [int]$w, [int]$h){
  Add-Type -AssemblyName System.Drawing
  $img = [System.Drawing.Image]::FromFile($src)
  try{
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    try{
      $gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $gfx.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $gfx.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $gfx.DrawImage($img, 0, 0, $w, $h)
      $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $gfx.Dispose()
      $bmp.Dispose()
    }
  } finally {
    $img.Dispose()
  }
}

# --- paths ---
$root = (Resolve-Path $ProjectPath).Path
$logDir = Join-Path $root "Logy"
Ensure-Dir $logDir

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $root "_zaloha_bd642\fix-pwa-$ts"
Ensure-Dir $backupDir

$indexHtml = Join-Path $root "index.html"
$manifest  = Join-Path $root "manifest.webmanifest"
$icon192   = Join-Path $root "icon-192.png"
$icon512   = Join-Path $root "icon-512.png"

if(-not (Test-Path $indexHtml)){ throw "Chýba index.html v: $root" }
if(-not (Test-Path $manifest )){ throw "Chýba manifest.webmanifest v: $root" }
if(-not (Test-Path $icon192  )){ throw "Chýba icon-192.png v: $root" }
if(-not (Test-Path $icon512  )){ throw "Chýba icon-512.png v: $root" }

Write-Info "Projekt: $root"
Write-Info "Záloha:  $backupDir"

Backup-File $indexHtml $backupDir
Backup-File $manifest  $backupDir
Backup-File $icon192   $backupDir
Backup-File $icon512   $backupDir

# --- 1) Fix icons: ak sú 1024x1024 (alebo iné), vyrob reálne 192/512 ---
Add-Type -AssemblyName System.Drawing
function Get-ImgSize($p){
  $img = [System.Drawing.Image]::FromFile($p)
  try { return @{ W=$img.Width; H=$img.Height } }
  finally { $img.Dispose() }
}

$sz192 = Get-ImgSize $icon192
$sz512 = Get-ImgSize $icon512

Write-Info "Aktuálne rozmery: icon-192.png = $($sz192.W)x$($sz192.H), icon-512.png = $($sz512.W)x$($sz512.H)"

# ako zdroj použijeme väčší z nich (typicky 1024)
$srcForResize = $icon192
if(($sz512.W * $sz512.H) -gt ($sz192.W * $sz192.H)){ $srcForResize = $icon512 }

# ak rozmery nesedia, prepíš ich správnymi
if($sz192.W -ne 192 -or $sz192.H -ne 192){
  Write-Warn "Prepisujem icon-192.png na reálnych 192x192 (zdroj: $(Split-Path $srcForResize -Leaf))"
  Resize-Png -src $srcForResize -dst $icon192 -w 192 -h 192
}
if($sz512.W -ne 512 -or $sz512.H -ne 512){
  Write-Warn "Prepisujem icon-512.png na reálnych 512x512 (zdroj: $(Split-Path $srcForResize -Leaf))"
  Resize-Png -src $srcForResize -dst $icon512 -w 512 -h 512
}

$sz192b = Get-ImgSize $icon192
$sz512b = Get-ImgSize $icon512
Write-Info "Nové rozmery: icon-192.png = $($sz192b.W)x$($sz192b.H), icon-512.png = $($sz512b.W)x$($sz512b.H)"

if($sz192b.W -ne 192 -or $sz192b.H -ne 192){ throw "icon-192.png stále nemá 192x192" }
if($sz512b.W -ne 512 -or $sz512b.H -ne 512){ throw "icon-512.png stále nemá 512x512" }

# --- 2) Fix index.html: odstráň rozbitý duplicitný SW register blok + presuň auto-sync pred </body> ---
$html = Get-Content -LiteralPath $indexHtml -Raw -Encoding UTF8

# (a) vyber AUTO SYNC skript, ak je po </html>
$autoSyncPattern = '(?is)<script>\s*/\*\s*={0,5}\s*BD642\s+AUTO\s+SYNC\s*={0,5}\s*\*/.*?</script>\s*'
$autoSyncMatch = [regex]::Match($html, $autoSyncPattern)
$autoSyncBlock = ""
if($autoSyncMatch.Success){
  $autoSyncBlock = $autoSyncMatch.Value
  $html = [regex]::Replace($html, $autoSyncPattern, "", 1)
}

# (b) odstráň rozbitý duplicitný SW register blok (ten s extra "});")
$brokenSwPattern = '(?is)<script>\s*\(function\(\)\s*\{\s*if\(!\(\s*''serviceWorker''\s+in\s+navigator\s*\)\)\s*return;\s*.*?navigator\.serviceWorker\.register\(\s*"\./firebase-messaging-sw\.js"\s*,\s*\{\s*scope:\s*"\./"\s*\}\s*\)\s*;\s*\}\s*\);\s*\}\)\(\);\s*</script>\s*'
if([regex]::IsMatch($html, $brokenSwPattern)){
  $html = [regex]::Replace($html, $brokenSwPattern, "", 1)
  Write-Warn "Odstránený rozbitý duplicitný SW register blok."
} else {
  Write-Info "Rozbitý duplicitný SW register blok som nenašiel (OK)."
}

# (c) odstráň všetko po </html> (nech je HTML čisté)
$html = [regex]::Replace($html, '(?is)</html>.*$', '</html>')

# (d) vlož auto-sync pred </body> (ak sme ho našli)
if($autoSyncBlock){
  if($html -match '(?is)</body>'){
    $html = [regex]::Replace($html, '(?is)</body>', ($autoSyncBlock + "`r`n</body>"), 1)
    Write-Info "AUTO SYNC skript vložený pred </body>."
  } else {
    Write-Warn "Nenašiel som </body>, AUTO SYNC skript nevkladám."
  }
}

Set-Content -LiteralPath $indexHtml -Value $html -Encoding UTF8

Write-Ok "Hotovo: ikony + index.html opravené a zálohované."
Write-Info "Ďalší krok: deploy (Firebase Hosting) a test manifest + install + push."
