# Öffnet alle Tabs, um an der Laufcoach-App weiterzuarbeiten (Stand 13.11.2026).
# 1. Anleitung (MORGEN.html), 2. claude.ai/code (Cloud-Umgebung eintragen), 3. Trainer-Routine, 4. App
$anleitung = 'file:///' + ((Join-Path $PSScriptRoot 'MORGEN.html') -replace '\\', '/')
$urls = @(
  $anleitung,
  'https://claude.ai/code',
  'https://claude.ai/code/routines/trig_01J4pL9GAaocm5yPvZoNAnLE',
  'https://janisrohde.github.io/laufcoach/'
)
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LocalAppData\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) { Start-Process $chrome -ArgumentList (@('--new-window') + $urls) } else { $urls | ForEach-Object { Start-Process $_ } }
