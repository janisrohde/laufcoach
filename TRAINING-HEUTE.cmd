@echo off
chcp 65001 >nul
cd /d "%~dp0worker"
echo.
echo === Training von heute wird zurueckgeholt ...
call npx wrangler d1 execute laufcoach-db --remote --file ..\scripts\heute-training.sql
echo.
echo === Deine Nachrichten an den Coach von heute:
call npx wrangler d1 execute laufcoach-db --remote --command "SELECT created_at, text FROM athlete_notes WHERE date = '2026-11-17' ORDER BY id"
echo.
echo === Fertig. Oeffne die App neu - dein Training ist wieder da.
pause
