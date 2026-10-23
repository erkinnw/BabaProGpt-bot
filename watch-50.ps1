param(
  [int]$Wave = 50,
  [int]$LoopSec = 30
)
$ErrorActionPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

$names = Get-Content names-50.txt | Where-Object { $_ } | Select-Object -First $Wave
$skip  = @('45.74.31.')
$assigned = @{}
$i = 0

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
  $banned = @{}
  if (Test-Path banned-proxies.json) { try { $banned = (Get-Content banned-proxies.json -Raw | ConvertFrom-Json).PSObject.Properties.Name } catch {} }
  $rows = $rows | Where-Object { $banned -notcontains $_.proxy }
  return @($rows | Sort-Object lat | ForEach-Object { $_.proxy } | Select-Object -Unique)
}

while ($true) {
  $live = Get-LiveProxies
  $bannedSet = @()
  if (Test-Path banned-proxies.json) { try { $bannedSet = @((Get-Content banned-proxies.json -Raw | ConvertFrom-Json).PSObject.Properties.Name) } catch {} }
  $running = @{}
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object {
    if ($_.CommandLine -match 'bot\.js (babayiz_\d+)') { $running[$matches[1]] = $true }
  }
  $inside = 0
  $report = @()
  $launched = 0
  foreach ($name in $names) {
    $insideNow = $false
    if (Test-Path ("bot-status-" + $name.ToLower() + ".log")) {
      if (Select-String -Path ("bot-status-" + $name.ToLower() + ".log") -Pattern 'SPAWN' -Quiet) { $insideNow = $true; $inside++ }
    }
    $report += $name + "|" + $(if ($running.ContainsKey($name)) { "run" } else { "down" }) + "|" + $(if ($insideNow) { "in" } else { "-" })
    if (-not $running.ContainsKey($name) -and $launched -lt 3) {
      if ($live.Count -gt 0) {
        $needAssign = (-not $assigned.ContainsKey($name)) -or ($bannedSet -contains $assigned[$name])
        if ($needAssign) {
          $cand = @($live | Where-Object { @($assigned.Values) -notcontains $_ })
          if ($cand.Count) { $assigned[$name] = $cand[0] } else { $assigned[$name] = $live[$ci % $live.Count] }
        }
        $primary = $assigned[$name]
        $pf = "proxies-" + $name.ToLower() + ".txt"
        $content = @($primary) + @($live | Where-Object { $_ -ne $primary })
        $content | Set-Content $pf -Encoding ascii
        $env:MC_PROXY = $primary
        $env:MC_PROXIES_FILE = $pf
        Remove-Item ("proxy-pin-" + $name.ToLower() + ".json") -ErrorAction SilentlyContinue
        Start-Process node -ArgumentList 'bot.js', $name -RedirectStandardOutput ("bot-status-" + $name.ToLower() + ".log") -RedirectStandardError ("bot-err-" + $name.ToLower() + ".log") -WindowStyle Hidden
        Start-Sleep 1
        $launched++
      }
    }
    $ci++
  }
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content fleet-50.log "[$stamp] targets=$($names.Count) procs=$($running.Count) insideSPAWN=$inside live_proxies=$($live.Count) | $($report -join ' ')"
  Start-Sleep -Seconds $LoopSec
}
