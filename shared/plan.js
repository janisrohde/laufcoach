// Gemeinsame Plan-Logik für App und Worker.
// Alle Datumswerte sind Strings "JJJJ-MM-TT" in Europe/Berlin.
import PLAN from '../src/data/plan.json' with { type: 'json' };

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
    perSide: !!dose.perSide,
    fp: !!dose.fp,
    shift,
  };
  if (shift > 0) item.shiftNote = 'Du fandest das zweimal zu leicht – darum jetzt die nächste Stufe.';
  if (shift < 0) item.shiftNote = 'Du fandest das zu schwer – darum jetzt die leichtere Stufe.';
  if (ctx.probe) item.doseText = `Probe: ${probeText(dose.text)}`;
  return item;
}

/** „2×15 beidbeinig“ → „1×15 beidbeinig“, „2 Runden: …“ → „1 Runde: …“ */
export function probeText(t) {
  return t.replace(/^\d\s?×\s?/, '1× ').replace(/^\d Runden/, '1 Runde').replace(/^1× (\d)/, '1×$1');
}

const SPOT_DE = {
  'Gluteus Medius': 'Po seitlich oben (Gluteus Medius): seitlich auf den Ball legen, Stelle zwischen Hüftknochen und Po',
  Waden: 'Waden auf Ball oder Rolle',
  Innenwade: 'Innenwade auf dem Ball',
  'Fußsohle': 'Fußsohle im Stehen auf dem Ball',
};

function midweekSpots(week) {
  const f = fpPlanFor(week);
  if (!f) return null;
  if (f.midweek) return f.midweek;
  if (f.fpWeek) return PLAN.fp.weeks[String(f.fpWeek)].midweek;
  return null;
}

/** Kraft-Einheit zusammenbauen. */
export function strengthSession(key, week, ctx = {}) {
  const def = PLAN.strength[key];
  const prefix = key === 'A' ? 'kraftA' : 'kraftB';
  const fpFree = ctx.fpFree ?? expectedFpWeek(week);
  const c = { ...ctx, fpFree };
  let items = def.exercises.map((ex) => buildExercise(ex, week, c, prefix)).filter(Boolean);
  const spots = midweekSpots(week);
  if (spots && items[0] && items[0].exId.endsWith('0')) {
    items[0] = {
      ...items[0],
      name: items[0].name.replace(/\((\d+) min\)/, (_, m) => `(ca. ${Number(m) + 4} min)`),
      steps: [...items[0].steps, `Functional Patterns diese Woche: ${spots.map((s) => SPOT_DE[s] || s).join(' · ')} – je Seite 1 min. Nicht direkt hinter dem Innenknöchel und nicht auf der Schienbeinkante.`],
    };
  }
  if (ctx.mini) {
    items = items.filter((it) => def.mini.includes(it.exId)).map((it) => (it.exId.endsWith('0') ? it : { ...it, sets: Math.min(it.sets, 2) }));
  }
  // Schwachstellen-Extras (vom Coach): zusätzliche Übungen für betroffene Stellen
  for (const ext of ctx.extras || []) {
    const list = PLAN.extraExercises[ext.area] || [];
    for (const x of list.slice(0, ext.count || 1)) {
      items.push({
        id: `${prefix}:${x.id}`, kind: 'exercise', exId: x.id, extra: true, area: ext.area, side: ext.side || null,
        name: x.name, why: x.why, start: x.start, steps: x.steps, watch: x.watch, mistake: x.mistake, tool: x.tool, focus: [ext.area],
        doseText: ext.side ? `${x.dose.text} – betroffene Seite: ${ext.side}` : x.dose.text,
        sets: x.dose.sets, hold: x.dose.hold || null, weight: x.dose.weight, perSide: !!x.dose.perSide, fp: false,
      });
    }
  }
  // Extra-Satz auf der betroffenen Seite bei passenden Übungen
  for (const ext of ctx.extras || []) {
    items = items.map((it) => (!it.extra && !it.extraSet && it.focus.includes(ext.area) && !it.exId.endsWith('0') && !ctx.mini
      ? { ...it, extraSet: ext.side && it.perSide ? `+1 Satz extra auf der ${ext.side}n Seite` : '+1 Satz extra', sets: it.sets + 1 }
      : it));
  }
  return { title: def.title, minutes: ctx.probe ? 15 : ctx.mini ? 15 : def.minutes, general: def.general, items };
}

function fpMonday(week, fpFree) {
  const f = fpPlanFor(week);
  if (!f) return null;
  const fpWeekNo = f.fpWeek && f.fpWeek <= fpFree ? f.fpWeek : null;
  const fpw = fpWeekNo ? PLAN.fp.weeks[String(fpWeekNo)] : null;
  const lessons = fpw ? fpw.lessons.map((l) => ({
    id: `fp:${l.id}`, kind: 'lesson', lessonId: l.id, name: l.name, mode: l.mode, how: l.how,
    url: PLAN.fp.lessonUrl + l.id,
  })) : [];
  return {
    fpWeek: fpWeekNo,
    title: fpw ? fpw.title : 'Wiederholung',
    goal: fpw ? fpw.goal : null,
    tools: fpw ? fpw.tools : 'Ball, Rolle',
    text: fpWeekNo || !f.fpWeek ? f.monday : `Die FP-Woche ${f.fpWeek} ist bei dir noch nicht frei. Mach diese Woche einfach die aktuelle Woche weiter oder wiederhole Woche 2–3. Kein Stress.`,
    shopping: f.shopping || null,
    weekUrl: PLAN.fp.classUrl + (fpWeekNo || Math.max(2, Math.min(fpFree, 10))),
    lessons,
  };
}

