$proxies = @('109.110.51.153:1080','81.195.131.20:1080','98.175.31.222:4145','184.181.217.210:4145','152.67.22.144:1080','95.83.154.186:1080','192.111.137.37:18762','52.128.241.106:1080','117.134.203.58:10800','49.13.22.249:10811')
foreach ($p in $proxies) {
  Write-Output "=================== $p ==================="
  $job = Start-Process node -ArgumentList "probe-login.js",$p,"1.21.4","BabaProGpt" -WorkingDirectory "C:\Users\user\Desktop\BabaProGpt-bot" -NoNewWindow -PassThru -RedirectStandardOutput "out-$($p -replace '[:.]','_').log" -RedirectStandardError "err-$($p -replace '[:.]','_').log"
  if (-not $job.WaitForExit(45000)) { $job.Kill() }
  Get-Content "out-$($p -replace '[:.]','_').log"
  Get-Content "err-$($p -replace '[:.]','_').log"
}
