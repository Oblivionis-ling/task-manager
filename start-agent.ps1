param(
  [int]$Port = 8787,
  [string]$DataDir = "",
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$ServerPath = Join-Path $Root "server.js"
$ResolvedDataDir = if ($DataDir) {
  if ([System.IO.Path]::IsPathRooted($DataDir)) { $DataDir } else { Join-Path $Root $DataDir }
} else {
  Join-Path $Root ".task-manager-data"
}

New-Item -ItemType Directory -Force -Path $ResolvedDataDir | Out-Null

$PidFile = Join-Path $ResolvedDataDir "agent.pid"
$OutLog = Join-Path $ResolvedDataDir "agent.out.log"
$ErrLog = Join-Path $ResolvedDataDir "agent.err.log"

function Get-AgentListener {
  param([int]$StartPort)

  $connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -ge $StartPort -and $_.LocalPort -le 8899 -and $_.OwningProcess -gt 0 }

  foreach ($connection in $connections) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
    if ($process -and $process.Name -eq "node.exe" -and $process.CommandLine -match "server\.js") {
      return [pscustomobject]@{
        Port = $connection.LocalPort
        ProcessId = $connection.OwningProcess
        CommandLine = $process.CommandLine
      }
    }
  }
  return $null
}

if (-not (Test-Path -LiteralPath $ServerPath)) {
  throw "server.js not found: $ServerPath"
}

$existing = Get-AgentListener -StartPort $Port
if ($existing) {
  Write-Host "task-manager agent is already running."
  Write-Host "URL: http://127.0.0.1:$($existing.Port)"
  Write-Host "PID: $($existing.ProcessId)"
  exit 0
}

if ($DataDir) {
  $env:TASK_MANAGER_DATA_DIR = $ResolvedDataDir
}

if ($Foreground) {
  Write-Host "Starting task-manager agent in foreground..."
  Write-Host "Data dir: $ResolvedDataDir"
  & node $ServerPath --port $Port
  exit $LASTEXITCODE
}

$process = Start-Process `
  -FilePath "node" `
  -ArgumentList @("server.js", "--port", "$Port") `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutLog `
  -RedirectStandardError $ErrLog `
  -PassThru

$actualPort = $null
for ($attempt = 0; $attempt -lt 40 -and -not $actualPort; $attempt++) {
  Start-Sleep -Milliseconds 250
  foreach ($candidate in $Port..8899) {
    try {
      $state = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$candidate/api/state" -TimeoutSec 1
      if ($state.store_path) {
        $actualPort = $candidate
        break
      }
    } catch {
      # Keep probing until the server is ready or the timeout expires.
    }
  }
}

if (-not $actualPort) {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
  throw "task-manager agent did not become ready. Check $ErrLog"
}

$record = [ordered]@{
  pid = $process.Id
  requested_port = $Port
  port = $actualPort
  url = "http://127.0.0.1:$actualPort"
  data_dir = $ResolvedDataDir
  started_at = (Get-Date).ToString("o")
  stdout_log = $OutLog
  stderr_log = $ErrLog
}
$record | ConvertTo-Json | Set-Content -LiteralPath $PidFile -Encoding UTF8

Write-Host "task-manager agent started."
Write-Host "URL: $($record.url)"
Write-Host "PID: $($record.pid)"
Write-Host "Data dir: $ResolvedDataDir"
Write-Host "PID file: $PidFile"
