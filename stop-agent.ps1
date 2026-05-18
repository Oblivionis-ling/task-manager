param(
  [string]$DataDir = "",
  [int]$Port = 0
)

$ErrorActionPreference = "Stop"

$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$DefaultDataDir = Join-Path $Root ".task-manager-data"
$ResolvedDataDir = if ($DataDir) {
  if ([System.IO.Path]::IsPathRooted($DataDir)) { $DataDir } else { Join-Path $Root $DataDir }
} else {
  $DefaultDataDir
}

$PidFiles = @(
  (Join-Path $DefaultDataDir "agent.pid"),
  (Join-Path $ResolvedDataDir "agent.pid")
) | Select-Object -Unique

$targetIds = New-Object System.Collections.Generic.HashSet[int]

foreach ($pidFile in $PidFiles) {
  if (-not (Test-Path -LiteralPath $pidFile)) { continue }
  try {
    $record = Get-Content -Raw -Encoding UTF8 -LiteralPath $pidFile | ConvertFrom-Json
    if ($record.pid) {
      [void]$targetIds.Add([int]$record.pid)
    }
  } catch {
    Write-Warning "Could not parse PID file: $pidFile"
  }
}

$ports = if ($Port -gt 0) { @($Port) } else { 8787..8899 }
$connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $ports -contains $_.LocalPort -and $_.OwningProcess -gt 0 }

foreach ($connection in $connections) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
  if ($process -and $process.Name -eq "node.exe" -and $process.CommandLine -match "server\.js") {
    [void]$targetIds.Add([int]$connection.OwningProcess)
  }
}

if ($targetIds.Count -eq 0) {
  Write-Host "task-manager agent is not running."
  foreach ($pidFile in $PidFiles) {
    if (Test-Path -LiteralPath $pidFile) {
      Remove-Item -LiteralPath $pidFile -Force
    }
  }
  exit 0
}

foreach ($processId in $targetIds) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $process) { continue }
  Stop-Process -Id $processId -Force
  Write-Host "Stopped task-manager agent PID $processId"
}

foreach ($pidFile in $PidFiles) {
  if (Test-Path -LiteralPath $pidFile) {
    Remove-Item -LiteralPath $pidFile -Force
  }
}
