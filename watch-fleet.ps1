param(
  [int]$MaxBots = 500,
  [int]$LoopSec = 30,
  [int]$LaunchPerCycle = 4
)
$ErrorActionPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

$me = $PID
$others = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'watch-fleet\.ps1' -and $_.ProcessId -ne $me })
if ($others.Count -gt 0) { exit }

$names = Get-Content names-500.txt | Where-Object { $_ }
$skip  = @('45.74.31.')
$assigned = @{}
$li = 0

function Get-LiveProxies {
  $rows = @()
  foreach ($line in (Get-Content proxies-live.txt -ErrorAction SilentlyContinue)) {
    if (-not $line) { continue }
    $parts = $line -split '\s+'
    $p = $parts[0]
    if ($parts.Count -gt 1) { $lat = [double]$parts[1] } else { $lat = 999999 }
    if ($skip | Where-Object { $p.StartsWith($_) }) { continue }
    $rows += [pscustomobject]@{ proxy = $p; lat = $lat }
  }
  return @($rows | Sort-Object lat | ForEach-Object { $_.proxy } | Select-Object -Unique)
}

function Test-AccountStopped([string]$Name, [string]$Root = $PSScriptRoot) {
  $key = 'play.diyojennw.com.tr:25565:' + $Name.ToLowerInvariant()
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($key))).Replace('-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
  return Test-Path -LiteralPath (Join-Path $Root ('.account-stops\' + $hash + '.json'))
}

while ($true) {
  $live = Get-LiveProxies
  $running = @{}
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object {
    if ($_.CommandLine -match 'bot\.js (babayiz_\w+)') { $running[$matches[1]] = $true }
  }
  $nodeCount = @(Get-Process node -ErrorAction SilentlyContinue).Count
  $os = Get-CimInstance Win32_OperatingSystem
  $freeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)

  $inside = 0
  $stopped = 0
  $launched = 0
  $report = @()
  foreach ($name in $names) {
    if (Test-AccountStopped $name) { $stopped++; continue }
    $insideNow = $false
    $logf = "bot-status-" + $name.ToLower() + ".log"
    if (Test-Path $logf) {
      if ((Get-Item $logf).LastWriteTime -gt (Get-Date).AddMinutes(-5) -and (Select-String -Path $logf -Pattern 'SPAWN' -Quiet)) { $insideNow = $true; $inside++ }
    }
    $report += $name + "|" + $(if ($running.ContainsKey($name)) { "run" } else { "down" }) + "|" + $(if ($insideNow) { "in" } else { "-" })

    $canLaunch = ($nodeCount -lt $MaxBots) -and ($freeGB -gt 0.35)
    if ($canLaunch -and (-not $running.ContainsKey($name)) -and ($launched -lt $LaunchPerCycle) -and ($live.Count -gt 0)) {
      if (-not $assigned.ContainsKey($name)) {
        $assigned[$name] = $live[$li % $live.Count]
        $li++
        $pf = "proxies-" + $name.ToLower() + ".txt"
        @($assigned[$name]) + @($live | Where-Object { $_ -ne $assigned[$name] }) | Set-Content $pf -Encoding ascii
      }
      $lname = $name.ToLower()
      $cmdPath = Join-Path $PSScriptRoot ("run-" + $lname + ".cmd")
      $lines = @(
        '@echo off',
        "cd /d `"$PSScriptRoot`"",
        "set MC_PROXY=$($assigned[$name])",
        "set MC_PROXIES_FILE=proxies-$lname.txt",
        "set MC_CHATFILE=messages.txt",
        "set MC_CHAT_MS=3000",
        "node --max-old-space-size=128 --max-semi-space-size=4 bot.js $name 1>nul 2>>bot-err-$lname.log"
      )
      $lines | Set-Content $cmdPath -Encoding ascii
      $res = ([wmiclass]'Win32_Process').Create('wscript.exe "' + $PSScriptRoot + '\hidden.vbs" "' + $cmdPath + '"', $PSScriptRoot)
      $launched++
      $nodeCount++
      Start-Sleep 1
    }
  }
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content fleet-500.log "[$stamp] names=$($names.Count) node=$nodeCount inside=$inside stopped=$stopped freeRAM=${freeGB}GB live=$($live.Count) launched=$launched | $($report -join ' ')"
  Start-Sleep -Seconds $LoopSec
}
