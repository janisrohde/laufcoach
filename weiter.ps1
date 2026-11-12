# Öffnet alle Tabs, um an der Laufcoach-App weiterzuarbeiten.
$urls = @(
  'https://janisrohde.github.io/laufcoach/',
  'https://www.strava.com/login',
  'https://www.strava.com/settings/api',
  'https://github.com/janisrohde/laufcoach',
  'https://dash.cloudflare.com/'
)
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LocalAppData\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) { Start-Process $chrome -ArgumentList (@('--new-window') + $urls) } else { $urls | ForEach-Object { Start-Process $_ } }
