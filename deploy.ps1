# BD642 – GitHub + Firebase deploy skript
# Spúšťaj v priečinku projektu (kde je index.html, firebase.json, .git atď.)

$ErrorActionPreference = "Stop"
$global:GlobalnyVysledok = "PASS"

function Write-Info([string]$sprava) {
    Write-Host "[INFO] $sprava" -ForegroundColor Cyan
}
function Write-Warn([string]$sprava) {
    Write-Host "[WARN] $sprava" -ForegroundColor Yellow
}
function Write-Err([string]$sprava) {
    Write-Host "[CHYBA] $sprava" -ForegroundColor Red
}

function Over-Prikaz([string]$nazov, [string]$prikaz) {
    Write-Info "Kontrolujem nástroj: $nazov..."
    $null = & $prikaz --version
    if ($LASTEXITCODE -ne 0) {
        $global:GlobalnyVysledok = "FAIL"
        throw "Nástroj '$nazov' (`"$prikaz`") nie je dostupný alebo zlyhal."
    }
    Write-Info "Nástroj '$nazov' (`"$prikaz`") OK."
}

# ---------- HLAVNÁ ČASŤ ----------

$projektovyPriecinkok = (Get-Location).Path
$nazovProjektu = "BD 642-26 Upratovanie"
$nazovLogPriecinka = "Logy"

# vytvor priečinok Logy v aktuálnom priečinku
$logDir = Join-Path $projektovyPriecinkok $nazovLogPriecinka
if (-not (Test-Path $logDir)) {
    New-Item -Path $logDir -ItemType Directory | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logSubor = "bd642_deploy_$timestamp.log"
$logPath = Join-Path $logDir $logSubor

Write-Info "Spúšťam BD642 deploy skript v priečinku: $projektovyPriecinkok"
Write-Info "Log sa zapisuje do: $logPath"

try {
    # Spusti záznam konzoly do logu
    Start-Transcript -Path $logPath -Force | Out-Null

    # 1) Kontrola nástrojov
    Over-Prikaz -nazov "Git" -prikaz "git"
    Over-Prikaz -nazov "Firebase CLI ('firebase')" -prikaz "firebase"

    # 2) Git – zmeny, commit, push
    Write-Info "Git: zisťujem zmeny (git status --porcelain)..."
    $gitChanges = git status --porcelain

    if ([string]::IsNullOrWhiteSpace($gitChanges)) {
        Write-Info "Git: žiadne zmeny, commit sa nevytvára."
    } else {
        Write-Info "Git: pridávam zmeny (git add -A)..."
        git add -A
        if ($LASTEXITCODE -ne 0) {
            $global:GlobalnyVysledok = "FAIL"
            throw "Git add zlyhal."
        }

        $commitMsg = "BD642 – automatický deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
        Write-Info "Git: vytváram commit: '$commitMsg'..."
        git commit -m $commitMsg
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Git commit pravdepodobne nevytvorený (možno žiadne nové zmeny). Pokračujem."
        }
    }

    Write-Info "Git: posielam na GitHub (git push)..."
    git push
    if ($LASTEXITCODE -ne 0) {
        $global:GlobalnyVysledok = "FAIL"
        throw "Git push zlyhal."
    }
    Write-Info "Git: push úspešný."

    # 3) Firebase deploy – iba hosting
    Write-Info "Firebase: deploy hostingu (firebase deploy --only hosting)..."
    firebase deploy --only hosting
    if ($LASTEXITCODE -ne 0) {
        $global:GlobalnyVysledok = "FAIL"
        throw "Firebase deploy zlyhal."
    }

    Write-Info "Firebase: deploy úspešný."
    Write-Info "=== HOTOVO: PASS – GitHub + Firebase deploy prebehli úspešne. ==="
}
catch {
    $global:GlobalnyVysledok = "FAIL"
    Write-Err "Nastala chyba: $_"
}
finally {
    try { Stop-Transcript | Out-Null } catch {}

    Write-Host ""
    Write-Warn "Celkový výsledok: $global:GlobalnyVysledok"
    if ($logPath) { Write-Info "Log: $logPath" }
    Write-Host ""
    Read-Host "Stlač Enter na ukončenie"
}
