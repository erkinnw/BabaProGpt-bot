$proxies = Get-Content .\proxies-working.txt | ForEach-Object { ($_ -split ' ')[0] }
$ordered = @($proxies | Where-Object { $_ -notmatch '^45\.74\.31\.' }) + @($proxies | Where-Object { $_ -match '^45\.74\.31\.' })
$count = 0
foreach ($p in $ordered) {
  if ($count -ge 8) { break }
  $tag = ($p -replace '[:.]','_')
  $out = "c2-out-$tag.log"; $err = "c2-err-$tag.log"
  Write-Output "--- proxy $p (have $count) ---"
  $proc = Start-Process node -ArgumentList "capture-captcha2.js",$p,"smp" -WorkingDirectory (Get-Location) -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  if (-not $proc.WaitForExit(40000)) { $proc.Kill(); Start-Sleep -Seconds 1 }
  $saves = (Select-String -Path $out -Pattern '\[map saved\]' -ErrorAction SilentlyContinue)
  if ($saves) { $count += $saves.Count }
  Write-Output "result: saves=$savedNow saved total: $count"
}
Get-ChildItem smp-*.png | Select-Object Name, Length
