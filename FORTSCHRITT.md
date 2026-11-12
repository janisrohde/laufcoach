# Fortschritt Laufcoach-App

Auftrag: Obsidian `Projekte/Laufcoach-App Auftrag.md` · Projektordner: `Desktop\Lauftraining`

## Start
- [x] Start-Check (Node, Git, Wrangler eingeloggt, GitHub im Chrome eingeloggt)
- [x] Skills gesucht (find-skills): cloudflare/skills, progressive-web-app, frontend-design
- [x] Repo `janisrohde/laufcoach` angelegt
- [x] Zugangscode erzeugt und Janis im Terminal gezeigt (Janis muss ihn speichern)

## Phase 1 – Heute-App mit Abhaken
- [x] plan.json mit allen Plandaten (4.1–4.9)
- [x] shared/plan.js (Tag, Woche, Level, Dosis, FP-Zuordnung)
- [x] Worker `laufcoach-api` + D1 `laufcoach-db` + Zugangscode (Hash, Token 365 Tage, 5 Fehlversuche/15 min)
- [x] Seiten: Heute, Lauf eintragen, Woche, Plan, Verlauf, Hilfe, Einstellungen, Onboarding
- [x] Timer (Pause 60 s, Halten), Satz-Punkte, Mini-Version, Verschieben, Konfetti
- [x] Unit-Tests für jeden Tag 12.11.2026–07.02.2027 + FP-Montage
- [x] Klicktest bei 375 px (Kraft-Tag, Lauf-Tag, FP-Montag, Lauf eintragen)
- [ ] Kraft-Check durch Sub-Agent und Korrekturen
- [ ] Live auf GitHub Pages
- [ ] Janis: App auf dem iPhone installieren

## Phase 2 – Push + Trainer-Logik
- [x] shared/coach.js mit Ampel, Langer-Lauf-Regeln, Puls, Tempo, Tests (VDOT)
- [x] Schwachstellen-Logik: Stelle + Seite → Extra-Kraftübungen (Wunsch 12.11.)
- [x] „zu leicht / zu schwer“ → nächste/vorherige Stufe
- [x] Cron alle 15 min: Morgen, 17:30, 20:00 Vorschau, 20:30 Lauf eintragen, So 19:00 Bericht
- [x] Wochenbericht
- [x] 24 Coach-Tests grün
- [ ] Test-Push auf iPhone + Uhr (Janis)

## Phase 3 – Claude als Trainer + Strava
- [x] Coach-Schnittstelle `/coach/summary`, `/coach/note`, `/coach/override` (COACH_TOKEN)
- [x] Strava-Import-Code (Webhook + OAuth + Sync)
- [ ] Strava-API-App anlegen (Janis muss im Chrome bei Strava eingeloggt sein)
- [ ] Strava-Webhook registrieren
- [ ] Geplante Claude-Aufgabe (Cloud-Routine) einrichten

## Abschluss
- [ ] START-HIER.md, Gehirn aktualisieren, Daten-und-Zugänge-Notiz
