// Lauf-Analyse wie ein Trainer: schaut jeden Lauf an und vergleicht mit Plan, Zonen und früheren Läufen.
import { PLAN, diffDays, addDays, mondayOf } from './plan.js';

const kindOf = (w) => (PLAN.workouts[w] ? PLAN.workouts[w].kind : 'easy');
export const paceOf = (r) => (r.distance_m && r.duration_s ? r.duration_s / (r.distance_m / 1000) : null);
export const fmtPace = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '–');
const pct = (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)} %`;

/** Effizienz: Meter pro Herzschlag (höher = fitter). */
export const efficiency = (r) => (r.distance_m && r.duration_s && r.hr_avg ? (r.distance_m / (r.duration_s / 60)) / r.hr_avg : null);

/**
 * Analysiert einen Lauf. runs = alle Läufe (für Vergleich).
 * Rückgabe: { verdict: 'gut'|'ok'|'achtung', title, points: [{icon, text}], tip }
 */
export function analyzeRun(run, runs = []) {
  const kind = kindOf(run.workout);
  const w = PLAN.workouts[run.workout] || {};
  const pace = paceOf(run);
  const km = run.distance_m ? run.distance_m / 1000 : null;
  const hilly = run.ascent_m && km ? run.ascent_m / km > 15 : false; // > 15 Hm pro km
  const points = [];
  let score = 0; // >0 gut, <0 achtung

  if (km && km < 2) {
    return { verdict: 'ok', title: 'Kurzer Lauf', points: [{ icon: 'ℹ️', text: `${km.toFixed(1)} km – zählt als Einlaufen oder Test, nicht als Training.` }], tip: null };
  }

  // --- Puls ---
  if (run.hr_avg) {
    if (kind === 'easy' || kind === 'long') {
      const limit = kind === 'long' ? 160 : 162;
      if (run.hr_avg <= limit && run.hr_avg >= 145) { points.push({ icon: '✅', text: `Ø-Puls ${run.hr_avg} – genau richtig locker (Ziel ${kind === 'long' ? 'höchstens 160' : '154–162'}).` }); score += 2; }
      else if (run.hr_avg < 145) { points.push({ icon: '✅', text: `Ø-Puls ${run.hr_avg} – sehr locker, perfekt für Erholung.` }); score += 1; }
      else if (run.hr_avg <= 166) { points.push({ icon: '⚠️', text: `Ø-Puls ${run.hr_avg} – etwas zu hoch für locker (Ziel bis ${limit}).${hilly ? ' Die Strecke war hügelig – bergauf gehen ist richtig.' : ' Etwas langsamer starten.'}` }); score -= 1; }
      else { points.push({ icon: '🔴', text: `Ø-Puls ${run.hr_avg} – das war kein lockerer Lauf mehr (Zone 3–4). Locker heißt: ganze Sätze reden können.${hilly ? ` ${run.ascent_m} Höhenmeter – bergauf gehen!` : ''}` }); score -= 2; }
      if (run.hr_max && run.hr_max >= 180) points.push({ icon: '⚠️', text: `Max-Puls ${run.hr_max} – an Steigungen ruhig gehen, damit der Puls unter 170 bleibt.` });
    } else if (kind === 'tempo') {
      points.push({ icon: 'ℹ️', text: `Ø-Puls ${run.hr_avg} (bei Tempo-Läufen mit Pausen normal höher).` });
    }
  }

  // --- Tempo ---
  if (pace && (kind === 'easy' || kind === 'long')) {
    if (pace < 365 && run.hr_avg && run.hr_avg > 162) points.push({ icon: '🐢', text: `Pace ${fmtPace(pace)} – für deinen Puls zu schnell. Locker ist bei dir gerade eher 6:30–7:00, und das ist völlig okay.` });
    else points.push({ icon: '⏱️', text: `Pace ${fmtPace(pace)} min/km${hilly ? ` bei ${run.ascent_m} Höhenmetern` : ''}.` });
  }

  // --- Länge ---
  if (kind === 'long' && w.km && km) {
    const diff = km - w.km;
    if (Math.abs(diff) <= 0.7) { points.push({ icon: '✅', text: `${km.toFixed(1)} km – Länge passt genau.` }); score += 1; }
    else if (diff > 0.7) { points.push({ icon: '⚠️', text: `${km.toFixed(1)} km statt ${w.km} km – länger als geplant. Mehr ist nicht besser, halte dich an den Plan.` }); score -= 1; }
    else points.push({ icon: 'ℹ️', text: `${km.toFixed(1)} km statt ${w.km} km – etwas kürzer, kein Problem.` });
  }

  // --- Schrittfrequenz ---
  if (run.cadence) {
    if (run.cadence >= 170) { points.push({ icon: '✅', text: `Schrittfrequenz ${run.cadence} – super, kurze leichte Schritte.` }); score += 1; }
    else if (run.cadence >= 164) points.push({ icon: '👟', text: `Schrittfrequenz ${run.cadence} – Ziel 170–172. Etwas kürzere, schnellere Schritte schonen Knie und Schienbein.` });
    else points.push({ icon: '👟', text: `Schrittfrequenz ${run.cadence} – eher niedrig. Kürzere Schritte (Ziel 170) nehmen Last vom Knie.` });
  }

  // --- Vergleich: Effizienz bei lockeren Läufen ---
  const eff = efficiency(run);
  if (eff && (kind === 'easy' || kind === 'long')) {
    const prev = runs.filter((r) => r.date < run.date && diffDays(run.date, r.date) <= 35 && ['easy', 'long'].includes(kindOf(r.workout)) && efficiency(r) && (!r.distance_m || r.distance_m > 3000));
    if (prev.length >= 2) {
      const avg = prev.reduce((s, r) => s + efficiency(r), 0) / prev.length;
      const d = eff / avg - 1;
      if (d > 0.03) { points.push({ icon: '📈', text: `Ausdauer: ${pct(d)} mehr Meter pro Herzschlag als in den letzten Wochen. Du wirst fitter!` }); score += 1; }
      else if (d < -0.05) points.push({ icon: '📉', text: `Ausdauer heute ${pct(d)} unter deinem Schnitt – Müdigkeit, Hitze, Hügel oder Stress. Achte auf Schlaf und Pausen.` });
    }
  }

  // --- Belastung: diese Woche vs. vorherige ---
  const mon = mondayOf(run.date);
  const wkKm = (m) => runs.filter((r) => r.date >= m && r.date <= addDays(m, 6) && r.date <= run.date).reduce((s, r) => s + (r.distance_m || 0), 0) / 1000;
  const thisWeek = wkKm(mon);
  const prevWeeks = [1, 2, 3].map((i) => runs.filter((r) => r.date >= addDays(mon, -7 * i) && r.date <= addDays(mon, -7 * i + 6)).reduce((s, r) => s + (r.distance_m || 0), 0) / 1000);
  const base = prevWeeks.reduce((a, b) => a + b, 0) / 3;
  if (base > 5 && thisWeek > base * 1.3) points.push({ icon: '⚠️', text: `Diese Woche schon ${thisWeek.toFixed(0)} km – deutlich mehr als dein Schnitt (${base.toFixed(0)} km). Zu viel auf einmal ist der häufigste Grund für Schmerzen.` });

  // --- Gefühl / Schmerz ---
  if (run.rpe != null) {
    if ((kind === 'easy' || kind === 'long') && run.rpe >= 7) { points.push({ icon: '⚠️', text: `Gefühl ${run.rpe}/10 – zu anstrengend für einen lockeren Lauf.` }); score -= 1; }
    if (kind === 'tempo' && run.rpe <= 6) { points.push({ icon: '💪', text: `Gefühl ${run.rpe}/10 – Tempo gut im Griff.` }); score += 1; }
  }
  if (run.pain >= 3) points.push({ icon: '🩹', text: `Schmerz ${run.pain}/10${run.pain_where ? ` (${run.pain_where}${run.pain_side ? ', ' + run.pain_side : ''})` : ''} – dafür gibt es Extra-Kraftübungen.` });

  // --- Fazit ---
  let tip = null;
  const tooFast = (kind === 'easy' || kind === 'long') && run.hr_avg > 164;
  if (tooFast) tip = 'Nächster lockerer Lauf: Starte bewusst langsam, schau auf den Puls statt aufs Tempo, und geh bergauf. Locker laufen macht dich langfristig schneller als schnell laufen.';
  else if (run.cadence && run.cadence < 168) tip = 'Nächster Lauf: Achte 3× für je 1 min auf kurze, schnelle, leise Schritte (zähl 30 Schritte in 10 s).';
  else if (score >= 2) tip = 'Genau so weitermachen!';
  const verdict = score >= 2 ? 'gut' : score <= -2 ? 'achtung' : 'ok';
  const title = verdict === 'gut' ? 'Starker Lauf 💪' : verdict === 'achtung' ? 'Zu hart für den Plan' : 'Solider Lauf';
  return { verdict, title, points, tip };
}
