# Fortschritt Laufcoach-App

## Stand 18.11.2026 abends: Auftrag „verbessere die Laufcoach-App“ (AUFTRAG-18-11.md) umgesetzt
- Chats exportieren: `node scripts/chats-export.mjs 2026-11-12 2026-11-18` → `chats-export/` (privat, nicht in Git). Tagesansicht als Text: `node scripts/zeige-tag.mjs JJJJ-MM-TT`.
- Coach-Zeiten an einer Stelle: `shared/config.js` (UTC 6,9,12,17,19,21 = 7/10/13/18/20/22 Uhr). Sofort-Antwort = 1 Satz mit richtiger Uhrzeit.
- Chat: ganzer Verlauf (Datum-Trenner, „Ältere laden“, `/chat`). Coach-Karte zeigt nur, was für heute gilt.
- Kraft: Sätze einzeln (Rechts – Satz 1 – 15×), Extras max. 2, „+1 Satz“ max. 2 bei der Hauptübung, Dauer berechnet, nie über 60 min (Test für alle 84 Tage). Übungstexte neu (Physio/Sportwissenschaftler/Richter, Berichte in `chats-export/agenten/`).
- Coach kann Übungstexte in der App verbessern: `POST /coach/exercise` (mit `undo`). Routine-Prompt = `COACH-PROMPT-NEU.txt`.

Auftrag: Obsidian `Projekte/Laufcoach-App Auftrag.md` · Projektordner: `Desktop\Lauftraining`

## Entscheidung 14.11. abends (Janis)
- **Kein API-Schlüssel** (kostet extra, nicht über das Claude-Abo). Sofort-Coach-Code bleibt drin, macht ohne Schlüssel nichts; App sagt „Claude antwortet um X Uhr“.
- Routine jetzt **6× täglich: 07, 10, 13, 18, 20, 22 Uhr** (cron 0 6,9,12,17,19,21 UTC), beantwortet jede neue Nachricht.
- Pulszonen auf der Uhr bleiben vorerst wie sie sind.
- Schlafdaten: **iPhone-Kurzbefehl** gewählt. Server-Endpunkt `/wellness/in?k=…` (Schlüssel in settings.wellnessKey, App → Mehr → „Link kopieren“). Kurzbefehl: Automation 9:00 → Gesundheitsproben suchen (Schlafanalyse, letzte 1 Tage, Wert ist nicht Wach) → Details: Dauer → Statistik: Summe → Inhalte von URL (POST, JSON sleep=Summe) → Mitteilung. Nach dem ersten Lauf Wert mit Garmin vergleichen (doppelt? dann Filter „ist nicht Im Bett“).

## Stand 14.11. abends: Großes Update live (Commit 7baeb92)
- Sofort-Coach: Worker ruft Claude (claude-opus-5-5, effort low, max 25 Aufrufe/Tag) bei /note, /run, /run/feel, /spotcheck. **Braucht Worker-Secret ANTHROPIC_API_KEY** (noch nicht gesetzt → bis dahin Regel-Antworten). Janis ist 14 → API-Konto muss ein Elternteil anlegen (console.anthropic.com, ab 18). Dann `npx wrangler secret put ANTHROPIC_API_KEY` im Ordner worker.
- Beschwerden-Gedächtnis (shared/followup.js, Tabelle spot_checks): Nachfrage-Karte „Wie geht's deinem rechten Schienbein?“ (Weg/Besser/Gleich/Schlimmer), Extras Stufe 1–3, „weg“ → noch 7 Tage Vorbeugung.
- „Wie war dein Lauf?“-Karte (Gefühl + Schmerz) für importierte Läufe, 15:00-Push „Vor dem Lauf: Wie geht es dir?“, Morgen-Check jeden Tag.
- Gutachten-Regeln (krank = rot, Knochen 5 Checks, Ruhepuls vs. Normalwert, Schlaf/HRV via Tabelle wellness, 10-%-Regel alle Läufe, Ferse) + 12 Fehler aus der Code-Prüfung behoben. 79 Tests grün.
- Alle Texte vereinfacht, locker = Puls 145–162 (Alarm 164), Intervalle 2/2:30 min auf 4:45–5:00. **Offen: Garmin-Workouts in Garmin Connect auf diese Werte anpassen.**
- Schlaf/HRV: Tredict nur mit Vollzugang (kostenpflichtig) oder später iPhone-Kurzbefehl → /coach/wellness.

