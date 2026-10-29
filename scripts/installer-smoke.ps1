$ErrorActionPreference = 'Stop'

$installer = Get-ChildItem -Path 'release' -Filter '*.exe' | Where-Object { $_.Name -match 'Setup' } | Select-Object -First 1
if (-not $installer) { throw 'Current Windows NSIS installer was not found in release/' }

$previousInstaller = Join-Path $env:RUNNER_TEMP 'market-previous-setup.exe'
if (-not (Test-Path -LiteralPath $previousInstaller)) {
  throw "Previous-version installer fixture was not found: $previousInstaller"
}

$root = Join-Path $env:RUNNER_TEMP 'market-installer-smoke'
$installDir = Join-Path $root 'install'
$appDataDir = Join-Path $root 'appdata'
Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $installDir, $appDataDir -Force | Out-Null

# Electron's userData path is explicitly overridden by main.cjs before startup.
# This prevents the test from reading or modifying a real runner profile.
$env:MARKET_USER_DATA_DIR = $appDataDir

function Install-PackagedVersion([string]$installerPath, [string]$label) {
  $result = Start-Process -FilePath $installerPath -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
  if ($result.ExitCode -ne 0) { throw "$label installer exited with code $($result.ExitCode)" }
  $app = Join-Path $installDir 'Market.exe'
  if (-not (Test-Path -LiteralPath $app)) { throw "$label application executable was not found: $app" }
}

function Invoke-PackagedSmokeTest {
  $executable = Join-Path $installDir 'Market.exe'
  $process = Start-Process -FilePath $executable -ArgumentList @('--smoke-test') -PassThru
  if (-not $process.WaitForExit(60000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'Packaged application smoke test timed out after 60 seconds'
  }
  if ($process.ExitCode -ne 0) { throw "Packaged application smoke test failed with exit code $($process.ExitCode)" }
}

function Assert-Persistence([string]$databasePath, [string]$stage) {
  & python -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); r=c.execute("SELECT meta_value FROM app_meta WHERE meta_key=?", ("installer_smoke_sentinel",)).fetchone(); c.close(); assert r and r[0]=="preserve-me", "SQLite persistence sentinel was lost"' $databasePath
  if ($LASTEXITCODE -ne 0) { throw "SQLite data did not survive $stage" }
}

# Install the synthetic lower-version build first. The fixture uses the same source
# tree with only package version metadata changed, so this validates installer replacement
# and data preservation, not compatibility with a historical schema or released binary.
Install-PackagedVersion $previousInstaller 'Previous-version'
Invoke-PackagedSmokeTest
$database = Get-ChildItem -Path $appDataDir -Filter 'market.sqlite' -File -Recurse | Select-Object -First 1
if (-not $database) { throw "Packaged application did not create market.sqlite under isolated user-data directory: $appDataDir" }

# Seed a harmless marker in the old version's database before installing the current build.
& python -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("INSERT OR REPLACE INTO app_meta (meta_key, meta_value) VALUES (''installer_smoke_sentinel'', ''preserve-me'')"); c.commit(); c.close()' $database.FullName
if ($LASTEXITCODE -ne 0) { throw 'Could not seed SQLite persistence sentinel' }

Invoke-PackagedSmokeTest
Assert-Persistence $database.FullName 'the previous-version app restart'

# Upgrade from the synthetic lower-version installer to the current installer in place.
Install-PackagedVersion $installer.FullName 'Current-version upgrade'
Invoke-PackagedSmokeTest
Assert-Persistence $database.FullName 'version-to-version installer upgrade'

# Reinstall the current build once more to retain coverage of same-version reinstall.
Install-PackagedVersion $installer.FullName 'In-place reinstall'
Invoke-PackagedSmokeTest
Assert-Persistence $database.FullName 'same-version in-place reinstall'

Write-Host "INSTALLER_SMOKE_OK previous=$($previousInstaller) current=$($installer.Name) database=$($database.FullName) version_upgrade=passed in_place_reinstall=passed"
