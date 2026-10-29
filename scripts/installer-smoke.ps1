$ErrorActionPreference = 'Stop'

$installer = Get-ChildItem -Path 'release' -Filter '*.exe' | Where-Object { $_.Name -match 'Setup' } | Select-Object -First 1
if (-not $installer) { throw 'Windows NSIS installer was not found in release/' }

$root = Join-Path $env:RUNNER_TEMP 'market-installer-smoke'
$installDir = Join-Path $root 'install'
$appDataDir = Join-Path $root 'appdata'
Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $installDir, $appDataDir -Force | Out-Null

# Electron's userData path is explicitly overridden by main.cjs before startup.
# This prevents the test from reading or modifying a real runner profile.
$env:MARKET_USER_DATA_DIR = $appDataDir
$install = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "NSIS installer exited with code $($install.ExitCode)" }

$executable = Join-Path $installDir 'Market.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw "Installed application executable was not found: $executable" }

function Invoke-PackagedSmokeTest {
  $process = Start-Process -FilePath $executable -ArgumentList @('--smoke-test') -PassThru
  if (-not $process.WaitForExit(60000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'Packaged application smoke test timed out after 60 seconds'
  }
  if ($process.ExitCode -ne 0) { throw "Packaged application smoke test failed with exit code $($process.ExitCode)" }
}

Invoke-PackagedSmokeTest
$database = Get-ChildItem -Path $appDataDir -Filter 'market.sqlite' -File -Recurse | Select-Object -First 1
if (-not $database) { throw "Packaged application did not create market.sqlite under isolated user-data directory: $appDataDir" }

# Seed a harmless marker, restart the packaged app, and verify the marker survived.
& python -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("INSERT OR REPLACE INTO app_meta (meta_key, meta_value) VALUES (''installer_smoke_sentinel'', ''preserve-me'')"); c.commit(); c.close()' $database.FullName
if ($LASTEXITCODE -ne 0) { throw 'Could not seed SQLite persistence sentinel' }

Invoke-PackagedSmokeTest
& python -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); r=c.execute("SELECT meta_value FROM app_meta WHERE meta_key=?", ("installer_smoke_sentinel",)).fetchone(); c.close(); assert r and r[0]=="preserve-me", "SQLite persistence sentinel was lost"' $database.FullName
if ($LASTEXITCODE -ne 0) { throw 'SQLite data did not survive the packaged app restart' }

# Reinstall the same build over the existing application directory. This checks that
# an in-place installer run does not delete the user's separate app-data database.
$upgrade = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
if ($upgrade.ExitCode -ne 0) { throw "In-place reinstall exited with code $($upgrade.ExitCode)" }

Invoke-PackagedSmokeTest
& python -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); r=c.execute("SELECT meta_value FROM app_meta WHERE meta_key=?", ("installer_smoke_sentinel",)).fetchone(); c.close(); assert r and r[0]=="preserve-me", "SQLite persistence sentinel was lost after in-place reinstall"' $database.FullName
if ($LASTEXITCODE -ne 0) { throw 'SQLite data did not survive in-place reinstall' }

Write-Host "INSTALLER_SMOKE_OK installer=$($installer.Name) database=$($database.FullName) in_place_reinstall=passed"
