import { spotStatus, spotNom } from './followup.js';
// Trainer-Logik: reine Funktionen, keine Datenbank.
// Eingabe: alle Daten (Checks, Läufe, Feedback, manuelle Overrides), Ausgabe: Anpassungen für ein Datum.
import { PLAN, getDay, addDays, diffDays, planWeek, weekInfo, weekday, mondayOf } from './plan.js';

export const AREAS = {
  knie: { label: 'Knie', extras: ['knie', 'huefte'] },
  schienbein: { label: 'Schienbein', extras: ['schienbein', 'wade'] },
  innenknoechel: { label: 'Innenknöchel', extras: ['innenknoechel', 'wade'] },
  aussenknoechel: { label: 'Außenknöchel', extras: ['aussenknoechel', 'wade'] },
  grosszehe: { label: 'Großzehe', extras: ['grosszehe'] },
  wade: { label: 'Wade', extras: ['wade'] },
  huefte: { label: 'Hüfte', extras: ['huefte'] },
  schulter: { label: 'Schulter', extras: ['schulter'] },
  ferse: { label: 'Ferse', extras: ['ferse', 'wade'] },
};

const KEYWORDS = [
  [/knie/i, 'knie'], [/schienbein|shin/i, 'schienbein'], [/au(ß|ss)en\S*\s*\S*\s*kn[öo]chel|kn[öo]chel.{0,40}au(ß|ss)en|umknick|umgeknickt/i, 'aussenknoechel'], [/innen\S*\s*\S*\s*kn[öo]chel|kn[öo]chel.{0,40}innen/i, 'innenknoechel'], [/kn[öo]chel|sprunggelenk/i, 'knoechel'],
  [/gro(ß|ss)\s?zeh|\bzeh(e|en)?\b/i, 'grosszehe'], [/ferse|achill/i, 'ferse'], [/wade/i, 'wade'], [/h[üu]fte|leiste|\bpo\b|ges[äa](ß|ss)/i, 'huefte'], [/schulter|nacken/i, 'schulter'],
];

/** Stelle(n) und Seite aus Freitext lesen, z. B. „rechtes Knie gezwickt“. */
export function parseNote(text = '') {
  const areas = [];
  for (const [re, a] of KEYWORDS) {
    if (!re.test(text) || areas.includes(a)) continue;
    if (a === 'knoechel') { if (!areas.includes('aussenknoechel') && !areas.includes('innenknoechel')) areas.push('innenknoechel'); continue; }
    areas.push(a);
  }
  let side = null;
  if (/\brecht(e|es|en|er|em|s)?\b/i.test(text)) side = 'rechte';
  else if (/\blink(e|es|en|er|em|s)?\b/i.test(text)) side = 'linke';
  return { areas, side };
}

