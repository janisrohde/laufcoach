// Feste Einstellungen an EINER Stelle (App, Worker, Tests lesen von hier).
// Eigene kleine Zeit-Funktion (kein Import aus plan.js, sonst Kreis-Import)
function berlinTime(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  return { hour: Number(parts.find((p) => p.type === 'hour').value), minute: Number(parts.find((p) => p.type === 'minute').value) };
}

/**
 * Wann die Claude-Routine „Laufcoach – täglicher Trainer“ (trig_01J4pL9GAaocm5yPvZoNAnLE) läuft.
 * Cron in UTC: 0 6,9,12,17,19,21 * * * → im Winter (MEZ) 7, 10, 13, 18, 20, 22 Uhr Berlin.
 * Die Routine braucht nach dem Start ca. 1–3 min, bis die Antwort in der App steht.
 */
/** Cron der Routine in UTC (so steht es in der Routine). Berliner Uhrzeit wird daraus berechnet → stimmt auch in der Sommerzeit. */
export const COACH_HOURS_UTC = [6, 9, 12, 17, 19, 21];
export const COACH_MINUTE = 5; // „ca. HH:05“ – so lange braucht die Routine

const two = (n) => String(n).padStart(2, '0');

/** Berliner Stunden der Routine an dem Tag von `d` (Winter: 7, 10, 13, 18, 20, 22). */
export function coachHours(d = new Date()) {
  const day = d.toISOString().slice(0, 10);
  return COACH_HOURS_UTC.map((h) => berlinTime(new Date(`${day}T${two(h)}:00:00Z`)).hour);
}
export const COACH_HOURS = coachHours(new Date('2026-11-18T12:00:00Z'));

/** Nächste Coach-Runde ab `d` (Berlin-Zeit): { hour, minute, tomorrow, text: "20:05" }. */
export function nextCoachRound(d = new Date()) {
  const { hour, minute } = berlinTime(d);
  const now = hour * 60 + minute;
  const hours = coachHours(d);
  // Die Routine liest um HH:00. Wer danach schreibt, kommt in die nächste Runde.
  const h = hours.find((x) => x * 60 > now);
  const hh = h ?? coachHours(new Date(d.getTime() + 86400000))[0];
  return { hour: hh, minute: COACH_MINUTE, tomorrow: h == null, text: `${two(hh)}:${two(COACH_MINUTE)}` };
}

/** Der eine Satz, den Janis sofort nach dem Schreiben bekommt. */
export function replyPromise(d = new Date()) {
  const n = nextCoachRound(d);
  return `Danke! Claude antwortet dir ${n.tomorrow ? 'morgen ' : ''}um ${n.text} Uhr – schau dann hier in der App.`;
}

/** Text für Hilfe/Chat-Kopf: „7, 10, 13, 18, 20 und 22 Uhr“. */
export const coachHoursText = (d = new Date()) => { const h = coachHours(d); return `${h.slice(0, -1).join(', ')} und ${h[h.length - 1]} Uhr`; };

/** Dauer einer Kraft-Einheit: Ziel und harte Grenze (inkl. Aufwärmen und Extras). */
export const SESSION_TARGET_MIN = 45;
export const SESSION_MAX_MIN = 60;