function runItems(date, workoutName, week, ctx) {
  const w = PLAN.workouts[workoutName];
  const items = [];
  items.push({ id: 'run:check', kind: 'check', name: 'Morgen-Check (30 s)', hop: w.kind !== 'easy', questions: PLAN.rules.morningCheck });
  items.push({ id: 'run:watch', kind: 'watch', name: `Auf der Uhr starten: ${workoutName}`, workout: workoutName, summary: w.summary, steps: w.steps, howto: PLAN.runCards[w.kind] });
  if (w.kind === 'long' && week >= 7 && (ctx.fpFree ?? expectedFpWeek(week)) >= 7) {
    items.push({ id: 'run:stretch', kind: 'exercise', exId: 'PCS', name: 'Posterior Chain Stretch (FP)', why: 'Beinrückseite nach dem langen Lauf entspannen.', start: 'Nach dem Lauf, stehend oder auf der Matte.', steps: ['So wie im Kurs Woche 7 gezeigt.', 'Ruhig atmen.', '2 min insgesamt.'], watch: 'Nur angenehm ziehen.', mistake: 'Wippen.', tool: 'Matte', focus: [], doseText: '2 min', sets: 1, hold: 120, weight: 'ohne Gewicht' });
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
      case 1: type = 'fp'; title = 'Ruhetag + Functional Patterns'; break;
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
    return { ...base, type: 'rest', title: 'Auf morgen verschoben', minutes: 0, note: 'Heute frei – das Training ist auf morgen verschoben.', items: [], adjusted: true };
  }
  if (type === 'strength' && ov.pause) {
    // Rot: nur Oberkörper und Rumpf
    const s = strengthSession('B', Math.max(week, 0), { fpFree, level1: true, noJumps: true });
    const items = s.items.filter((it) => ['B0', 'B4', 'B5', 'B6'].includes(it.exId));
    return { ...base, type: 'strength', strengthKey: 'B', title: 'Nur Oberkörper und Rumpf', minutes: 20, note: 'Beine haben heute Pause. Oberkörper und Rumpf sind okay.', items, general: s.general, adjusted: true, hasMini: false };
  }
  if (type === 'run' && ov.pause) {
    return { ...base, type: 'rest', title: 'Heute kein Lauf – Pause', minutes: 0, plannedWorkout: workout, note: ov.runNote || 'Heute nicht laufen. Oberkörper und Rumpf sind okay.', items: [], adjusted: true };
  }
  if (type === 'run' && ov.workout && PLAN.workouts[ov.workout]) {
    base.plannedWorkout = workout; workout = ov.workout; base.adjusted = true;
  }

  let items = []; let minutes = 0; let extra = {};
  if (type === 'run') {
    title = title || workout;
    items = runItems(date, workout, week, { fpFree });
    minutes = PLAN.workouts[workout].kind === 'long' ? PLAN.workouts[workout].km * 6.5 : 50;
    extra.runKind = PLAN.workouts[workout].kind;
    if (ov.runNote) note = ov.runNote;
    if (ov.workout === 'Locker (frei)' && base.plannedWorkout && PLAN.workouts[base.plannedWorkout].kind === 'tempo') note = (note ? note + ' ' : '') + `Auf der Uhr „Locker (frei)“ starten statt „${base.plannedWorkout}“.`;
    if (week >= 1 && week <= 12 && wd === 0 && fpFree >= 7 && week >= 7) extra.postRunFp = true;
  } else if (type === 'strength') {
    const s = strengthSession(strengthKey, Math.max(week, 0), { fpFree, probe, mini: ctx.mini, level1: ov.level1, noJumps: ov.noJumps, extras: ov.extras, exShift: ov.exShift });
    title = probe ? title : s.title; minutes = s.minutes; items = s.items; extra.general = s.general; extra.strengthKey = strengthKey;
    if (strengthKey === 'B' && week >= 11 && week <= 12) extra.general += ' Woche 11–12: Du darfst bei Übung 4–6 auch deine Lieblings-FP-Übungen aus Woche 5–10 nehmen (z. B. One Arm Row, The Press, Plank with Hip Extension).';
    extra.hasMini = !probe;
  } else if (type === 'fp') {
    const fp = fpMonday(week, fpFree);
    extra.fp = fp; items = fp ? fp.lessons : []; minutes = 25;
  } else {
    title = title || 'Ruhetag';
    note = note || PLAN.runCards.rest;
    if (wd === 6 && week >= 1 && week <= 12) {
      extra.optional = 'Freiwillig (10–15 min): Follow-Along-Video der FP-Woche abspielen und nur die „Machen“-Stellen mitmachen.';
    }
  }
  if (week === 4) extra.dailyReminder = 'Heute 1 min Standing Neutral, z. B. beim Zähneputzen.';
  if (week === 8 && wd === 1) extra.shopping = PLAN.fp.byPlanWeek['8'].shopping;

  return { ...base, type, title, workout, minutes: Math.round(minutes), note, items, ...extra };
}

export function getDay(date, ctx = {}) {
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
  if (day.type === 'fp') return `Heute Ruhetag + FP-Mini${day.fp && day.fp.fpWeek ? ` (Woche ${day.fp.fpWeek})` : ''}`;
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
  if (day.type === 'fp') return 'Morgen: FP-Tag. Ball und Rolle bereitlegen.';
  return 'Morgen: Ruhetag.';
}
