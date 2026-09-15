<#
.SYNOPSIS
    Baut Notely zu einer lauffaehigen Windows-Anwendung.

.DESCRIPTION
    Prueft die Voraussetzungen (Node, Rust, MSVC-Buildtools), installiert sie auf
    Wunsch ueber winget und erzeugt anschliessend Installer und portable EXE.

.EXAMPLE
    .\build.ps1
    Prueft alles und baut. Fehlende Werkzeuge werden nur gemeldet.

.EXAMPLE
    .\build.ps1 -InstallMissing
    Installiert fehlende Werkzeuge automatisch (Rust ohne, MSVC mit Adminrechten).
#>

[CmdletBinding()]
param(
    [switch]$InstallMissing,
    [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

function Write-Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Write-Miss($text) { Write-Host "    --  $text" -ForegroundColor Yellow }

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Test-MsvcTools {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { return $false }
    $found = & $vswhere -products * -latest -prerelease `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath 2>$null
    return -not [string]::IsNullOrWhiteSpace($found)
}

if (-not $SkipChecks) {
    Write-Step 'Voraussetzungen pruefen'

    # --- Node ---------------------------------------------------------------
    if (Test-Command 'npm') {
        Write-Ok "Node $(node -v)"
    }
    else {
        Write-Miss 'Node.js fehlt'
        if ($InstallMissing) {
            Write-Host '    Installiere Node.js LTS...'
            winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
            Write-Host '    PowerShell danach neu oeffnen und build.ps1 erneut starten.' -ForegroundColor Yellow
            exit 1
        }
        throw 'Node.js fehlt. Mit "winget install OpenJS.NodeJS.LTS" installieren oder build.ps1 -InstallMissing verwenden.'
    }

    # --- Rust ---------------------------------------------------------------
    if (Test-Command 'cargo') {
        Write-Ok "$(rustc --version)"
    }
    else {
        Write-Miss 'Rust fehlt'
        if ($InstallMissing) {
            Write-Host '    Installiere Rust (rustup)...'
            winget install --id Rustlang.Rustup --silent --accept-package-agreements --accept-source-agreements
            Write-Host '    PowerShell danach neu oeffnen und build.ps1 erneut starten.' -ForegroundColor Yellow
            exit 1
        }
        throw 'Rust fehlt. Mit "winget install Rustlang.Rustup" installieren oder build.ps1 -InstallMissing verwenden.'
    }

    # --- MSVC ---------------------------------------------------------------
    if (Test-MsvcTools) {
        Write-Ok 'MSVC Build Tools (C++)'
    }
    else {
        Write-Miss 'MSVC Build Tools fehlen (Rust braucht den MSVC-Linker)'
        if ($InstallMissing) {
            Write-Host '    Installiere Visual Studio Build Tools - das dauert und fragt nach Adminrechten...'
            $args = '--wait --quiet --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
            winget install --id Microsoft.VisualStudio.2022.BuildTools --silent `
                --accept-package-agreements --accept-source-agreements --override $args
            Write-Host '    PowerShell danach neu oeffnen und build.ps1 erneut starten.' -ForegroundColor Yellow
            exit 1
        }
        throw 'MSVC Build Tools fehlen. Mit build.ps1 -InstallMissing installieren (Adminrechte noetig).'
    }
}

Write-Step 'Frontend-Abhaengigkeiten installieren'
if (Test-Path 'package-lock.json') { npm ci } else { npm install }
if ($LASTEXITCODE -ne 0) { throw 'npm install fehlgeschlagen' }

Write-Step 'Tests'
npm test
if ($LASTEXITCODE -ne 0) { throw 'Frontend-Tests fehlgeschlagen' }

Push-Location src-tauri
try {
    cargo test --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Rust-Tests fehlgeschlagen' }
}
finally {
    Pop-Location
}

# Der lokale Build braucht keinen privaten Schluessel - er erzeugt kein
# Update-Archiv. Der oeffentliche Schluessel muss aber stimmen, sonst laeuft
# die spaetere Update-Pruefung in der fertigen App ins Leere.
$confPath = Join-Path $projectRoot 'src-tauri\tauri.conf.json'
$pubkey = (Get-Content $confPath -Raw | ConvertFrom-Json).plugins.updater.pubkey
if ($pubkey -like 'HIER_DEN_*') {
    Write-Miss 'Update-Schluessel fehlt noch. Einmalig anlegen:'
    Write-Host '    npm run tauri signer generate -- -w "$env:USERPROFILE\.tauri\notely.key"' -ForegroundColor Gray
    Write-Host '    Den oeffentlichen Schluessel in src-tauri/tauri.conf.json unter plugins.updater.pubkey eintragen.' -ForegroundColor Gray
    Write-Host '    Den privaten Schluessel als GitHub-Secret TAURI_SIGNING_PRIVATE_KEY hinterlegen.' -ForegroundColor Gray
    Write-Host '    Die App laesst sich bauen und nutzen - nur die Update-Pruefung bleibt bis dahin ohne Funktion.' -ForegroundColor Gray
}

Write-Step 'Release-Build (der erste Durchlauf dauert einige Minuten)'
npm run tauri:build
if ($LASTEXITCODE -ne 0) { throw 'Build fehlgeschlagen' }

Write-Step 'Ergebnis'
$exe = Join-Path $projectRoot 'src-tauri\target\release\notely.exe'
$setup = Get-ChildItem -Path (Join-Path $projectRoot 'src-tauri\target\release\bundle\nsis') `
    -Filter '*-setup.exe' -ErrorAction SilentlyContinue | Select-Object -First 1

if (Test-Path $exe) { Write-Ok "Portable EXE:  $exe" }
if ($setup) {
    Write-Ok "Installer:     $($setup.FullName)"
    Write-Host "`nFuer zuverlaessige Windows-Benachrichtigungen den Installer verwenden -" -ForegroundColor Gray
    Write-Host 'die Verknuepfung im Startmenue liefert die AUMID, ueber die Toasts laufen.' -ForegroundColor Gray
    Start-Process explorer.exe -ArgumentList "/select,`"$($setup.FullName)`""
}
elseif (Test-Path $exe) {
    Start-Process explorer.exe -ArgumentList "/select,`"$exe`""
}
