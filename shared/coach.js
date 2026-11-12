// Trainer-Logik: reine Funktionen, keine Datenbank.
// Eingabe: alle Daten (Checks, Läufe, Feedback, manuelle Overrides), Ausgabe: Anpassungen für ein Datum.
import { PLAN, getDay, addDays, diffDays, planWeek, weekInfo, weekday, mondayOf } from './plan.js';

export const AREAS = {
  knie: { label: 'Knie', extras: ['knie', 'huefte'] },
  schienbein: { label: 'Schienbein', extras: ['schienbein', 'wade'] },
  innenknoechel: { label: 'Innenknöchel', extras: ['innenknoechel', 'wade'] },
  grosszehe: { label: 'Großzehe', extras: ['grosszehe'] },
  wade: { label: 'Wade', extras: ['wade'] },
  huefte: { label: 'Hüfte', extras: ['huefte'] },
  schulter: { label: 'Schulter', extras: ['schulter'] },
};

const KEYWORDS = [
  [/knie/i, 'knie'], [/schienbein|shin/i, 'schienbein'], [/kn[öo]chel|sprunggelenk/i, 'innenknoechel'],
  [/zeh/i, 'grosszehe'], [/wade/i, 'wade'], [/h[üu]fte|leiste|po\b/i, 'huefte'], [/schulter|nacken/i, 'schulter'],
];

/** Stelle(n) und Seite aus Freitext lesen, z. B. „rechtes Knie gezwickt“. */
export function parseNote(text = '') {
  const areas = [];
  for (const [re, a] of KEYWORDS) if (re.test(text) && !areas.includes(a)) areas.push(a);
  let side = null;
  if (/recht/i.test(text)) side = 'rechte';
  else if (/link/i.test(text)) side = 'linke';
  return { areas, side };
}

const sideWord = (s) => (s === 'rechts' || s === 'rechte' ? 'rechte' : s === 'links' || s === 'linke' ? 'linke' : null);
const fmtDate = (s) => `${+s.slice(8, 10)}.${+s.slice(5, 7)}.`;
const kindOf = (w) => (PLAN.workouts[w] ? PLAN.workouts[w].kind : null);

/** Ampel aus einem Morgen-Check. */
export function checkColor(c) {
  if (!c) return null;
  const max = Math.max(c.squat ?? 0, c.shin ?? 0, c.hop ?? 0);
  if (c.bone || c.limp || max >= 5) return 'rot';
  if (max >= 3) return 'gelb';
  return 'gruen';
}

/** Ampel aus einem eingetragenen Lauf. Schmerz, der schnell weg war, macht den Lauf nicht gelb. */
export function runColor(r) {
  if (!r || r.pain == null) return 'gruen';
  const gone = r.pain_gone === 'schnell';
  if (r.pain >= 5) return gone ? 'gelb' : 'rot';
  if (r.pain >= 3 && !gone) return 'gelb';
  if (r.pain >= 3 && r.pain_when === 'ende' && !gone) return 'gelb';
  return 'gruen';
}

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/** Längster Lauf der letzten 30 Tage in km (null, wenn keine Distanz bekannt). */
function longest30(runs, date) {
  const d = runs.filter((r) => r.distance_m && diffDays(date, r.date) > 0 && diffDays(date, r.date) <= 30).map((r) => r.distance_m / 1000);
  return d.length ? Math.max(...d) : null;
}

const LONG_KM = [9, 10, 11, 12, 13, 14];
const longName = (km) => `Lang ${km} km`;
const floorLong = (km) => LONG_KM.filter((k) => k <= km).pop() || 9;

