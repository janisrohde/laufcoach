# Auftrag 18.11.2026 – Laufcoach-App: Tiefe Fehlersuche + Übungen + Coach

Auslöser: Janis hat am **Mi 18.11.2026** das Training in der App gemacht (er dachte, es ist Dienstag – prüfen, was die App ihm wirklich gezeigt hat). Viele Probleme hat er im Coach-Chat gemeldet. Ein Teil davon ist im Chat nicht mehr zu sehen.
Arbeitsweise: alles selbst machen, ohne Nachfrage. Janis nur bei Logins/Handy einbinden. Nichts löschen (keine Daten, keine Nachrichten). Am Ende kurze, nummerierte Zusammenfassung.

## 0. Zuerst: ALLE Chats zurückholen und lesen
1. Aus der **Remote-D1** `laufcoach-db` (wrangler, `--remote`) exportieren: alle `athlete_notes`, `coach_notes`, Checks/Wellness, Abhaken-Daten und Läufe seit 12.11.2026. Speichern unter `chats-export/2026-11-18.json` + lesbar als `chats-export/2026-11-18.md` (nach Zeit sortiert, „Janis“ / „Coach“).
2. Jede Nachricht von Janis **vollständig** lesen, besonders 17.11. und 18.11. Prüfen, ob Texte beim Speichern abgeschnitten wurden (`worker/src/index.js` → `str(v, max = 2000)`).
3. Liste `chats-export/probleme-18-11.md`: jedes Problem, das Janis gemeldet hat, mit Zitat, Übung, Uhrzeit. Diese Liste ist die Grundlage für alles Weitere – jeder Punkt muss am Ende erledigt sein.

## 1. Bekannte Fehler (schon gefunden, beheben)
1. **Chat schneidet ab:** `src/main.js` `chatCard()` zeigt nur `.slice(-6)`; Coach-Antworten nur von `state.date` und nur nach der ersten eigenen Nachricht; Worker lädt `coach_notes … LIMIT 3`. → Ganzen Verlauf zeigen (scrollbar, neueste unten, ältere Tage mit Datum-Trenner, „Ältere laden“). Nichts geht verloren. Lange Nachrichten nicht kürzen.
2. **Falsche Uhrzeit „7 Uhr“:** `nextRound()` und alle Texte mit Uhrzeiten (`main.js` Z. ~390, ~401, ~852, `COACH-PROMPT-NEU.txt`, Worker-Antworten) prüfen. Die echten Zeiten der Routine „Laufcoach – täglicher Trainer“ (trig_01J4pL9GAaocm5yPvZoNAnLE) nachsehen (Notizen widersprechen sich: 5× 7/13/18/20/22 oder 6× 7/10/13/18/20/22). Zeiten an **einer** Stelle festlegen (z. B. `shared/config.js`) und überall daraus lesen. Zeitzone Europe/Berlin. Herausfinden, warum Janis „immer 7 Uhr“ sieht, und beheben.
3. **Sofort-Antwort zu lang:** Wenn Janis schreibt, kommt nur **ein Satz**: „Danke! Claude antwortet dir um HH:MM Uhr – schau dann hier in der App.“ (richtige nächste Zeit). Keine Wiederholung, was heute dran ist.
4. **Alte Sachen von gestern:** z. B. steht „starker Lauf“ (o. ä.), obwohl Janis gestern schon gelaufen ist. Die Heute-Ansicht muss aus dem **echten Verlauf** rechnen: Welcher Tag ist heute (Datum + Wochentag groß anzeigen)? Was steht laut Plan an? Was wurde gestern wirklich gemacht (Lauf, Kraft, abgehakt, verschoben, abgesagt)? Daraus heute ableiten. Hinweise, Coach-Notizen, „von gestern verschoben“, Lauf-Hinweise usw. nur zeigen, wenn sie für **heute** gelten. Alles Veraltete raus. `shared/plan.js` (`getDay`, Overrides, „verschoben“-Logik) und `shared/coach.js` durchgehen.

## 2. Übungen neu und genau erklären
Janis konnte manche Übungen nicht machen, weil sie zu ungenau waren (z. B. „seitlich auf den Ball legen“, „hinsetzen und dann wieder auf den Fuß stellen“). Für **jede** Übung in `src/data/plan.json` (Kraft A, B, Extra-Übungen, FP, Dehnen):
1. **Startposition** ganz konkret: liegen/sitzen/stehen, worauf (Boden, Matte, Ball, Stuhl, Stufe), welcher Körperteil wo, Blickrichtung, wo Hände und Füße sind.
2. **Bewegung** in 2–4 kurzen Schritten, jeder Schritt eine Sache. Keine Wörter, die man unterschiedlich verstehen kann. Kein Englisch.
3. **Woran merke ich, dass es richtig ist** (1 Satz) und **häufigster Fehler** (1 Satz).
4. **Ohne Gerät / zu schwer?** eine einfache Ersatzübung.
5. **Sätze zum Abhaken einzeln aufbauen**, in genau der Reihenfolge, z. B.:
   `☐ Rechts – Satz 1 – 10×` · `☐ Links – Satz 1 – 10×` · `☐ Rechts – Satz 2 – 10×` · `☐ Links – Satz 2 – 10×` · danach „Pause 60 s“ mit Timer.
   Betroffene Seite zuerst (bestehende Regel). Wiederholungen, Haltezeit, Gewicht (kg) und Pause pro Satz sichtbar.
