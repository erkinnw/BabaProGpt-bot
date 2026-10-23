$proxies = Get-Content .\proxies-working.txt | ForEach-Object { ($_ -split ' ')[0] }
# prefer non-45.74.31.x first for variety, then the pool
$ordered = @($proxies | Where-Object { $_ -notmatch '^45\.74\.31\.' }) + @($proxies | Where-Object { $_ -match '^45\.74\.31\.' })
foreach ($p in $ordered) {
  Write-Output "=================== $p ==================="
  $tag = ($p -replace '[:.]','_')
  $out = "cap-out-$tag.log"; $err = "cap-err-$tag.log"
  $proc = Start-Process node -ArgumentList "capture-captcha.js",$p -WorkingDirectory (Get-Location) -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  if (-not $proc.WaitForExit(50000)) { $proc.Kill(); Start-Sleep -Seconds 1 }
  if (Test-Path $out) { Get-Content $out }
  if (Test-Path $err) { Get-Content $err | Select-Object -First 5 }
  if (Get-ChildItem map-dump-*.json -ErrorAction SilentlyContinue) {
    Write-Output ">>> MAP DUMP CAPTURED with proxy $p"
    break
  }
}