/** „Ich kann laufen“, „alles normal“, „keine Pause“ … */
export function isOkNote(text = '') {
  const t = String(text);
  if (/nicht\s+(mehr\s+)?(normal|gut|ok)|kann\s+nicht/i.test(t) && !/keine\s+pause/i.test(t)) return false;
  return /kann\s+(wieder\s+|ganz\s+)?(normal\s+)?laufen|alles\s+(ist\s+)?(ganz\s+)?(normal|gut|ok|okay|fit)|keine\s+pause|mir\s+geht'?s?\s+(es\s+)?gut|\bbin\s+fit|(schmerz|es)\s+(ist\s+)?weg|tut\s+nicht(s)?\s+(mehr\s+)?weh|training\s+(heute\s+)?wieder\s+rein|mach\S*\s+(\S+\s+){0,3}wieder\s+rein/i.test(t);
}
/** Janis will selbst Pause. „Keine Pause“ zählt nicht. */
export function wantsPause(text = '') {
  const t = String(text);
  if (/kein(e)?\s+pause/i.test(t)) return false;
  return /(will|möchte|brauch\S*|mach\S*|lieber|nehm\S*)\s+(\S+\s+){0,3}(pause|ruhetag)\b|(will|möchte|kann)\s+(heute\s+)?nicht\s+laufen|\bkein\s+training\b/i.test(t);
}
/** Krank laut Nachricht. */
export function isSickNote(text = '') {
  const t = String(text);
  if (/nicht\s+(krank|erkältet)/i.test(t)) return false;
  return /\b(bin|fühl\S*\s+mich|werde)\s+(\S+\s+){0,2}(krank|erkältet)|\bfieber\b|\bgrippe\b|halsschmerz|magen-?darm/i.test(t);
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
  if (r.pain >= 5) return 'rot';
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

  // Grundsatz: anpassen statt absagen. Abgesagt wird nur bei echtem Grund
  // (krank, Schmerz ≥ 5, Hinken, Punkt am Knochen – frisch gemeldet) oder wenn Janis selbst Pause will.
  // Schreibt Janis danach „kann laufen“ / „alles normal“, gilt das: dann nur leichter.
  const notes = (data.athleteNotes || []).filter((n) => n.date <= date && diffDays(date, n.date) <= 2);
  const okAfter = (d, at) => notes.some((n) => isOkNote(n.text) && (n.date > d || (n.date === d && (!at || !n.created_at || n.created_at > at))));
  const todayNotes = notes.filter((n) => n.date === date);
  const lastNoteOf = (fn) => [...todayNotes].reverse().find((n) => fn(n.text) || isOkNote(n.text));
  const wantsPauseNote = lastNoteOf(wantsPause);
  const sickNote = lastNoteOf(isSickNote);
  const wantsPauseToday = !!wantsPauseNote && wantsPause(wantsPauseNote.text);
  const sickToday = !!sickNote && isSickNote(sickNote.text);

  const lastBone = [...past(checks, 30)].reverse().find((c) => c.bone);
  const lastRed = [...recentChecks].reverse().find((c) => checkColor(c) === 'rot');
  const lastRedRun = [...past(runs, 14)].reverse().find((r) => runColor(r) === 'rot');
  const redDate = [lastRed?.date, lastRedRun?.date].filter(Boolean).sort().pop();

  // Frischer roter Check (heute, sonst gestern) oder roter Lauf gestern/heute = echter Grund
  const freshCheck = todayCheck || [...past(checks, 1)].reverse()[0];
  const freshRun = [...past(runs, 1)].reverse().find((r) => runColor(r) === 'rot' && r.pain_gone !== 'schnell');
  const newerCheckAfterRun = freshRun && checks.some((c) => c.date > freshRun.date && c.date <= date && checkColor(c) !== 'rot');
  let hard = null;
  if (freshCheck && checkColor(freshCheck) === 'rot' && !okAfter(freshCheck.date, freshCheck.created_at)) {
    hard = freshCheck.bone ? `ein Punkt am Knochen wehtut (Check vom ${fmtDate(freshCheck.date)})`
      : freshCheck.limp ? `du gehinkt hast (Check vom ${fmtDate(freshCheck.date)})`
        : `der Check vom ${fmtDate(freshCheck.date)} Schmerz 5 oder mehr hatte`;
  } else if (freshRun && !newerCheckAfterRun && !okAfter(freshRun.date, freshRun.created_at)) {
    hard = `beim Lauf am ${fmtDate(freshRun.date)} Schmerz ${freshRun.pain} war`;
  }

  // Nach einem Knochenpunkt: 7 Tage (und bis 5 Checks ohne Knochenschmerz) nur leicht – nicht absagen
  const okAfterBone = lastBone ? checks.filter((c) => c.date > lastBone.date && c.date <= date && !c.bone).length : 0;
  const boneRecent = lastBone && (diffDays(date, lastBone.date) < 7 || okAfterBone < 5) && diffDays(date, lastBone.date) <= 21;
  if (hard) {
    ampel = 'rot';
    why = hard;
  } else if (boneRecent) {
    ampel = 'gelb';
    why = `am ${fmtDate(lastBone.date)} ein Punkt am Knochen wehtat. Bis 7 Tage um sind und 5 Checks ohne Knochenschmerz da sind (bisher ${okAfterBone}), läufst du nur locker`;
  } else if (redDate) {
    // Nach Rot: leichter, bis 2 Check-Tage nach dem roten Tag grün sind
    const greenAfter = checks.filter((c) => c.date > redDate && c.date <= date && checkColor(c) === 'gruen').length;
    if (greenAfter < 2) {
      ampel = 'gelb';
      why = `es am ${fmtDate(redDate)} rot war (Schmerz 5 oder mehr). Bis 2 Morgen-Checks grün sind (${greenAfter} von 2), läufst du nur locker`;
    }
  }
  if (lastBone && diffDays(date, lastBone.date) <= 7) {
    ov.bone = true;
    messages.push({ type: 'warn', text: `Punkt am Knochen: Drück ${getDay(date).type === 'run' ? 'vor dem Lauf ' : ''}mit dem Finger auf die Stelle. Tut ein Punkt richtig weh, ${getDay(date).type === 'run' ? 'lauf heute nicht' : 'lass Laufen und Sprünge weg'} und sag es deinen Eltern – das sollte sich ein Arzt anschauen.` });
  }
  if (ampel === 'gruen') {
    const c = freshCheck;
    const col = checkColor(c);
    if (col === 'gelb' || col === 'rot') { ampel = 'gelb'; why = `der Morgen-Check ${c.date === date ? 'heute' : 'gestern'} ${col === 'rot' ? 'Schmerz zeigte, du aber laufen kannst' : 'gelb war (Schmerz 3–4)'}`; }
    const r = [...recentRuns].reverse().find((x) => runColor(x) !== 'gruen' && x.date < date);
    if (ampel === 'gruen' && r && runColor(r) === 'gelb' && diffDays(date, r.date) <= 2) {
      ampel = 'gelb'; why = `nach dem Lauf am ${fmtDate(r.date)} Schmerz ${r.pain} war und nicht schnell wegging`;
    }
    const rhrAll = [...past(checks, 30).filter((x) => x.rhr).map((x) => ({ date: x.date, v: x.rhr })), ...(data.wellness || []).filter((w) => w.rhr && w.date <= date && diffDays(date, w.date) <= 30).map((w) => ({ date: w.date, v: w.rhr }))];
    if (ampel === 'gruen' && rhrAll.length >= 7) {
      const sorted = rhrAll.map((x) => x.v).sort((a, b) => a - b);
      const base = sorted[Math.floor(sorted.length / 2)];
      const todayRhr = rhrAll.filter((x) => x.date === date).map((x) => x.v).pop();
      const last5 = rhrAll.filter((x) => diffDays(date, x.date) <= 4).map((x) => x.v);
      if ((todayRhr && todayRhr >= base + 7) || last5.filter((v) => v >= base + 5).length >= 3) {
        ampel = 'gelb'; why = `dein Ruhepuls höher ist als sonst (normal ${base}). Du bist vielleicht müde oder wirst krank`;
      }
    }
    // Schlaf und HRV (wenn vorhanden): 1 Signal = kein Tempo, 2 Signale = gelb
    const w = (data.wellness || []).find((x) => x.date === date);
    const sig = [];
    if (w?.sleep_min && w.sleep_min < 420) sig.push(`nur ${Math.floor(w.sleep_min / 60)} h ${w.sleep_min % 60} min geschlafen`);
    if (w?.hrv && w?.hrv_base && w.hrv < w.hrv_base * 0.85) sig.push('deine Erholung (HRV) niedrig ist');
    if (ampel === 'gruen' && sig.length >= 2) { ampel = 'gelb'; why = `du ${sig.join(' und ')}`; }
    else if (sig.length === 1) ov.lowSleep = sig[0];
    const sleep7 = (data.wellness || []).filter((x) => x.sleep_min && x.date <= date && diffDays(date, x.date) < 7).map((x) => x.sleep_min);
    if (sleep7.length >= 4 && avg(sleep7) < 480) messages.push({ type: 'info', text: `Du schläfst im Schnitt ${(avg(sleep7) / 60).toFixed(1)} h. Mit 14 brauchst du 8–10 h – Schlaf macht dich schneller und schützt vor Verletzungen.` });
  }
  // krank
  const sick = [...past(checks, 3)].reverse().find((c) => c.sick);
  if ((sick && diffDays(date, sick.date) <= 1 && !okAfter(sick.date, sick.created_at)) || sickToday) { ampel = 'rot'; why = 'du krank bist – erst wenn du 1 Tag ohne Beschwerden bist, wieder locker laufen'; }
  if (wantsPauseToday) { ampel = 'rot'; why = 'du heute Pause willst. Das ist okay'; }

  if (ampel === 'rot') {
    ov.pause = true;
    ov.noJumps = true;
    ov.level1 = true;
    ov.runNote = 'Heute nicht laufen. Oberkörper und Bauch darfst du trainieren.';
    ov.reasons.push(`Heute angepasst, weil ${why}.`);
  } else if (ampel === 'gelb') {
    ov.noJumps = true;
    ov.level1 = true;
    if (planned) {
      if (plannedKind === 'tempo') ov.workout = 'Locker (frei)';
      ov.runNote = plannedKind === 'long' && redDate && diffDays(date, redDate) <= 21
        ? 'Lauf flach und locker. Halte den Puls unter 158.'
        : 'Lauf heute ein Drittel kürzer als sonst. Lauf flach. Halte den Puls unter 158.';
    }
    ov.reasons.push(`Heute angepasst, weil ${why}. Mach die Kraft heute leichter und ohne Sprünge.`);
  }

  if (ampel === 'gruen' && ov.lowSleep && planned && plannedKind === 'tempo') {
    ov.workout = 'Locker (frei)';
    ov.reasons.push(`Heute locker statt Tempo, weil du ${ov.lowSleep} hast.`);
  }
  delete ov.lowSleep;

  // Nach Rot: erster langer Lauf 2/3 (Knochen: die Hälfte)
  if (ampel !== 'rot' && planned && plannedKind === 'long' && redDate && diffDays(date, redDate) <= 21) {
    const longsAfter = runs.filter((r) => r.date > redDate && r.date < date && kindOf(r.workout) === 'long');
    if (!longsAfter.length) {
      const km = PLAN.workouts[planned].km;
      const boneCase = lastBone && lastBone.date >= redDate;
      const target = floorLong(boneCase ? km / 2 : (km * 2) / 3);
      ov.workout = longName(target);
      ov.reasons.push(`Erster langer Lauf nach der Pause: nur ${boneCase ? 'die Hälfte' : '2/3'} so lang. Starte auf der Uhr „${longName(target)}“.`);
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
    const l30 = longest30(runs, date);
    let shortRun = null;
    if (l30 && km > l30 * 1.1) {
      const maxKm = l30 * 1.1;
      if (maxKm >= 9) {
        const allowed = floorLong(maxKm);
        if (allowed < km) { km = allowed; ov.reasons.push(`Dein längster Lauf in 30 Tagen war ${l30.toFixed(1)} km. Du darfst nur 10 % länger laufen. Darum heute höchstens „${longName(km)}“.`); }
      } else {
        shortRun = Math.floor(maxKm);
        ov.workout = 'Locker (frei)';
        ov.runNote = `Lauf heute locker ${shortRun} km, nicht mehr. Starte auf der Uhr „Locker (frei)“.`;
        ov.reasons.push(`10-%-Regel: dein längster Lauf in 30 Tagen war ${l30.toFixed(1)} km. Mehr als ${shortRun} km wären zu viel auf einmal.`);
      }
    }
    if (!shortRun && longName(km) !== planned) ov.workout = longName(km);
  }

  // ---------- 3. Puls zu hoch bei locker/lang ----------
  const easyRuns = runs.filter((r) => r.date < date && ['easy', 'long'].includes(kindOf(r.workout)) && r.hr_avg);
  const lastTwo = easyRuns.slice(-2);
  if (lastTwo.length && lastTwo[lastTwo.length - 1].hr_avg > 164 && diffDays(date, lastTwo[lastTwo.length - 1].date) <= 7) {
    if (lastTwo.length === 2 && lastTwo.every((r) => r.hr_avg > 164)) {
      messages.push({ type: 'warn', text: `Zweimal hintereinander zu schnell (Puls im Schnitt ${lastTwo.map((r) => r.hr_avg).join(' und ')}). Locker heißt: Du kannst noch reden. Geh bergauf und starte langsamer. Nur so wird deine Ausdauer besser.` });
    } else {
      messages.push({ type: 'info', text: `Dein letzter lockerer Lauf war etwas zu schnell (Puls im Schnitt ${lastTwo[lastTwo.length - 1].hr_avg}). Geh nächstes Mal bergauf.` });
    }
  }

  // ---------- 4./5. Tempo-Läufe ----------
  const tempoRuns = runs.filter((r) => r.date < date && kindOf(r.workout) === 'tempo');
  const lastTempo = tempoRuns[tempoRuns.length - 1];
  if (planned && plannedKind === 'tempo' && !ov.workout && lastTempo && ((lastTempo.rpe ?? 0) >= 9 || ((lastTempo.pain ?? 0) >= 3 && lastTempo.pain_gone !== 'schnell'))) {
    const reps = PLAN.workouts[planned].reps;
    if (reps > 1) {
      ov.runNote = `Heute ein schnelles Stück weniger: Drück nach ${reps - 1} Stücken Stopp und lauf aus.`;
      ov.reasons.push(`Heute ein schnelles Stück weniger, weil der letzte Tempo-Lauf ${lastTempo.rpe >= 9 ? `sehr hart war (Gefühl ${lastTempo.rpe})` : `wehgetan hat (Schmerz ${lastTempo.pain})`}.`);
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
    if (hr <= 176 && (thr.rpe ?? 10) <= 7) messages.push({ type: 'good', text: `Schwellen-Check: Puls ${hr} am Ende, und es ging leicht. Du bist wohl fitter als gedacht. Nach dem 5-km-Test bekommst du neue Tempo-Werte.` });
    else if (hr >= 185) messages.push({ type: 'info', text: `Schwellen-Check: Puls ${hr} – das war etwas zu schnell. Deine Werte bleiben gleich.` });
    else if (hr) messages.push({ type: 'info', text: `Schwellen-Check: Puls ${hr} – passt genau zu deinen Werten.` });
  }
  const t5 = tests.filter((r) => PLAN.workouts[r.workout].test === '5k').pop();
  if (t5) {
    const sec = parseTime(t5.test_value);
    if (sec && sec > 600 && sec < 3600) {
      const z = zonesFromVdot(vdot(sec));
      messages.push({ type: 'good', zones: z, text: `5-km-Test: ${t5.test_value} → Fitness-Wert (VDOT) ${z.vdot}. Dein neues Tempo in min pro km: locker ${z.locker}, zügig ${z.zuegig}, Schwelle ${z.schwelle}, schnell ${z.schnell}.` });
    }
  }

  // ---------- Schwachstellen → gezieltes Krafttraining ----------
  const status = spotStatus(date, weakSpots(date, runs, checks, data.athleteNotes || [], data.spotChecks || []), data.spotChecks || []);
  // „weg“ gemeldet: noch 7 Tage Vorbeugung, dann fällt die Stelle raus
  const focus = status.filter((f) => !(f.closed && f.closedDays > 7));
  const dayType = getDay(date).type;
  for (const f of status) {
    if (f.worse && ['schienbein', 'knie', 'innenknoechel', 'aussenknoechel', 'wade', 'grosszehe'].includes(f.area) && dayType === 'run' && !ov.pause) {
      ov.runNote = 'Lauf heute nur locker und flach, höchstens 30 min. Tut es beim Laufen mehr als 3 von 10 weh? Dann geh sofort.';
      ov.reasons.push(`Du hast gesagt, ${spotNom(f.area, f.side)} ist schlimmer geworden. Darum heute vorsichtig.`);
    }
    if (!f.closed && f.since >= 7 && ['gleich', 'schlimmer'].includes(f.lastAnswer)) {
      messages.push({ type: 'warn', text: `${spotNom(f.area, f.side).replace(/^d/, 'D')} ist seit über einer Woche nicht besser. Sag es bitte deinen Eltern. Vielleicht solltest du zum Arzt oder Physio.` });
    }
  }
  if (focus.length) {
    const extras = [];
    for (const f of focus) {
      for (const area of AREAS[f.area].extras) {
        const since = f.first ? diffDays(date, f.first) : 0;
        let level = since >= 14 ? 3 : since >= 7 ? 2 : 1;
        if (ampel === 'rot' || ['gleich', 'schlimmer'].includes(f.lastAnswer)) level = 1;
        if (!extras.find((e) => e.area === area)) extras.push({ area, side: f.side, count: f.count >= 2 && area === f.area ? 2 : 1, level });
      }
    }
    ov.extras = extras.slice(0, 4);
    {
      ov.extraReasons = ov.extraReasons || [];
      ov.extraReasons.push(focus.map((f) => `${f.side ? `Dein${f.side === 'rechte' ? ' rechtes' : ' linkes'} ` : 'Dein '}${AREAS[f.area].label} hat am ${fmtDate(f.last)} gezwickt${f.count > 1 ? ` (${f.count}× in 3 Wochen)` : ''}`).join('. ')
        + '. Darum machst du heute Extra-Übungen dafür. Bei passenden Übungen machst du 1 Satz mehr. So wird die Stelle stärker.');
    }
  }

  // ---------- Plan von Claude (Coach-Routine) ----------
  const isStrengthDay = getDay(date).type === 'strength';
  for (const c of data.coachPlan || []) {
    let d;
    try { d = typeof c.data === 'string' ? JSON.parse(c.data) : c.data; } catch { continue; }
    if (c.kind === 'focus' && c.date <= date && diffDays(date, c.date) <= (d.days || 7)) {
      ov.extras = ov.extras || [];
      for (const a of d.areas || []) {
        if (AREAS[a.area] || PLAN.extraExercises[a.area]) {
          const ex = ov.extras.find((e) => e.area === a.area);
          if (ex) ex.count = Math.max(ex.count, a.count || 1);
          else ov.extras.push({ area: a.area, side: sideWord(a.side) || null, count: a.count || 1, level: ampel === 'rot' ? 1 : diffDays(date, c.date) >= 7 ? 2 : 1 });
        }
      }
      ov.extras = ov.extras.slice(0, 5);
      if (d.reason) (ov.extraReasons ||= []).push(`Coach: ${d.reason}`);
    }
    if (c.date !== date) continue;
    if (c.kind === 'run') {
      if (d.workout && PLAN.workouts[d.workout]) ov.workout = d.workout;
      if (d.runNote) ov.runNote = d.runNote;
      // Coach darf nur bei echtem Grund absagen, sonst wird es ein leichter Lauf
      if (d.pause && (hard || ov.pause)) ov.pause = true;
      else if (d.pause && planned && !okAfter(date)) {
        if (!d.workout && plannedKind !== 'easy') ov.workout = 'Locker (frei)';
        if (!d.runNote) ov.runNote = 'Lauf heute nur locker und flach, höchstens 30 min. Tut es beim Laufen mehr als 3 von 10 weh? Dann geh nach Hause.';
      }
      if (d.reason) ov.reasons.push(`Coach: ${d.reason}`);
    }
    if (c.kind === 'strength') {
      if (d.exShift) ov.exShiftCoach = d.exShift;
      if (d.reason) ov.reasons.push(`Coach: ${d.reason}`);
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
  Object.assign(exShift, ov.exShiftCoach || {});
  delete ov.exShiftCoach;
  if (Object.keys(exShift).length) ov.exShift = exShift;

  // ---------- Manuelle Overrides (Verschieben, Claude) ----------
  for (const m of (data.manual || []).filter((x) => x.date === date)) {
    if (m.field === 'workout') ov.workout = m.value;
    if (m.field === 'pause') ov.pause = m.value === '1';
    if (m.field === 'moved') ov.moved = true;
    if (m.field === 'addSession') { try { ov.addSession = JSON.parse(m.value); } catch { /* alt */ } }
    if (m.field === 'addRun' && PLAN.workouts[m.value]) ov.addRun = m.value;
    if (m.field === 'runNote') ov.runNote = m.value;
    if (m.field === 'swapTo') ov.swapTo = m.value;
    if (m.field === 'skip') ov.skip = true;
    if (m.reason) ov.reasons.push(m.reason);
  }

  return { ampel, overrides: ov, messages };
}

/** Stellen, die in den letzten 21 Tagen gezwickt haben (Lauf-Eintrag, Notiz oder Morgen-Check). */
export function weakSpots(date, runs = [], checks = [], notes = [], spotChecks = []) {
  const hits = {};
  const add = (area, side, d) => {
    if (!AREAS[area]) return;
    const h = (hits[area] ||= { area, count: 0, side: null, last: d, first: d });
    h.count++;
    if (side) h.side = side;
    if (d >= h.last) h.last = d;
    if (d < h.first) h.first = d;
  };
  for (const r of runs) {
    if (r.date > date || diffDays(date, r.date) > 21) continue;
    const fromNote = parseNote(r.note || '');
    const side = sideWord(r.pain_side) || fromNote.side;
    const known = r.pain_where ? String(r.pain_where).split(',').map((w) => w.trim()).filter((w) => AREAS[w]) : [];
    if ((r.pain ?? 0) >= 2 && known.length) for (const w of known) add(w, side, r.date);
    else if (fromNote.areas.length && ((r.pain ?? 0) >= 2 || /zwick|schmerz|weh|zieh|stech|drück|komisch/i.test(r.note || ''))) for (const a of fromNote.areas) add(a, side, r.date);
  }
  for (const n of notes) {
    if (n.date > date || diffDays(date, n.date) > 21) continue;
    const pn = parseNote(n.text || '');
    if (pn.areas.length && /zwick|schmerz|weh|zieh|stech|drück|komisch|instabil|knick|fest|hart/i.test(n.text || '')) for (const a of pn.areas) add(a, pn.side, n.date);
  }
  for (const c of checks) {
    if (c.date > date || diffDays(date, c.date) > 21) continue;
    if ((c.squat ?? 0) >= 3) add('knie', null, c.date);
    if ((c.shin ?? 0) >= 3) add('schienbein', null, c.date);
  }
  // Antworten auf die Nachfrage: „schlimmer“ zählt wie eine neue Meldung, „gleich“ hält die Stelle aktiv
  for (const c of spotChecks) {
    if (c.date > date || diffDays(date, c.date) > 21 || !hits[c.area]) continue;
    if (c.answer === 'schlimmer') add(c.area, null, c.date);
    else if (c.answer === 'gleich' && c.date > hits[c.area].last) hits[c.area].last = c.date;
  }
  return Object.values(hits).sort((a, b) => b.count - a.count);
}

/** Wochenbericht (Sonntag). */
export function weekReport(date, data, doneByDate = {}) {
  const mon = mondayOf(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  let planned = 0; let done = 0;
  for (const d of days) {
    const day = getDay(d, { overrides: adjust(d, data).overrides });
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
  let coach = done >= 4 ? 'Woche geschafft! 💪 ' : `Diese Woche ${done} von ${planned}. Hol nichts nach. Mach nächste Woche normal weiter. `;
  if (easy.length && avg(easy) > 164) coach += 'Die lockeren Läufe waren zu schnell, nächste Woche bewusst langsamer. ';
  const spots = weakSpots(days[6], data.runs, data.checks);
  if (spots.length) coach += `Fokus nächste Woche: ${spots.map((s) => AREAS[s.area].label).join(', ')} – dafür gibt es Extra-Übungen in Kraft A und B. `;
  if (weekNo >= 1 && weekNo < 12 && weekInfo(weekNo + 1).easy) coach += 'Nächste Woche ist leichter. In der Pause wird dein Körper stärker.';
  return { week: weekNo, planned, done, km: Math.round(km * 10) / 10, easyHr: easy.length ? Math.round(avg(easy)) : null, longest: Math.round(longest * 10) / 10, ampel: amp, coach: coach.trim(), nextMessages: next.messages };
}