6. Die konkret gemeldeten Übungen aus `probleme-18-11.md` zuerst, und prüfen, ob es ähnliche Fälle gibt.

## 3. Dauer: höchstens 1 Stunde
Das Training mit Extra-Übungen war deutlich länger als 45 min.
1. Für jede Übung die echte Zeit berechnen: Sätze × Seiten × (Wdh. × Sekunden pro Wdh. + Haltezeit) + Pausen + Wechsel/Aufbau.
2. Ziel 45 min, **harte Grenze 60 min inkl. Extras und Aufwärmen**. Wird es länger: Extras kürzen/weglassen (wichtigste behalten), nicht einfach Pausen streichen.
3. Angezeigte Minuten = echte, berechnete Minuten. Test, der jeden Tag aller 12 Wochen prüft (`npm test`).

## 4. Coach schlauer machen (Routine + Sofort-Coach)
1. Der Coach bekommt immer: den **ganzen** Chatverlauf der letzten 7 Tage (nicht nur 3 Notizen), die **genaue Übungsliste von heute** mit IDs und Namen, was abgehakt ist und was gestern war.
2. Er darf Übungen nicht verwechseln: Wenn Janis eine Übung nennt, diese über Name/ID zuordnen; ist es unklar, kurz nachfragen.
3. Er **diskutiert**: geht auf Janis' Argumente ein, erklärt kurz warum, und macht **praktikable Lösungen** (Ersatzübung, ohne Gerät, kürzere Variante, später am Tag) statt Absage oder Standardtext. Wenn Janis sagt, eine Übung ist unklar: die Erklärung in der App wirklich verbessern (Override speichern) und ihm die neue Version kurz schreiben.
4. Antworten kurz (max. 3–4 Sätze), keine langen Tagesübersichten.
5. `COACH-PROMPT-NEU.txt` und `worker/src/ai.js` (`SYSTEM`) entsprechend anpassen. Routine-Prompt ersetzen (am 17.11. ging das per RemoteTrigger – sonst Janis Schritt für Schritt anleiten).
6. Danach den Coach Janis' Nachrichten vom 17.11. und 18.11. **nochmal komplett lesen und neu beantworten** lassen (Routine einmal ausführen oder Antwort in `coach_notes`).

## 5. Agenten-Team (Sub-Agents) – diskutieren, dann entscheiden
Alle bekommen: `chats-export/2026-11-18.md`, `probleme-18-11.md`, `src/data/plan.json`, Screenshots/Text der Heute-Ansicht.
1. **Sportwissenschaftler** – stimmen Übungen, Dosis, Reihenfolge, Dauer für einen 14-jährigen Läufer (Halbmarathon-Plan, Schienbein rechts beobachten)?
2. **Physio/Trainer** – sind Startpositionen und Bewegungen sicher und eindeutig?
3. **Janis-Tester (14 Jahre)** – liest jede Übung und sagt ehrlich, was er nicht versteht oder anders machen würde.
4. **Diskutierer (Gegenposition)** – greift die Vorschläge der anderen an, sucht Lücken und Widersprüche.
5. **Richter** – entscheidet pro Punkt: umsetzen / ändern / weglassen, mit 1 Satz Grund. Nur was der Richter freigibt, wird gebaut.
6. **Bug-Jäger (Code)** – geht `main.js`, `shared/*.js`, `worker/src/*.js` durch: veraltete Daten, Datum/Zeitzone, abgeschnittene Listen, Limits, Caching (Service Worker zeigt alte Version?), Fehler beim Abhaken.
7. **5–6 Nutzer-Ideen-Agenten** (aus Sicht von Janis, je eine Rolle: Morgen vor dem Training, mitten im Training, nach dem Lauf, Handy-Bedienung mit einer Hand, Motivation über Wochen, Schmerz/Unsicherheit): je max. 5 Ideen, was fehlt oder nervt. Richter wählt die besten (max. 6) aus.
Ablauf: Runde 1 alle Befunde → Diskutierer → Richter → umsetzen → Runde 2: Janis-Tester + Bug-Jäger prüfen das Ergebnis nochmal.

## 6. Prüfen
1. `npm test` grün; neue Tests: ganzer Chatverlauf sichtbar, keine veralteten Hinweise (gestern gelaufen → heute korrekt), Dauer ≤ 60 min an allen Tagen, jede Übung hat Startposition/Schritte/Sätze pro Seite, Uhrzeiten aus der Config.
2. `node scripts/pruefe-tage.mjs` für heute + die nächsten 7 Tage mit Live-Daten.
3. Klicktest bei 375 px (Chrome, sonst eingebauter Browser): Heute, eine Kraft-Einheit komplett abhaken, Chat mit >10 Nachrichten, Nachricht senden (Ein-Satz-Antwort mit richtiger Uhrzeit).
4. Prüfen, dass das iPhone die neue Version bekommt (Service-Worker-Update).
5. Deployen (`npm run deploy`), committen, pushen.

## 7. Abschluss
1. Janis kurz und nummeriert zeigen: was war kaputt, was ist jetzt anders, was er am Handy prüfen soll.
2. Gehirn: `Projekte/Laufcoach-App.md` (Stand) + neue Notiz `Chats/2026-11-18 Laufcoach Fehlersuche.md`.
3. Schienbein-Regel bleibt: tut ein Punkt am Knochen richtig weh → nicht laufen, Eltern/Arzt.
