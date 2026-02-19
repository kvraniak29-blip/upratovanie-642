# BD642 – FCM HTTP v1 TEST (copy-paste naraz do PowerShellu)
# Spusti BEŽNE (nie ako správca)
# 1) Uprav $Tokens (daj každý token ako "..." bez medzier)
# 2) Enter -> počká 2 min -> odošle notifikácie -> PASS/FAIL
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ==== NASTAVENIA ====
$ProjectId   = "bd-642-26-upratovanie-d2851"
$ProjectPath = (Get-Location).Path
$DelayMinutes = 2
$Title = "BD 642 – test"
$Body  = "Test push (FCM v1) – ak toto vidíš aj pri zavretej PWA, je to OK."
$Url   = "./?bd642=testpush"
$DelaySecondsBetweenTokens = 1

# TODO: SEM vlož tokeny (každý samostatne, bez medzier, iba normálne úvodzovky)
$Tokens = @(#“e4dQmdnM84pdtLHx4H79OQ:APA91bFEaj7jBuYFeA1hwe9N8pkE31VCubNkSBV044CMcP7wPtWnhjBgIlqv_ftwo06XuYu5sPnu9G0BEMIoyrbAm5SEe_3_Idc0BSIj6ohIXjKX2O5eKSA“
#"epEHyC0s8Ylpbydu9q8Q_g:APA91bEsfor4GD5gn88bMfl_EKSVn2iUgfwzZcIy_FPv3SS2 2tMhgkLOfXMRQweiE_dgsbhYoqQEWwV1d6OIlJcOZQYp7BBMKafP0V2F-hHumolKk-YA5CM"
#"epEHyC0s8Ylpbydu9q8Q_g:APA91bHRnhOwJi9_oMuZib4cIhGJPQCHGZk1EOCfoqBIEQeL lLQV9NBnjd-lNkq9hA6iye1loLgIMFpDtXsFgZn4YpSpUXoPnPbuB3ful0MQjAXSzJmUDOU"
#"fnzfPyAnmKLyWs7Y5G9fCR:APA91bHO3Zcik1BT27fq7O0BrDoPkHdF012b61gssT3NxbADQW-2sUPfW1G7ZyLX7NWgOvEt1wtNmWth5zcyYp9bu1NhofZSA7pITP5dy3HIEegtwUlPqrg“)

# ==== LOGY ====
$LogDir = Join-Path $ProjectPath "Logy"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$logTxt  = Join-Path $LogDir "BD642_FCM_TestPush_LAST.txt"
$logJson = Join-Path $LogDir "BD642_FCM_TestPush_LAST.json"
Remove-Item $logTxt,$logJson -ErrorAction SilentlyContinue

function Log([string]$msg){
  $line = ("[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $msg)
  $line | Tee-Object -FilePath $logTxt -Append
}
function Fail([string]$msg){
  Log "FAIL: $msg"
  throw $msg
}

Log "=== BD642 FCM TEST START ==="
Log "ProjectId: $ProjectId"
Log "ProjectPath: $ProjectPath"

if(-not $Tokens -or $Tokens.Count -lt 1){
  Fail "Nie sú zadané tokeny. Uprav `$Tokens = @(...)."
}

# Validácia tokenov: žiadne smart úvodzovky, žiadne medzery
foreach($t in $Tokens){
  if([string]::IsNullOrWhiteSpace($t)){ Fail "Našiel som prázdny token v poli Tokens." }
  if($t -match "\s"){ Fail "Token obsahuje medzeru/whitespace. Skopíruj token znova bez medzier: $t" }
  if($t -match "[„”]"){ Fail "Token obsahuje smart úvodzovky „ “. Použi iba normálne úvodzovky \"...\"." }
}

# ==== AUTO-NÁJDENIE SERVICE ACCOUNT JSON ====
function Find-ServiceAccountJson([string]$root){
  $candidates = Get-ChildItem -Path $root -Filter "*.json" -File -Recurse -ErrorAction SilentlyContinue
  foreach($f in $candidates){
    try{
      $txt = Get-Content -Path $f.FullName -Raw -ErrorAction Stop
      if($txt -match '"type"\s*:\s*"service_account"' -and $txt -match '"private_key"\s*:' -and $txt -match '"client_email"\s*:'){
        return $f.FullName
      }
    } catch {}
  }
  return $null
}

$ServiceAccountJson = Find-ServiceAccountJson -root $ProjectPath
if(-not $ServiceAccountJson){
  Fail "Nenašiel som Service Account JSON v projekte. Skopíruj sem do priečinka projektu ten .json kľúč zo servisného účtu a spusti znova."
}
Log "ServiceAccountJson: $ServiceAccountJson"

$sa = Get-Content -Path $ServiceAccountJson -Raw | ConvertFrom-Json
if(-not $sa.client_email -or -not $sa.private_key){
  Fail "Service Account JSON vyzerá neplatne (chýba client_email alebo private_key)."
}

# ==== JWT -> OAuth ====
function To-Base64Url([byte[]]$bytes){
  [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+","-").Replace("/","_")
}
function New-JwtAssertion([string]$clientEmail, [string]$privateKeyPem, [string]$scope){
  $header  = @{ alg="RS256"; typ="JWT" } | ConvertTo-Json -Compress
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $claims = @{
    iss   = $clientEmail
    scope = $scope
    aud   = "https://oauth2.googleapis.com/token"
    iat   = $now
    exp   = $now + 3600
  } | ConvertTo-Json -Compress

  $h = To-Base64Url ([Text.Encoding]::UTF8.GetBytes($header))
  $c = To-Base64Url ([Text.Encoding]::UTF8.GetBytes($claims))
  $unsigned = "$h.$c"

  $rsa = [System.Security.Cryptography.RSA]::Create()
  $pem = $privateKeyPem.Replace("`r","")
  $keyBody = ($pem -split "`n" | Where-Object { $_ -and ($_ -notmatch "BEGIN PRIVATE KEY") -and ($_ -notmatch "END PRIVATE KEY") }) -join ""
  $keyBytes = [Convert]::FromBase64String($keyBody)
  $rsa.ImportPkcs8PrivateKey($keyBytes, [ref]0) | Out-Null

  $sig = $rsa.SignData([Text.Encoding]::UTF8.GetBytes($unsigned),
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $s = To-Base64Url $sig
  return "$unsigned.$s"
}
function Get-GoogleAccessToken([pscustomobject]$sa){
  $scope = "https://www.googleapis.com/auth/firebase.messaging"
  $jwt = New-JwtAssertion -clientEmail $sa.client_email -privateKeyPem $sa.private_key -scope $scope
  $body = @{
    grant_type = "urn:ietf:params:oauth:grant-type:jwt-bearer"
    assertion  = $jwt
  }
  $resp = Invoke-RestMethod -Method Post -Uri "https://oauth2.googleapis.com/token" -Body $body -ContentType "application/x-www-form-urlencoded"
  if(-not $resp.access_token){ Fail "Nepodarilo sa získať access_token z Google OAuth." }
  return $resp.access_token
}

Log "Získavam OAuth access token..."
$accessToken = Get-GoogleAccessToken -sa $sa
Log "OAuth token OK."

# ==== ČASOVANIE ====
$sendAt = (Get-Date).AddMinutes($DelayMinutes)
Log ("Plán odoslania: {0} (lokálne)" -f $sendAt.ToString("yyyy-MM-dd HH:mm:ss"))
$waitSec = [Math]::Max(0, [int]([TimeSpan]($sendAt - (Get-Date))).TotalSeconds)
if($waitSec -gt 0){
  Log "Čakám $waitSec s..."
  Start-Sleep -Seconds $waitSec
}

# ==== SEND ====
$endpoint = "https://fcm.googleapis.com/v1/projects/$ProjectId/messages:send"
$headers = @{ Authorization = "Bearer $accessToken" }

$results = @()
$allOk = $true

for($idx=0; $idx -lt $Tokens.Count; $idx++){
  $t = $Tokens[$idx].Trim()

  $payload = @{
    message = @{
      token = $t
      notification = @{
        title = $Title
        body  = $Body
      }
      data = @{
        url = $Url
        ts  = (Get-Date).ToUniversalTime().ToString("o")
      }
      webpush = @{
        fcm_options = @{ link = $Url }
        headers = @{ Urgency = "high" }
      }
    }
  } | ConvertTo-Json -Depth 20

  try{
    $resp = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -Body $payload -ContentType "application/json"
    $name = $resp.name
    Log ("OK  [{0}/{1}] token..{2} msg={3}" -f ($idx+1), $Tokens.Count, ($t.Substring([Math]::Max(0,$t.Length-8))), $name)
    $results += [pscustomobject]@{ token=$t; ok=$true; fcmName=$name }
  } catch {
    $allOk = $false
    $em = $_.Exception.Message
    Log ("ERR [{0}/{1}] token..{2} {3}" -f ($idx+1), $Tokens.Count, ($t.Substring([Math]::Max(0,$t.Length-8))), $em)
    $results += [pscustomobject]@{ token=$t; ok=$false; error=$em }
  }

  if($DelaySecondsBetweenTokens -gt 0 -and $idx -lt ($Tokens.Count-1)){
    Start-Sleep -Seconds $DelaySecondsBetweenTokens
  }
}

$out = [pscustomobject]@{
  ok = $allOk
  projectId = $ProjectId
  sentAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  count = $Tokens.Count
  results = $results
}
$out | ConvertTo-Json -Depth 30 | Out-File -FilePath $logJson -Encoding UTF8

if($allOk){
  Log "PASS: Všetky správy odoslané. Sleduj, či prídu notifikácie aj pri zavretej PWA/Chrome."
} else {
  Fail "Niektoré odoslania zlyhali. Otvor $logJson."
}

Log "=== BD642 FCM TEST END ==="
