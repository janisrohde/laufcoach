// Gemeinsame Plan-Logik für App und Worker.
// Alle Datumswerte sind Strings "JJJJ-MM-TT" in Europe/Berlin.
import PLAN from '../src/data/plan.json' with { type: 'json' };
import { SESSION_MAX_MIN } from './config.js';

export { PLAN };

const DAY_MS = 86400000;
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Heutiges Datum (oder das von `d`) in Europe/Berlin als JJJJ-MM-TT. */
export function berlinDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Uhrzeit in Europe/Berlin: { hour, minute }. */
export function berlinTime(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  return { hour: Number(parts.find((p) => p.type === 'hour').value), minute: Number(parts.find((p) => p.type === 'minute').value) };
}

const toUTC = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (s, n) => fromUTC(toUTC(s) + n * DAY_MS);
export const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / DAY_MS);
/** 0 = Sonntag … 6 = Samstag */
export const weekday = (s) => new Date(toUTC(s)).getUTCDay();
export const mondayOf = (s) => addDays(s, -((weekday(s) + 6) % 7));

export function formatLong(s) {
  const d = new Date(toUTC(s));
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]}`;
}
export const weekdayName = (s) => WEEKDAYS[weekday(s)];

/** Planwoche: -1 = vor Woche 0, 0 = Woche 0, 1–12 Plan, 13+ nach dem Plan. */
export function planWeek(s) {
  if (s < PLAN.week0Start) return -1;
  if (s < PLAN.planStart) return 0;
  return Math.floor(diffDays(s, PLAN.planStart) / 7) + 1;
}

export function weekInfo(n) {
  if (n < 1) return { n, level: 1, easy: false };
  if (n > 12) return { n, level: 3, easy: true, recovery: true };
  return PLAN.weeks[n - 1];
}

/** Welche FP-Woche laut Plan in Planwoche n dran ist (null = Wiederholung). */
export function fpPlanFor(n) {
  return PLAN.fp.byPlanWeek[String(n)] || null;
}

/** Höchste FP-Woche, die laut Plan bis Planwoche n frei sein sollte. */
export function expectedFpWeek(n) {
  let max = 1;
  for (let i = 1; i <= Math.min(n, 12); i++) {
    const f = fpPlanFor(i);
    if (f && f.fpWeek) max = Math.max(max, f.fpWeek);
  }
  return max;
}

/** Passende Dosis für eine Übung in Woche n. */
export function pickDose(ex, week, { fpFree = 10, level1 = false } = {}) {
  const wk = level1 ? Math.min(week, 4) : week;
  let chosen = null;
  for (const d of ex.dose) {
    if (d.from > wk) continue;
    if (d.fp && d.fp > fpFree) continue;
    chosen = d;
  }
  return chosen;
}

function buildExercise(ex, week, ctx, prefix) {
  if (ex.fromWeek && week < ex.fromWeek) return null;
  if (ex.untilWeek && week > ex.untilWeek) return null;
  if (ex.jumps && (week < 5 || weekInfo(week).easy || ctx.noJumps)) return null;
  const shift = (ctx.exShift && ctx.exShift[ex.id]) || 0;
  const wkEx = shift ? Math.max(0, Math.min(12, week + shift * 4)) : week;
  const dose = pickDose(ex, wkEx, { fpFree: ctx.fpFree, level1: ctx.level1 && shift <= 0 });
  if (!dose) return null;
  const v = dose.variant || {};
  const item = {
    id: `${prefix}:${ex.id}`,
    kind: 'exercise',
    exId: ex.id,
    name: v.name || ex.name,
    why: ex.why,
    start: v.start || ex.start,
    steps: v.steps || ex.steps,
    watch: v.watch || ex.watch,
    mistake: v.mistake || ex.mistake,
    tool: v.tool || ex.tool,
    focus: ex.focus || [],
    doseText: dose.text,
    sets: ctx.probe ? 1 : dose.sets,
    hold: dose.holds ? dose.holds[0] : dose.hold || null,
    holds: dose.holds || null,
    weight: dose.weight || 'ohne Gewicht',
    reps: dose.reps || null,
    easier: v.easier || ex.easier || null,
    careful: v.careful || ex.careful || null,
    blockSides: !!ex.blockSides,
    perSide: !!dose.perSide,
    fp: !!dose.fp,
    shift,
  };
  if (shift > 0) item.shiftNote = 'Das war dir zweimal zu leicht. Darum kommt jetzt die schwerere Stufe.';
  if (shift < 0) item.shiftNote = 'Das war dir zu schwer. Darum kommt jetzt die leichtere Stufe.';
  if (ctx.probe) item.doseText = `Probe: ${probeText(dose.text)}`;
  return item;
}

/** „2×15 beidbeinig“ → „1×15 beidbeinig“, „2 Runden: …“ → „1 Runde: …“ */
export function probeText(t) {
  return t.replace(/^\d\s?×\s?/, '1× ').replace(/^\d Runden/, '1 Runde').replace(/^1× (\d)/, '1×$1');
}

/** Kraft-Einheit zusammenbauen. */
export function strengthSession(key, week, ctx = {}) {
  const def = PLAN.strength[key];
  const prefix = key === 'A' ? 'kraftA' : 'kraftB';
  const fpFree = ctx.fpFree ?? expectedFpWeek(week);
  const c = { ...ctx, fpFree };
  let items = def.exercises.map((ex) => buildExercise(ex, week, c, prefix)).filter(Boolean);
  // 18.11.: Kein Ball-Rollen mehr im Aufwärmen an Kraft-Tagen (war unverständlich, kostet Zeit, macht nicht stärker).
  // Die Rollen-Stellen gibt es am Montag beim Lockern.
  if (ctx.mini) {
    items = items.filter((it) => def.mini.includes(it.exId)).map((it) => (it.exId.endsWith('0') ? it : { ...it, sets: Math.min(it.sets, 2) }));
  }
  const rules = PLAN.extraRules || {};
  // Grundprogramm zu lang (ab Woche 5)? Erst Sätze bei weniger wichtigen Übungen kürzen, dann weniger wichtige weglassen.
  if (!ctx.mini && !ctx.probe) items = trimToLimit(items, (rules.trimOrder || {})[key] || [], rules.baseMaxMin ?? 55);
  const extras = ctx.extras || [];
  const pref = (rules.sessionAreas || {})[key] || [];
  const rank = (area) => (pref.includes(area) ? pref.indexOf(area) : 99);
  // Pro Bereich zählt der höchste Wert (nie die Summe), wichtigste Bereiche zuerst
  const merged = [];
  for (const e of extras) {
    const m = merged.find((x) => x.area === e.area);
    if (m) { m.count = Math.max(m.count || 1, e.count || 1); m.level = Math.max(m.level || 1, e.level || 1); m.side = m.side || e.side; } else merged.push({ ...e });
  }
  const ordered = merged.sort((a, b) => rank(a.area) - rank(b.area));
  if (!ctx.mini && !ctx.probe) {
    // 1) Erst die Hauptübung des Bereichs um 1 Satz verlängern (höchstens 2× pro Einheit, 1× pro Übung)
    const main = (rules.mainExercise || {})[key] || {};
    let extraSets = 0;
    const setAreas = new Set();
    for (const ext of ordered) {
      if (extraSets >= (rules.maxExtraSets ?? 2)) break;
      const id = main[ext.area];
      const i = items.findIndex((it) => it.exId === id && !it.extraSet);
      if (i < 0) continue;
      const tryIt = items.map((it, k) => (k === i ? addExtraSet(it, ext.side) : it));
      if (sessionMinutes(tryIt) > SESSION_MAX_MIN) continue;
      items = tryIt;
      extraSets++;
      // Wade/Ferse: Extra-Übung wäre an derselben Stufe → dann nur der Extra-Satz
      if (['wade', 'ferse'].includes(ext.area)) setAreas.add(ext.area);
    }
    // 2) Dann höchstens 2 Extra-Übungen, nur aus Bereichen dieses Tages und nur solange die Einheit ≤ 50 min bleibt
    const queue = [];
    for (let round = 0; round < 3; round++) {
      for (const ext of ordered) {
        // Ein Bereich bekommt entweder 1 Satz mehr bei der Hauptübung ODER eine Extra-Übung (nicht beides, z. B. nicht 2× Wade)
        if (round >= (ext.count || 1) || !pref.includes(ext.area) || setAreas.has(ext.area)) continue;
        const x0 = (PLAN.extraExercises[ext.area] || [])[round];
        if (x0) queue.push({ x0, ext });
      }
    }
    let added = 0;
    for (const { x0, ext } of queue) {
      if (added >= (rules.maxPerSession ?? 2)) break;
      if (items.some((it) => it.exId === x0.id || it.name === x0.name)) continue;
      const lv = Math.max(1, Math.min(3, ext.level || 1));
      const dose = (lv > 1 && x0.levels && x0.levels[lv - 2]) || x0.dose;
      const x = { ...x0, dose };
      const item = { level: lv,
        id: `${prefix}:${x.id}`, kind: 'exercise', exId: x.id, extra: true, area: ext.area, side: normSide(ext.side),
        name: x.name, why: x.why, start: x.start, steps: x.steps, watch: x.watch, mistake: x.mistake, tool: x.tool, easier: x.easier || null, focus: [ext.area],
        doseText: x.dose.text, cue: x.cue || null, blockSides: !!x.blockSides,
        sets: x.dose.sets, hold: x.dose.hold || null, reps: x.dose.reps || null, weight: x.dose.weight, perSide: !!x.dose.perSide, fp: false,
      };
      // Betroffene Seite zuerst; 1 Satz mehr nur, solange die Grenze (2 pro Einheit) nicht erreicht ist
      if (item.side && item.perSide && extraSets < (rules.maxExtraSets ?? 2)) item.extraSide = item.side;
      if (sessionMinutes([...items, item]) > (rules.extrasUntilMin ?? 50)) continue;
      if (item.extraSide) extraSets++;
      // Direkt hinter die Grundübung mit dem gleichen Gerät/Bereich, sonst ans Ende
      const mainId = ((rules.mainExercise || {})[key] || {})[ext.area];
      const at = items.findIndex((it) => it.exId === mainId);
      if (at >= 0) items.splice(at + 1, 0, item); else items.push(item);
      added++;
    }
  }
  items = items.map((it) => ({ ...it, setList: setList(it), seconds: exerciseSeconds(it) }));
  const minutes = ctx.probe ? 15 : sessionMinutes(items);
  return { title: def.title, minutes, general: def.general, items };
}

/** Einheit auf höchstens `limit` Minuten bringen, ohne Pausen zu streichen. */
function trimToLimit(items, order, limit) {
  let out = items;
  for (const id of order) {
    if (sessionMinutes(out) <= limit) return out;
    out = out.map((it) => (it.exId === id && it.sets >= 3 ? { ...it, sets: it.sets - 1, doseText: setCountText(it.doseText, it.sets - 1), trimmed: true } : it));
  }
  for (const id of order) {
    if (sessionMinutes(out) <= limit) return out;
    out = out.filter((it) => it.exId !== id);
  }
  return out;
}

const normSide = (s) => (!s ? null : /^r/i.test(s) ? 'rechts' : /^l/i.test(s) ? 'links' : null);

/** 1 Satz mehr: bei Seiten-Übungen nur auf der betroffenen Seite, sonst +1 Satz. */
function addExtraSet(it, side) {
  const s = normSide(side);
  if (it.perSide && s) return { ...it, extraSide: s, extraSet: `${s === 'rechts' ? 'Rechts' : 'Links'} 1 Satz mehr`, doseText: `${it.doseText}, ${s} 1 Satz mehr` };
  if (it.holds || it.perSide) return { ...it, sets: it.sets + 1, extraSet: '1 Satz mehr', extraLast: true, doseText: setCountText(it.doseText, it.sets + 1) };
  return { ...it, sets: it.sets + 1, extraSet: '1 Satz mehr', extraLast: true, doseText: setCountText(it.doseText, it.sets + 1) };
}
/** „2×15 beidbeinig“ → „3×15 beidbeinig“ */
const setCountText = (t, n) => String(t).replace(/^(\D*?)(\d+)\s?×/, (_, a) => `${a}${n}×`).replace(/^(\d+) Runden/, `${n} Runden`);

/** Wiederholungen oder Haltezeit pro Satz als kurzer Text: „15×“, „30 s“. */
export function repsOf(it) {
  if (it.holds) return it.holds.map((h) => `${h} s`).join(' + ');
  if (it.hold) return it.hold >= 90 ? `${Math.round(it.hold / 60)} min` : `${it.hold} s`;
  if (it.reps) return it.reps;
  const m = String(it.doseText || '').match(/\d+\s?×\s?(\d+(?:–\d+)?)(\s*(Schritte|Runden))?/);
  if (m) return m[3] ? `${m[1]} ${m[3]}` : `${m[1]}×`;
  return '';
}

/**
 * Sätze einzeln zum Abhaken, in genau der Reihenfolge.
 * Je Seite: betroffene Seite zuerst (sonst rechts), dann die andere = 1 Satz. Danach Pause.
 * Betroffene Seite bekommt bei extraSide am Ende 1 Satz mehr.
 */
export function setList(it) {
  if (it.exId?.endsWith('0') && !it.extra) return [];
  const reps = repsOf(it);
  const n = it.sets || 1;
  const out = [];
  const PAUSE = pauseOf(it);
  const R = PLAN.extraRules || {};
  const SWITCH = R.switchSec ?? 15;
  const PAIR = R.pairPauseSec ?? 15;
  if (it.perSide && !it.holds) {
    const first = it.extraSide || it.side || 'rechts';
    const second = first === 'rechts' ? 'links' : 'rechts';
    const cap = (x) => x[0].toUpperCase() + x.slice(1);
    const nFirst = n + (it.extraSide ? 1 : 0);
    const lab = (side, k, extra) => `${cap(side)} – Satz ${k}${extra ? ' (extra)' : ''} – ${reps}`;
    if (it.blockSides) {
      // Band am Tischbein: erst alle Sätze einer Seite, dann einmal umbauen
      for (let k = 1; k <= nFirst; k++) out.push({ side: first, set: k, label: lab(first, k, k > n), hold: it.hold || null, pause: k < nFirst ? PAUSE : 0 });
      out[out.length - 1].pause = R.switchSec ?? 15;
      out[out.length - 1].switchSide = true;
      for (let k = 1; k <= n; k++) out.push({ side: second, set: k, label: lab(second, k, false), hold: it.hold || null, pause: k < n ? PAUSE : 0 });
    } else {
      for (let k = 1; k <= n; k++) {
        out.push({ side: first, set: k, label: lab(first, k, false), hold: it.hold || null, pause: it.hold ? 0 : 0, switchSec: SWITCH });
        out.push({ side: second, set: k, label: lab(second, k, false), hold: it.hold || null, pause: PAIR });
      }
      if (it.extraSide) out.push({ side: first, set: n + 1, label: lab(first, n + 1, true), hold: it.hold || null, pause: 0 });
    }
  } else {
    for (let k = 1; k <= n; k++) out.push({ side: null, set: k, label: `Satz ${k} von ${n}${it.extraLast && k === n ? ' (extra)' : ''} – ${reps}`, hold: it.holds ? null : it.hold || null, holds: it.holds || null, pause: PAUSE });
  }
  if (out.length) out[out.length - 1].pause = 0;
  return out;
}

/** Pause zwischen zwei Sätzen: 60 s für Wade/Oberschenkel, sonst 45 s (oder aus plan.json). */
export function pauseOf(it) {
  const R = PLAN.extraRules || {};
  if (it.pauseSec) return it.pauseSec;
  const light = /stehen|Einbein|Zehe|Fußspitzen|Fuß nach|Gleichgewicht|Muschel|Stern/i.test(it.name) || (it.focus || []).every((f) => ['fuss', 'grosszehe', 'innenknoechel', 'aussenknoechel', 'schienbein'].includes(f));
  return light ? (R.pauseLightSec ?? 45) : (R.pauseHeavySec ?? 60);
}
/** Aufbauzeit: Band am Tischbein 90 s, Matte/Stufe 60 s, sonst 30 s. */
function setupOf(it) {
  const t = String(it.tool || '');
  return /Tischbein|Türanker|Klimmzug/.test(t) ? 90 : /Matte|Stufe|Band|Stuhl|Buch/.test(t) ? 60 : 30;
}

/** Geschätzte echte Dauer einer Übung in Sekunden (inkl. Aufbau, Seitenwechsel, Pausen). */
export function exerciseSeconds(it) {
  const R = PLAN.extraRules || {};
  if (it.exId?.endsWith('0') && !it.extra) {
    const m = String(it.name).match(/(\d+)\s*min/);
    return (m ? Number(m[1]) : R.warmupMin ?? 6) * 60;
  }
  const list = it.setList || setList(it);
  const text = `${it.doseText} ${(it.steps || []).join(' ')}`;
  const slow = /in [34] s|langsam/.test(text);
  const perRep = /Schritte|je Richtung/.test(it.doseText) ? 2 : /Runden/.test(it.doseText) ? 20 : slow ? (R.secPerRepSlow ?? 5) : (R.secPerRep ?? 4);
  let total = setupOf(it);
  for (const st of list) {
    let work;
    if (st.holds) work = st.holds.reduce((a, b) => a + b, 0) + 10 * (st.holds.length - 1);
    else if (/Runden/.test(it.doseText) && !st.hold) work = 60;
    else if (st.hold) work = st.hold;
    else {
      const m = String(st.label).match(/(\d+)(?:–(\d+))?(×| Schritte| Runden)/);
      const reps = m ? Number(m[2] || m[1]) : 10;
      work = reps * perRep * (/je Richtung/.test(it.doseText) ? 2 : 1);
    }
    total += work + (st.pause || 0) + (st.switchSec || 0);
  }
  return Math.round(total);
}

/** Minuten einer ganzen Einheit (gerundet auf 5). */
export function sessionMinutes(items) {
  const s = items.filter((it) => it.kind === 'exercise').reduce((a, it) => a + exerciseSeconds(it), 0);
  return Math.ceil(s / 60 / 5) * 5;
}

function fpMonday(week, fpFree, ov = {}) {
  const f = fpPlanFor(week);
  if (!f) return null;
  // Einfacher FP-Montag: feste Lockern-Runde (deutsch, mit Zeit, Werkzeug, Wozu) + höchstens 2 neue Übungen.
  // Die Kurs-Videos (Englisch) sind freiwillig und zählen nicht zum Abhaken.
  const fpWeekNo = f.fpWeek || null;
  const fpw = fpWeekNo ? PLAN.fp.weeks[String(fpWeekNo)] : null;
  // Schienbein-Beschwerden oder Knochenpunkt: keine Innenwade
  const shin = ov.bone || (ov.extras || []).some((e) => e.area === 'schienbein');
  const stations = (f.stations || []).filter((k) => !(shin && k === 'innenwade')).map((k) => ({ id: `fp:st:${k}`, kind: 'lesson', station: k, mode: 'machen', ...PLAN.fp.stations[k] }));
  const neu = (f.neu || []).map((n) => ({ id: `fp:${n.id}`, kind: 'lesson', lessonId: n.id, mode: 'neu', ...n, url: PLAN.fp.lessonUrl + n.id }));
  const videos = fpw ? fpw.lessons.map((l) => ({ lessonId: l.id, name: l.name, mode: l.mode, how: l.how, url: PLAN.fp.lessonUrl + l.id })) : [];
  return {
    fpWeek: fpWeekNo,
    locked: !!(fpWeekNo && fpWeekNo > fpFree),
    title: fpw ? fpw.title : 'Wiederholung',
    goal: fpw ? fpw.goal : null,
    tools: [...new Set([...stations, ...neu].flatMap((s) => String(s.tool || '').split(/\s*\(|\)/)[0]).filter((t) => t && t !== 'nichts'))].join(', ') || 'nichts',
    text: shin && (f.stations || []).includes('innenwade') ? f.monday.replace('Innenwade, ', '') : f.monday,
    minutes: f.minutes || 12,
    shopping: f.shopping || null,
    weekUrl: PLAN.fp.classUrl + (fpWeekNo || Math.max(2, Math.min(fpFree, 10))),
    lessons: [...stations, ...neu],
    videos,
  };
}

function runItems(date, workoutName, week, ctx) {
  const w = PLAN.workouts[workoutName];
  const items = [];
  items.push({ id: 'run:check', kind: 'check', name: 'Morgen-Check (30 s)', hop: w.kind !== 'easy', questions: PLAN.rules.morningCheck });
  items.push({ id: 'run:watch', kind: 'watch', name: `Auf der Uhr starten: ${workoutName}`, workout: workoutName, summary: w.summary, steps: w.steps, howto: PLAN.runCards[w.kind] });
  if (w.kind === 'long' && week >= 7 && (ctx.fpFree ?? expectedFpWeek(week)) >= 7) {
    items.push({ id: 'run:stretch', kind: 'exercise', exId: 'PCS', name: 'Beinrückseite dehnen', why: 'Entspannt die Rückseite der Beine nach dem langen Lauf.', start: 'Direkt nach dem Lauf. Im Stehen oder auf der Matte.', steps: ['Ein Bein gestreckt vor dich auf die Ferse stellen.', 'Mit geradem Rücken aus der Hüfte nach vorne beugen.', 'Ruhig atmen, je Bein 1 min.'], watch: 'Nur angenehm ziehen.', mistake: 'Wippen.', tool: 'Matte', focus: [], doseText: '2 min', sets: 1, hold: 120, weight: 'ohne Gewicht' });
  }
  items.push({ id: 'run:log', kind: 'runlog', name: 'Nach dem Lauf eintragen', workout: workoutName, test: w.test || null, testLabel: w.testLabel || null });
  return items;
}

/**
 * Inhalt eines Tages.
 * ctx: { fpFree, overrides: {workout, pause, level1, noJumps, extras, runNote, reason[]}, mini }
 */
function getDayBase(date, ctx = {}) {
  const week = planWeek(date);
  const info = weekInfo(week);
  const wd = weekday(date);
  const ov = ctx.overrides || {};
  const fpFree = ctx.fpFree ?? expectedFpWeek(Math.max(week, 1));
  const base = { date, week, level: info.level, easy: !!info.easy, weekday: wd, label: formatLong(date), reasons: ov.reasons || [], fpFree };

  if (week < 0) return { ...base, type: 'before', title: 'Noch nicht gestartet', minutes: 0, items: [] };

  let type; let workout = null; let title; let note = null; let probe = false; let strengthKey = null;

  if (week === 0) {
    const d = PLAN.week0[date];
    title = d.title; note = d.note || null;
    if (d.type === 'run') { type = 'run'; workout = d.workout; }
    else if (d.type === 'strengthA') { type = 'strength'; strengthKey = 'A'; probe = !!d.probe; }
    else type = 'rest';
  } else if (week > 12) {
    const t = PLAN.recovery.days[String(wd)];
    if (t === 'easy') { type = 'run'; workout = 'Locker (frei)'; title = 'Locker 30–40 min'; note = PLAN.recovery.easyNote; }
    else if (t === 'strengthA') { type = 'strength'; strengthKey = 'A'; }
    else if (t === 'strengthB') { type = 'strength'; strengthKey = 'B'; }
    else { type = 'rest'; title = 'Ruhetag'; }
    base.recovery = true;
  } else {
    switch (wd) {
      case 1: type = 'fp'; title = 'Ruhetag + Lockern'; break;
      case 2: type = 'run'; workout = info.tue; break;
      case 3: type = 'strength'; strengthKey = 'A'; break;
      case 4: type = 'run'; workout = info.thu; break;
      case 5: type = 'strength'; strengthKey = 'B'; break;
      case 6: type = 'rest'; title = 'Ruhetag'; break;
      default: type = 'run'; workout = info.sun;
    }
  }

  // Anpassungen vom Coach
  if (ov.moved && (type === 'run' || type === 'strength')) {
    return { ...base, type: 'rest', title: 'Auf morgen verschoben', minutes: 0, note: 'Heute frei. Dein Training ist morgen.', items: [], adjusted: true };
  }
  if (type === 'strength' && ov.pause) {
    // Rot: nur Oberkörper und Rumpf
    const s = strengthSession('B', Math.max(week, 0), { fpFree, level1: true, noJumps: true });
    const items = s.items.filter((it) => ['B0', 'B4', 'B5', 'B6'].includes(it.exId));
    return { ...base, type: 'strength', strengthKey: 'B', title: 'Nur Oberkörper und Rumpf', minutes: 20, note: 'Deine Beine haben heute Pause. Oberkörper und Bauch darfst du trainieren.', items, general: s.general, adjusted: true, hasMini: false };
  }
  if (type === 'run' && ov.pause) {
    return { ...base, type: 'rest', title: 'Heute kein Lauf – Pause', minutes: 0, plannedWorkout: workout, note: ov.runNote || 'Heute nicht laufen. Oberkörper und Bauch darfst du trainieren.', items: [], adjusted: true };
  }
  if (type === 'run' && ov.workout && PLAN.workouts[ov.workout] && ov.workout !== workout) {
    base.plannedWorkout = workout; workout = ov.workout; base.adjusted = true;
  }

  let items = []; let minutes = 0; let extra = {};
  if (type === 'run') {
    title = title || workout;
    items = runItems(date, workout, week, { fpFree });
    minutes = PLAN.workouts[workout].kind === 'long' ? PLAN.workouts[workout].km * 6.5 : 50;
    extra.runKind = PLAN.workouts[workout].kind;
    if (ov.runNote) note = ov.runNote;
    if (ov.workout === 'Locker (frei)' && base.plannedWorkout && PLAN.workouts[base.plannedWorkout].kind === 'tempo') note = (note ? note + ' ' : '') + `Starte auf der Uhr „Locker (frei)“, nicht „${base.plannedWorkout}“.`;
    if (week >= 1 && week <= 12 && wd === 0 && fpFree >= 7 && week >= 7) extra.postRunFp = true;
  } else if (type === 'strength') {
    const s = strengthSession(strengthKey, Math.max(week, 0), { fpFree, probe, mini: ctx.mini, level1: ov.level1, noJumps: ov.noJumps, extras: ov.extras, exShift: ov.exShift });
    title = probe ? title : s.title; minutes = s.minutes; items = s.items; extra.general = s.general; extra.strengthKey = strengthKey;
    if (strengthKey === 'B' && week >= 11 && week <= 12) extra.general += ' Woche 11–12: Bei Übung 4–6 darfst du auch deine liebsten FP-Übungen aus Woche 5–10 nehmen. Zum Beispiel One Arm Row, The Press oder Plank with Hip Extension.';
    extra.hasMini = !probe;
  } else if (type === 'fp') {
    const fp = fpMonday(week, fpFree, ov);
    extra.fp = fp; items = fp ? fp.lessons : []; minutes = fp?.minutes || 12;
  } else {
    title = title || 'Ruhetag';
    note = note || PLAN.runCards.rest;
    if (wd === 6 && week >= 1 && week <= 12) {
      extra.optional = 'Freiwillig (10 min): Roll deine 2 Lieblingsstellen vom Montag.';
    }
  }
  if (week === 4) extra.dailyReminder = 'Heute 1 min gerade stehen, z. B. beim Zähneputzen.';
  if (week === 8 && wd === 1) extra.shopping = PLAN.fp.byPlanWeek['8'].shopping;

  return { ...base, type, title, workout, minutes: Math.round(minutes), note, items, ...extra };
}

const CHECK_ITEM = () => ({ id: 'day:check', kind: 'check', name: 'Morgen-Check (30 s)', hop: false, questions: PLAN.rules.morningCheck });

export function getDay(date, ctx = {}) {
  let d = withSession(date, ctx);
  const ov = ctx.overrides || {};
  if (d.type === 'before') return d;
  // Verschobener Lauf
  if (ov.addRun && PLAN.workouts[ov.addRun]) {
    const run = runItems(date, ov.addRun, Math.max(d.week, 0), { fpFree: d.fpFree });
    if (d.type === 'rest' || d.type === 'fp') {
      d = { ...d, type: 'run', workout: ov.addRun, title: `${ov.addRun} (verschoben)`, items: run, runKind: PLAN.workouts[ov.addRun].kind, minutes: 50, adjusted: true, note: null };
    } else if (d.type === 'strength') {
      d = { ...d, workout: ov.addRun, runKind: PLAN.workouts[ov.addRun].kind, items: [...run.filter((i) => i.kind !== 'check').map((i) => ({ ...i, id: i.id === 'run:watch' || i.id === 'run:log' ? i.id : `plus:${i.id}` })), { id: 'plus:section', kind: 'section', name: 'Danach: Krafttraining' }, ...d.items], minutes: d.minutes + 50, adjusted: true };
    }
  }
  // Morgen-Check jeden Tag (für Ampel, Montags-Hocke, Rückkehr nach Rot)
  if (!d.items.some((i) => i.kind === 'check')) d = { ...d, items: [CHECK_ITEM(), ...d.items] };
  // Gründe für Extra-Übungen nur, wenn heute wirklich welche drin sind
  if (ov.extraReasons?.length && d.items.some((i) => i.extra || i.extraSet)) d = { ...d, reasons: [...d.reasons, ...ov.extraReasons.map((r, i) => (i === 0 ? r : r))] };
  return d;
}

function withSession(date, ctx = {}) {
  const d = getDayBase(date, ctx);
  const ov = ctx.overrides || {};
  const add = ov.addSession;
  if (!add || d.type === 'before' || !PLAN.strength[add.key]) return d;
  const s = strengthSession(add.key, Math.max(d.week, 0), { fpFree: d.fpFree, probe: add.probe, level1: ov.level1, noJumps: ov.noJumps, extras: ov.extras, exShift: ov.exShift });
  const title = add.probe ? 'Kraft-A-Probe' : s.title;
  if (d.type === 'rest') {
    return { ...d, type: 'strength', strengthKey: add.key, title: `${title} (verschoben)`, minutes: add.probe ? 15 : s.minutes, items: s.items, general: s.general, hasMini: false, adjusted: true, note: null };
  }
  const extraItems = s.items.map((it) => ({ ...it, id: `plus:${it.id}` }));
  return { ...d, items: [...d.items, { id: 'plus:section', kind: 'section', name: `Dazu heute: ${title} (von gestern verschoben)`, general: s.general }, ...extraItems], minutes: d.minutes + (add.probe ? 15 : s.minutes), adjusted: true };
}

/** Zählt, ob eine Einheit als „Training“ zählt (für 4 von 5). */
export const isTrainingDay = (day) => day.type === 'run' || day.type === 'strength';

/** Woche ab Montag (7 Tage). */
export function getWeek(date, ctxFor = () => ({})) {
  const mon = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(mon, i);
    return getDay(d, ctxFor(d));
  });
}

/** Text für die Morgen-Benachrichtigung. */
export function morningText(day) {
  if (day.type === 'run') return `Heute: ${day.workout} auf der Uhr starten 🏃`;
  if (day.type === 'strength') return `Heute: ${day.title} – ${day.items.length} Übungen, ${day.minutes} min 💪`;
  if (day.type === 'fp') return `Heute Ruhetag + ${day.fp?.minutes || 12} min Lockern`;
  if (day.type === 'before') return '';
  return 'Heute Ruhetag. Pause macht dich schneller.';
}

/** Text für die Vorschau am Abend (auf morgen). */
export function previewText(day) {
  if (day.type === 'run') {
    const k = PLAN.workouts[day.workout].kind;
    if (k === 'tempo') return `Morgen: ${day.workout}. Uhr laden, Stirnlampe bereitlegen.`;
    if (k === 'long') return `Morgen: ${day.workout}. Uhr laden, Trinken bereitstellen.`;
    return `Morgen: ${day.workout}. Uhr laden.`;
  }
  if (day.type === 'strength') return `Morgen: ${day.title}. Band, Ball und Hanteln bereitlegen.`;
  if (day.type === 'fp') return 'Morgen: Ruhetag + Lockern. Ball und Rolle bereitlegen.';
  return 'Morgen: Ruhetag.';
}