## Stand 14.11.: Trainer-Routine läuft echt (Schlüssel + Domain eingetragen). Uhr eingerichtet, Laufcoach-Push kommt auf der Uhr an.

## ⏸ Wiedereinstieg (Pause am 13.11.2026 abends)
- **Stand:** App live, 15 Läufe über Tredict importiert, Lauf-Analyse, Coach-Nachricht, Verschieben-Fix, Auto-Update, neue Diagramme. Claude-Routine `trig_01J4pL9GAaocm5yPvZoNAnLE` läuft 5× täglich (07/13/18/20/22 Uhr), aber **ohne Schlüssel und Netzwerk-Freigabe kann sie den Worker noch nicht erreichen**.
- **Tabs:** `weiter.ps1` öffnet MORGEN.html (Anleitung für Janis), claude.ai/code, die Routine und die App.
- **Ablauf:**
  1. `npm run coach-token` im Terminal ausführen (neuer COACH_TOKEN als Worker-Secret + in die Zwischenablage, nicht anzeigen). Janis sagen: „Schlüssel liegt in der Zwischenablage“.
  2. Janis folgt MORGEN.html Abschnitt 1: Cloud-Umgebung „Default“ → Umgebungsvariable `LAUFCOACH_TOKEN=` + Strg+V → Netzwerkzugriff Domain `laufcoach-api.janis-rohde.workers.dev`. Er schreibt „erledigt“ oder „Hänge fest“.
  3. Testlauf: RemoteTrigger `run` → `list_runs` → `get_run_log`. Prüfen: Läufe importiert, Analysen und Notiz in der App.
  4. Uhr: nur Laufcoach-Nachrichten (Garmin Connect Smart Notifications, iPhone Mitteilungen pro App), Schritt für Schritt.
  5. Woche 0 (12.–15.11.) ist auf Wunsch von Janis frei, Plan startet Mo 16.11. (Probe-Einheiten gestrichen). iPhone-Schritte (Home-Bildschirm, Push, Test-Push) ggf. noch offen, nachfragen.

## Alter Wiedereinstieg (12.11., erledigt bzw. ersetzt – Strava wird nicht mehr gebraucht)
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
- [x] (14.11.) Janis: in claude.ai Cloud-Umgebung „Default“ → Umgebungsvariable LAUFCOACH_TOKEN (Strg+V aus `npm run coach-token`) + Netzwerkzugriff Domain laufcoach-api.janis-rohde.workers.dev
- [x] (14.11.) Testlauf erfolgreich: Lauf vom 14.11. importiert + ausgewertet, Kraft-Fokus Knie/Hüfte/Außenknöchel rechts, Nachricht mit Push. Dubletten-Bug (alte Kennung ohne „ext:“) in der DB behoben.
- [x] (14.11.) Uhr: nur Laufcoach-Nachrichten (iPhone Mitteilungszentrale pro App aus, Garmin Smart Notifications an)

## Phase 3 – Claude als Trainer + Strava
- [x] Coach-Schnittstelle `/coach/summary`, `/coach/note`, `/coach/override` (COACH_TOKEN)
- [x] Strava-Import-Code (Webhook + OAuth + Sync)
- [ ] Strava-API-App anlegen (Janis muss im Chrome bei Strava eingeloggt sein)
- [ ] Strava-Webhook registrieren
- [ ] Geplante Claude-Aufgabe (Cloud-Routine) einrichten

## Abschluss
- [x] START-HIER.md, Gehirn aktualisieren, Daten-und-Zugänge-Notiz
