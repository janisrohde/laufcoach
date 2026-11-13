# Fortschritt Laufcoach-App

Auftrag: Obsidian `Projekte/Laufcoach-App Auftrag.md` · Projektordner: `Desktop\Lauftraining`

## ⏸ Wiedereinstieg (Pause am 12.11.2026 abends, Janis bei seinem Vater)
- **Stand:** App live (https://janisrohde.github.io/laufcoach/), Phase 1 + 2 fertig, 61 Tests grün, Worker deployt, alles committet und gepusht.
- **Tabs öffnen:** `weiter.ps1` (App, Strava-Login, Strava-API, GitHub, Cloudflare).
- **Zuerst Janis fragen:**
  1. Zugangscode gespeichert? (Sonst `npm run code` → neuer Code im Terminal.)
  2. App auf dem iPhone: Safari → Teilen → Zum Home-Bildschirm → von dort öffnen → Benachrichtigungen erlauben → Mehr → Test-Benachrichtigung → kommt sie auf der Uhr an?
  3. Kraft-A-Probe vom 12.11. gemacht? Probelauf am Sa 14.11. eintragen.
- **Dann Phase 3:**
  1. Janis loggt sich im Chrome bei Strava ein (Code-Mail kam am 12.11. nicht an → Spam prüfen oder „Mit Google/Apple anmelden“).
  2. Claude legt unter strava.com/settings/api die API-App an (Callback-Domain `laufcoach-api.janis-rohde.workers.dev`), setzt STRAVA_CLIENT_ID/SECRET als Worker-Secrets, registriert den Webhook (`/strava/webhook`, Verify-Token = Secret STRAVA_VERIFY_TOKEN neu setzen und merken), Janis tippt in der App Mehr → „Mit Strava verbinden“.
  3. Neuen COACH_TOKEN erzeugen und eine Claude-Cloud-Routine einrichten (abends: `/coach/summary` lesen, Notizen auswerten, Kraft-Fokus erklären, `/coach/note` schreiben).

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
- [x] Kraft-Check durch Sub-Agent und Korrekturen (24 Punkte)
- [x] Live auf GitHub Pages (janisrohde.github.io/laufcoach)
- [ ] Janis: App auf dem iPhone installieren

## Phase 2 – Push + Trainer-Logik
- [x] shared/coach.js mit Ampel, Langer-Lauf-Regeln, Puls, Tempo, Tests (VDOT)
- [x] Schwachstellen-Logik: Stelle + Seite → Extra-Kraftübungen (Wunsch 12.11.)
- [x] „zu leicht / zu schwer“ → nächste/vorherige Stufe
- [x] Cron alle 15 min: Morgen, 17:30, 20:00 Vorschau, 20:30 Lauf eintragen, So 19:00 Bericht
- [x] Wochenbericht
- [x] 24 Coach-Tests grün
- [ ] Test-Push auf iPhone + Uhr (Janis)

## Stand 13.11.2026
- [x] Garmin-Läufe über Tredict importiert (15 Läufe ab 14.10.), automatische Lauf-Analyse in der App
- [x] Verschieben zeigt die ganze Einheit am neuen Tag (Bug behoben)
- [x] App aktualisiert sich selbst (version.json, jede Minute neue Daten)
- [x] „Sag deinem Coach, wie's dir geht“ + Außenknöchel als Stelle
- [x] Verlauf: Diagramme mit Zielbereich, Werten, Achsen, Wochen-km als Balken
- [x] Claude-Routine „Laufcoach – täglicher Trainer“ (trig_01J4pL9GAaocm5yPvZoNAnLE), 5× täglich 07/13/18/20/22 Uhr, nur Tredict-Connector
- [ ] Janis: in claude.ai Cloud-Umgebung „Default“ → Umgebungsvariable LAUFCOACH_TOKEN (Strg+V aus `npm run coach-token`) + Netzwerkzugriff Domain laufcoach-api.janis-rohde.workers.dev
- [ ] Testlauf der Routine prüfen (RemoteTrigger run + get_run_log)
- [ ] Uhr: nur Laufcoach-Nachrichten (iPhone Mitteilungszentrale pro App aus, Garmin Smart Notifications an)

## Phase 3 – Claude als Trainer + Strava
- [x] Coach-Schnittstelle `/coach/summary`, `/coach/note`, `/coach/override` (COACH_TOKEN)
- [x] Strava-Import-Code (Webhook + OAuth + Sync)
- [ ] Strava-API-App anlegen (Janis muss im Chrome bei Strava eingeloggt sein)
- [ ] Strava-Webhook registrieren
- [ ] Geplante Claude-Aufgabe (Cloud-Routine) einrichten

## Abschluss
- [x] START-HIER.md, Gehirn aktualisieren, Daten-und-Zugänge-Notiz