/** VDOT nach Daniels/Gilbert aus Zeit (s) und Strecke (m). */
export function vdot(seconds, meters = 5000) {
  const t = seconds / 60;
  const v = meters / t;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  return vo2 / pct;
}
function paceFor(vd, frac) {
  const vo2 = vd * frac;
  const a = 0.000104, b = 0.182258, c = -(vo2 + 4.6);
  const v = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a); // m/min
  const secPerKm = 60000 / v;
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}`;
}
export function zonesFromVdot(vd) {
  return {
    vdot: Math.round(vd * 10) / 10,
    locker: `${paceFor(vd, 0.74)}–${paceFor(vd, 0.62)}`,
    zuegig: `${paceFor(vd, 0.84)}–${paceFor(vd, 0.8)}`,
    schwelle: `${paceFor(vd, 0.9)}–${paceFor(vd, 0.86)}`,
    schnell: `${paceFor(vd, 1.0)}–${paceFor(vd, 0.96)}`,
  };
}
export const parseTime = (s) => {
  if (s == null || s === '') return null;
  const p = String(s).split(':').map(Number);
  if (p.some(Number.isNaN)) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0];
};
const fmtPace = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** Geplanter (unangepasster) Lauf an einem Datum. */
const plannedRun = (d) => { const x = getDay(d); return x.type === 'run' ? x.workout : null; };

/**
 * Hauptfunktion: Anpassungen für `date`.
 * data: { checks:[{date,squat,shin,hop,bone,limp,sick,rhr}], runs:[...], feedback:[{date,ex_id,value}], manual:[{date,field,value,reason}] }
 * Rückgabe: { ampel, overrides:{...}, messages:[{type,text}] }
 */
export function adjust(date, data = {}) {
  const checks = [...(data.checks || [])].sort((a, b) => a.date.localeCompare(b.date));
  const runs = [...(data.runs || [])].sort((a, b) => a.date.localeCompare(b.date) || (a.id || 0) - (b.id || 0));
  const feedback = data.feedback || [];
  const ov = { reasons: [] };
  const messages = [];
  const planned = plannedRun(date);
  const plannedKind = kindOf(planned);
  const past = (arr, days) => arr.filter((x) => x.date <= date && diffDays(date, x.date) <= days);

  // ---------- 1. Ampel ----------
  const todayCheck = checks.find((c) => c.date === date);
  const recentChecks = past(checks, 14);
  const recentRuns = past(runs, 2).filter((r) => r.date < date || r.date === date);
  let ampel = 'gruen';
  let why = null;

  // Rot mit Knochenpunkt: 7 Tage kein Laufen ab letztem Knochen-Check
  const lastBone = [...past(checks, 30)].reverse().find((c) => c.bone);
  const lastRed = [...recentChecks].reverse().find((c) => checkColor(c) === 'rot');
  const lastRedRun = [...past(runs, 14)].reverse().find((r) => runColor(r) === 'rot');
  const redDate = [lastRed?.date, lastRedRun?.date].filter(Boolean).sort().pop();

  if (lastBone && diffDays(date, lastBone.date) < 7) {
    ampel = 'rot';
    why = `am ${fmtDate(lastBone.date)} ein Punkt am Knochen wehtat (7 Tage kein Laufen, keine Sprünge)`;
    ov.bone = true;
  } else if (redDate) {
    // Rot bleibt, bis 2 Check-Tage nach dem roten Tag grün sind
    const greenAfter = checks.filter((c) => c.date > redDate && c.date <= date && checkColor(c) === 'gruen').length;
    if (greenAfter < 2) {
      ampel = 'rot';
      why = `es am ${fmtDate(redDate)} rot war (Schmerz 5 oder mehr) – erst laufen, wenn 2 Morgen-Checks grün sind (${greenAfter} von 2)`;
    }
  }
  if (ampel === 'gruen') {
    const c = todayCheck || [...past(checks, 1)].reverse()[0];
    const col = checkColor(c);
    if (col === 'gelb') { ampel = 'gelb'; why = `der Morgen-Check ${c.date === date ? 'heute' : 'gestern'} gelb war (Schmerz 3–4)`; }
    if (col === 'rot') { ampel = 'rot'; why = 'der Morgen-Check rot war'; }
    const r = [...recentRuns].reverse().find((x) => runColor(x) !== 'gruen' && x.date < date);
    if (ampel === 'gruen' && r && runColor(r) === 'gelb' && diffDays(date, r.date) <= 2) {
      ampel = 'gelb'; why = `nach dem Lauf am ${fmtDate(r.date)} Schmerz ${r.pain} war und nicht schnell wegging`;
    }
    const rhr = past(checks, 7).filter((x) => x.rhr).map((x) => x.rhr);
    if (ampel === 'gruen' && rhr.length >= 3 && avg(rhr) >= 59) {
      ampel = 'gelb'; why = `dein Ruhepuls im 7-Tage-Schnitt ${Math.round(avg(rhr))} ist (ab 59 = müde)`;
    }
  }
  // krank
  const sick = [...past(checks, 3)].reverse().find((c) => c.sick);
  if (sick && sick.date === date) { ampel = ampel === 'gruen' ? 'gelb' : ampel; }

  if (ampel === 'rot') {
    ov.pause = true;
    ov.noJumps = true;
    ov.level1 = true;
    ov.runNote = 'Heute nicht laufen. Oberkörper und Rumpf sind okay.';
    ov.reasons.push(`Heute angepasst, weil ${why}.`);
  } else if (ampel === 'gelb') {
    ov.noJumps = true;
    ov.level1 = true;
    if (planned) {
      if (plannedKind === 'tempo') ov.workout = 'Locker (frei)';
      ov.runNote = 'Ein Drittel kürzer als sonst, flach, Puls nur bis 158.';
    }
    ov.reasons.push(`Heute angepasst, weil ${why}. Kraft heute in der leichteren Variante, keine Sprünge.`);
  }

  // Nach Rot: erster langer Lauf 2/3 (Knochen: die Hälfte)
  if (ampel !== 'rot' && planned && plannedKind === 'long' && redDate && diffDays(date, redDate) <= 21) {
    const longsAfter = runs.filter((r) => r.date > redDate && r.date < date && kindOf(r.workout) === 'long');
    if (!longsAfter.length) {
      const km = PLAN.workouts[planned].km;
      const boneCase = lastBone && lastBone.date >= redDate;
      const target = floorLong(boneCase ? km / 2 : (km * 2) / 3);
      ov.workout = longName(target);
      ov.reasons.push(`Erster langer Lauf nach der Pause: nur ${boneCase ? 'die Hälfte' : '2/3'} → „${longName(target)}“ auf der Uhr starten.`);
    }
  }

  // ---------- 2. Langer Lauf: Montag-Hocke + 10-%-Regel ----------
  if (planned && plannedKind === 'long' && !ov.workout && ampel !== 'rot') {
    let km = PLAN.workouts[planned].km;
    const mon = mondayOf(date);
    const monCheck = checks.find((c) => c.date === mon);
    const prevSun = addDays(date, -7);
    const prevPlanned = planWeek(prevSun) >= 1 ? plannedRun(prevSun) : null;
    const prevLongRun = runs.find((r) => r.date === prevSun && kindOf(r.workout) === 'long');
    const prevKm = prevLongRun && PLAN.workouts[prevLongRun.workout] ? PLAN.workouts[prevLongRun.workout].km : prevPlanned && kindOf(prevPlanned) === 'long' ? PLAN.workouts[prevPlanned].km : null;
    if (monCheck && monCheck.squat != null && monCheck.squat > 2 && prevKm && km > prevKm) {
      km = prevKm;
      ov.reasons.push(`Langer Lauf bleibt bei ${km} km, weil die Hocke am Montag nicht grün war.`);
    }
    const hasLong30 = runs.some((r) => kindOf(r.workout) === 'long' && r.distance_m && diffDays(date, r.date) > 0 && diffDays(date, r.date) <= 30);
    const l30 = hasLong30 ? longest30(runs, date) : null;
    if (l30 && km > l30 * 1.1) {
      const allowed = floorLong(l30 * 1.1);
      if (allowed < km) { km = allowed; ov.reasons.push(`10-%-Regel: dein längster Lauf in 30 Tagen war ${l30.toFixed(1)} km, darum heute höchstens „${longName(km)}“.`); }
    }
    if (longName(km) !== planned) ov.workout = longName(km);
  }

  // ---------- 3. Puls zu hoch bei locker/lang ----------
  const easyRuns = runs.filter((r) => r.date < date && ['easy', 'long'].includes(kindOf(r.workout)) && r.hr_avg);
  const lastTwo = easyRuns.slice(-2);
  if (lastTwo.length && lastTwo[lastTwo.length - 1].hr_avg > 164 && diffDays(date, lastTwo[lastTwo.length - 1].date) <= 7) {
    if (lastTwo.length === 2 && lastTwo.every((r) => r.hr_avg > 164)) {
      messages.push({ type: 'warn', text: `Zweimal hintereinander zu schnell (Ø-Puls ${lastTwo.map((r) => r.hr_avg).join(' und ')}). Locker heißt wirklich locker: bergauf gehen, langsamer starten. Nur so wird deine Ausdauer besser.` });
    } else {
      messages.push({ type: 'info', text: `Letzter lockerer Lauf etwas zu schnell (Ø-Puls ${lastTwo[lastTwo.length - 1].hr_avg}). Nächstes Mal bergauf gehen.` });
    }
  }

  // ---------- 4./5. Tempo-Läufe ----------
  const tempoRuns = runs.filter((r) => r.date < date && kindOf(r.workout) === 'tempo');
  const lastTempo = tempoRuns[tempoRuns.length - 1];
  if (planned && plannedKind === 'tempo' && !ov.workout && lastTempo && ((lastTempo.rpe ?? 0) >= 9 || ((lastTempo.pain ?? 0) >= 3 && lastTempo.pain_gone !== 'schnell'))) {
    const reps = PLAN.workouts[planned].reps;
    if (reps > 1) {
      ov.runNote = `Eine Wiederholung weniger: drück nach ${reps - 1} Runden Stopp und lauf aus.`;
      ov.reasons.push(`Heute eine Wiederholung weniger, weil der letzte Tempo-Lauf ${lastTempo.rpe >= 9 ? `sehr hart war (Gefühl ${lastTempo.rpe})` : `wehgetan hat (Schmerz ${lastTempo.pain})`}.`);
    }
  }
  const lt2 = tempoRuns.slice(-2);
  if (lt2.length === 2 && lt2.every((r) => r.rpe != null && r.rpe <= 5 && runColor(r) === 'gruen') && ampel === 'gruen' && diffDays(date, lt2[1].date) <= 7) {
    messages.push({ type: 'good', text: 'Stark! Die letzten zwei Tempo-Läufe waren leicht. Nächste Woche darfst du das letzte Stück etwas schneller laufen.' });
  }

  // ---------- 7. Tests ----------
  const tests = runs.filter((r) => r.date <= date && r.test_value && PLAN.workouts[r.workout]?.test);
  const hrp = tests.filter((r) => PLAN.workouts[r.workout].test === 'hrpace');
  if (hrp.length && diffDays(date, hrp[hrp.length - 1].date) <= 7) {
    const cur = parseTime(hrp[hrp.length - 1].test_value);
    const prev = hrp.length > 1 ? parseTime(hrp[hrp.length - 2].test_value) : null;
    if (cur && prev) {
      messages.push(cur < prev
        ? { type: 'good', text: `Deine Ausdauer wird besser (${fmtPace(prev)} → ${fmtPace(cur)} bei gleichem Puls).` }
        : { type: 'info', text: `Puls-Pace-Check: ${fmtPace(prev)} → ${fmtPace(cur)}. Gleich oder langsamer ist okay – Müdigkeit, Wind oder Kälte machen viel aus.` });
    } else if (cur) messages.push({ type: 'info', text: `Puls-Pace-Check gespeichert: ${fmtPace(cur)} min/km bei Puls 158–162. In Woche 8 vergleichen wir.` });
  }
  const thr = tests.filter((r) => PLAN.workouts[r.workout].test === 'threshold').pop();
  if (thr && diffDays(date, thr.date) <= 7) {
    const hr = Number(thr.test_value);
    if (hr <= 176 && (thr.rpe ?? 10) <= 7) messages.push({ type: 'good', text: `Schwellen-Check: Puls ${hr} am Ende und es ging leicht – deine Schwelle liegt eher höher. Nach dem 5-km-Test gibt es neue Zonen.` });
    else if (hr >= 185) messages.push({ type: 'info', text: `Schwellen-Check: Puls ${hr} – das war etwas zu schnell. Die Zonen bleiben.` });
    else if (hr) messages.push({ type: 'info', text: `Schwellen-Check: Puls ${hr} – passt zu deinen Zonen.` });
  }
  const t5 = tests.filter((r) => PLAN.workouts[r.workout].test === '5k').pop();
  if (t5) {
    const sec = parseTime(t5.test_value);
    if (sec && sec > 600 && sec < 3600) {
      const z = zonesFromVdot(vdot(sec));
      messages.push({ type: 'good', zones: z, text: `5-km-Test: ${t5.test_value} → VDOT ${z.vdot}. Neue Paces: locker ${z.locker}, zügig ${z.zuegig}, Schwelle ${z.schwelle}, schnell ${z.schnell} min/km.` });
    }
  }

  // ---------- Schwachstellen → gezieltes Krafttraining ----------
  const focus = weakSpots(date, runs, checks);
  if (focus.length) {
    const extras = [];
    for (const f of focus) {
      for (const area of AREAS[f.area].extras) {
        if (!extras.find((e) => e.area === area)) extras.push({ area, side: f.side, count: f.count >= 2 && area === f.area ? 2 : 1 });
      }
    }
    ov.extras = extras.slice(0, 4);
    const day = getDay(date);
    if (day.type === 'strength') {
      ov.reasons.push(focus.map((f) => `${f.side ? `Dein${f.side === 'rechte' ? ' rechtes' : ' linkes'} ` : 'Dein '}${AREAS[f.area].label} hat am ${fmtDate(f.last)} gezwickt${f.count > 1 ? ` (${f.count}× in 3 Wochen)` : ''}`).join('. ')
        + '. Darum heute Extra-Übungen dafür und 1 Satz mehr bei den passenden Übungen. So wird die Stelle stärker.');
    }
  }

  // ---------- Übungs-Feedback zu leicht / zu schwer ----------
  const exShift = {};
  const byEx = {};
  for (const f of [...feedback].filter((x) => x.date < date).sort((a, b) => a.date.localeCompare(b.date))) (byEx[f.ex_id] ||= []).push(f.value);
  for (const [ex, vals] of Object.entries(byEx)) {
    const last = vals.slice(-2);
    if (vals[vals.length - 1] === 'schwer') exShift[ex] = -1;
    else if (last.length === 2 && last.every((v) => v === 'leicht')) exShift[ex] = 1;
  }
  if (Object.keys(exShift).length) ov.exShift = exShift;

  // ---------- Manuelle Overrides (Verschieben, Claude) ----------
  for (const m of (data.manual || []).filter((x) => x.date === date)) {
    if (m.field === 'workout') ov.workout = m.value;
    if (m.field === 'pause') ov.pause = m.value === '1';
    if (m.field === 'moved') ov.moved = true;
    if (m.field === 'runNote') ov.runNote = m.value;
    if (m.field === 'swapTo') ov.swapTo = m.value;
    if (m.field === 'skip') ov.skip = true;
    if (m.reason) ov.reasons.push(m.reason);
  }

  return { ampel, overrides: ov, messages };
}

/** Stellen, die in den letzten 21 Tagen gezwickt haben (Lauf-Eintrag, Notiz oder Morgen-Check). */
export function weakSpots(date, runs = [], checks = []) {
  const hits = {};
  const add = (area, side, d) => {
    if (!AREAS[area]) return;
    const h = (hits[area] ||= { area, count: 0, side: null, last: d });
    h.count++;
    if (side) h.side = side;
    if (d >= h.last) h.last = d;
  };
  for (const r of runs) {
    if (r.date > date || diffDays(date, r.date) > 21) continue;
    const fromNote = parseNote(r.note || '');
    const side = sideWord(r.pain_side) || fromNote.side;
    if ((r.pain ?? 0) >= 2 && r.pain_where) for (const w of String(r.pain_where).split(',')) add(w.trim(), side, r.date);
    else if (fromNote.areas.length && /zwick|schmerz|weh|zieh|stech|drück/i.test(r.note || '')) for (const a of fromNote.areas) add(a, side, r.date);
  }
  for (const c of checks) {
    if (c.date > date || diffDays(date, c.date) > 21) continue;
    if ((c.squat ?? 0) >= 3) add('knie', null, c.date);
    if ((c.shin ?? 0) >= 3) add('schienbein', null, c.date);
  }
  return Object.values(hits).sort((a, b) => b.count - a.count);
}

/** Wochenbericht (Sonntag). */
export function weekReport(date, data, doneByDate = {}) {
  const mon = mondayOf(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  let planned = 0; let done = 0;
  for (const d of days) {
    const day = getDay(d);
    if (day.type === 'run' || day.type === 'strength') {
      planned++;
      const ids = doneByDate[d] || [];
      const ran = (data.runs || []).some((r) => r.date === d);
      if (ran || ids.length >= Math.max(1, Math.ceil(day.items.length / 2))) done++;
    }
  }
  const wr = (data.runs || []).filter((r) => r.date >= mon && r.date <= days[6]);
  const km = wr.reduce((s, r) => s + (r.distance_m || 0), 0) / 1000;
  const easy = wr.filter((r) => kindOf(r.workout) === 'easy' && r.hr_avg).map((r) => r.hr_avg);
  const longest = wr.reduce((m, r) => Math.max(m, (r.distance_m || 0) / 1000), 0);
  const amp = days.map((d) => checkColor((data.checks || []).find((c) => c.date === d)) || '–');
  const next = adjust(addDays(days[6], 1), data);
  const weekNo = planWeek(date);
  let coach = done >= 4 ? 'Woche geschafft! 💪 ' : `Diese Woche ${done} von ${planned}. Nicht nachholen – nächste Woche normal weiter. `;
  if (easy.length && avg(easy) > 164) coach += 'Die lockeren Läufe waren zu schnell, nächste Woche bewusst langsamer. ';
  const spots = weakSpots(days[6], data.runs, data.checks);
  if (spots.length) coach += `Fokus nächste Woche: ${spots.map((s) => AREAS[s.area].label).join(', ')} – dafür gibt es Extra-Übungen in Kraft A und B. `;
  if (weekNo >= 1 && weekNo < 12 && weekInfo(weekNo + 1).easy) coach += 'Nächste Woche ist eine leichte Woche: weniger, damit du stärker wirst.';
  return { week: weekNo, planned, done, km: Math.round(km * 10) / 10, easyHr: easy.length ? Math.round(avg(easy)) : null, longest: Math.round(longest * 10) / 10, ampel: amp, coach: coach.trim(), nextMessages: next.messages };
}
