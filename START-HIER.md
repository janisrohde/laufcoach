# Laufcoach – Start hier

Deine Trainings-App für den 12-Wochen-Plan (ab 16.11.2026). Keine Geheimnisse in dieser Datei.

## Adressen
- App: https://janisrohde.github.io/laufcoach/
- Server: https://laufcoach-api.janis-rohde.workers.dev
- Code: https://github.com/janisrohde/laufcoach

## Dienste (alles gratis)
| Teil | Dienst |
|---|---|
| App (PWA) | GitHub Pages, Ordner `docs/` im Repo |
| Server | Cloudflare Worker `laufcoach-api` (Cron alle 15 min) |
| Datenbank | Cloudflare D1 `laufcoach-db` |
| Push | Web Push (VAPID) direkt aus dem Worker |
| Läufe automatisch | Strava (Garmin → Strava → Worker) |

## Befehle
- `npm run dev` – App lokal starten
- `npm test` – alle Tests
- `npm run build` – App nach `docs/` bauen (danach committen + pushen)
- `npm run deploy:worker` – Server hochladen
- `npm run deploy` – Tests + Build + Server
- `npm run code` – neuen Zugangscode erzeugen (alter gilt dann nicht mehr)

## Aufbau
- `src/data/plan.json` – alle Plandaten (Läufe, Kraft, FP, Regeln)
- `shared/plan.js` – welcher Tag, welche Übung, welche Dosis
- `shared/coach.js` – Trainer-Regeln (Ampel, Anpassungen, Schwachstellen, Tests)
- `worker/` – Server (Login, Daten, Push, Strava, Coach-Schnittstelle)
- `src/main.js` – App-Oberfläche

## Secrets (nur im Worker, nie im Code)
ACCESS_CODE_HASH, SESSION_SECRET, COACH_TOKEN, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, STRAVA_VERIFY_TOKEN, später STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.
