// Tests zum Auftrag vom 18.11.2026: Uhrzeiten, Dauer, Sätze, Übungstexte, keine veralteten Hinweise.
import { describe, it, expect } from 'vitest';
import { getDay, addDays, PLAN, setList, sessionMinutes } from '../shared/plan.js';
import { adjust } from '../shared/coach.js';
import { nextCoachRound, replyPromise, coachHours, COACH_HOURS_UTC } from '../shared/config.js';

const at = (iso) => new Date(iso);

describe('Uhrzeiten kommen aus shared/config.js', () => {
  it('Routine-Zeiten im Winter: 7, 10, 13, 18, 20, 22 Uhr', () => {
    expect(coachHours(at('2026-11-18T12:00:00Z'))).toEqual([7, 10, 13, 18, 20, 22]);
    expect(COACH_HOURS_UTC).toEqual([6, 9, 12, 17, 19, 21]);
  });
  it('20:24 Uhr → nächste Antwort 22:05, nicht „morgen 7 Uhr“', () => {
    expect(replyPromise(at('2026-11-18T19:24:00Z'))).toBe('Danke! Claude antwortet dir um 22:05 Uhr – schau dann hier in der App.');
  });
  it('19:04 Uhr → 20:05', () => expect(nextCoachRound(at('2026-11-18T18:04:00Z')).text).toBe('20:05'));
  it('nach 22:05 → morgen 07:05', () => {
    const n = nextCoachRound(at('2026-11-18T21:30:00Z'));
    expect(n.tomorrow).toBe(true);
    expect(n.text).toBe('07:05');
  });
  it('Sofort-Antwort ist genau ein Satz ohne Übungsliste', () => {
    const t = replyPromise(at('2026-11-18T10:00:00Z'));
    expect(t.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length).toBeLessThanOrEqual(2);
    expect(t).not.toMatch(/Extra-Übungen/);
  });
  it('App und Worker benutzen keine fest eingetippten Uhrzeiten mehr', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['src/main.js', 'worker/src/index.js']) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/\[7, 10, 13, 18, 20, 22\]/);
      expect(src).not.toMatch(/um 7, 10, 13, 18, 20 und 22 Uhr/);
    }
  });
});

// Alle Tage der 12 Wochen, mit kräftigen Beschwerden (wie am 18.11.), damit viele Extras kommen
const heavy = {
  coachPlan: [
    { date: '2026-11-14', kind: 'focus', data: JSON.stringify({ areas: [{ area: 'knie', count: 2 }, { area: 'schienbein', side: 'rechts', count: 1 }, { area: 'aussenknoechel', side: 'rechts', count: 1 }], days: 7 }) },
    { date: '2026-11-17', kind: 'focus', data: JSON.stringify({ areas: [{ area: 'wade', count: 2 }, { area: 'schienbein', side: 'rechts', count: 1 }, { area: 'knie', count: 1 }], days: 7 }) },
  ],
  runs: [{ date: '2026-11-17', workout: 'Di Steigerungen', rpe: 5, pain: 3, pain_where: 'knie', pain_side: 'rechts', pain_gone: 'schnell' }],
  athleteNotes: [], checks: [], spotChecks: [], feedback: [], manual: [], wellness: [],
};
const allDays = () => { const out = []; for (let d = PLAN.planStart; d < PLAN.planEndExclusive; d = addDays(d, 1)) out.push(d); return out; };
const dayWith = (d, data = {}) => getDay(d, { overrides: adjust(d, data).overrides });

describe('Dauer: höchstens 60 min an allen Tagen', () => {
  it('jede Kraft-Einheit aller 12 Wochen ≤ 60 min (ohne und mit vielen Beschwerden)', () => {
    for (const d of allDays()) {
      for (const data of [{}, heavy, { ...heavy, coachPlan: heavy.coachPlan.map((c) => ({ ...c, date: addDays(d, -1) })) }]) {
        const day = dayWith(d, data);
        if (day.type !== 'strength') continue;
        expect(day.minutes, `${d} ${day.title}`).toBeLessThanOrEqual(60);
        expect(sessionMinutes(day.items), d).toBe(day.minutes);
      }
    }
  });
  it('Mi 18.11. mit den echten Beschwerden: deutlich kürzer als die 95 min', () => {
    const day = dayWith('2026-11-18', heavy);
    expect(day.minutes).toBeLessThanOrEqual(60);
    expect(day.items.filter((i) => i.extra).length).toBeLessThanOrEqual(PLAN.extraRules.maxPerSession);
  });
  it('keine doppelte Übung (gleicher Name) an einem Tag', () => {
    for (const d of allDays()) {
      const day = dayWith(d, heavy);
      const names = day.items.filter((i) => i.kind === 'exercise').map((i) => i.name);
      expect(new Set(names).size, d).toBe(names.length);
    }
  });
  it('Mini-Version hat keine Extras', () => {
    const day = getDay('2026-11-18', { overrides: adjust('2026-11-18', heavy).overrides, mini: true });
    expect(day.items.some((i) => i.extra)).toBe(false);
  });
});

describe('Sätze einzeln zum Abhaken', () => {
  it('je Seite: betroffene Seite zuerst, Extra-Satz nur dort am Ende', () => {
    const l = setList({ exId: 'A7', perSide: true, sets: 2, doseText: '2×15 je Seite', extraSide: 'rechts' });
    expect(l.map((x) => x.label)).toEqual(['Rechts – Satz 1 – 15×', 'Links – Satz 1 – 15×', 'Rechts – Satz 2 – 15×', 'Links – Satz 2 – 15×', 'Rechts – Satz 3 (extra) – 15×']);
  });
  it('linke Seite betroffen → links zuerst', () => {
    const l = setList({ exId: 'A7', perSide: true, sets: 1, doseText: '1×10 je Seite', extraSide: 'links' });
    expect(l[0].label).toMatch(/^Links/);
  });
  it('Dosis-Text zeigt immer die echte Satzzahl', () => {
    for (const d of allDays()) {
      const day = dayWith(d, heavy);
      for (const it of day.items.filter((i) => i.kind === 'exercise' && !i.perSide && !i.exId.endsWith('0') && !i.holds)) {
        const m = String(it.doseText).match(/^(\d+)\s?×/);
        if (m) expect(Number(m[1]), `${d} ${it.exId} ${it.doseText}`).toBe(it.setList.length);
      }
    }
  });
});

describe('Jede Übung ist genau erklärt', () => {
  const all = [...PLAN.strength.A.exercises, ...PLAN.strength.B.exercises, ...Object.values(PLAN.extraExercises).flat()];
  it('Startposition, 2–4 Schritte, Richtig-wenn, Fehler – auch in jeder Variante', () => {
    for (const ex of all) {
      const vars = [ex, ...(ex.dose || []).filter?.((d) => d.variant).map((d) => ({ ...ex, ...d.variant })) || []];
      for (const v of vars) {
        expect(v.start, `${ex.id} start`).toBeTruthy();
        expect(v.start.length, `${ex.id} start zu kurz`).toBeGreaterThan(25);
        expect(v.steps.length, `${ex.id} ${v.name} Schritte`).toBeGreaterThanOrEqual(2);
        expect(v.steps.length, `${ex.id} ${v.name} Schritte`).toBeLessThanOrEqual(ex.id.endsWith('0') ? 6 : 4);
        expect(v.watch, `${ex.id} watch`).toBeTruthy();
        expect(v.mistake, `${ex.id} mistake`).toBeTruthy();
      }
    }
  });
  it('kein Englisch in Namen der Übungen', () => {
    for (const ex of all) expect(ex.name, ex.id).not.toMatch(/Clamshell|Copenhagen|Step-Down|Gluteus/);
  });
  it('Aufwärmen an Kraft-Tagen ohne Fachwort-Kette (Gluteus Medius)', () => {
    for (const d of allDays()) {
      const day = dayWith(d);
      for (const it of day.items.filter((i) => i.kind === 'exercise' && i.exId.endsWith('0'))) expect(it.steps.join(' '), d).not.toMatch(/Gluteus|Functional Patterns diese Woche/);
    }
  });
});

describe('Keine veralteten Hinweise', () => {
  it('Kraft-Tag zeigt keinen Lauf-Hinweis „läufst du nur locker“', () => {
    const data = { checks: [{ date: '2026-11-16', squat: 0, shin: 2, bone: 1, limp: 0, sick: 0 }] };
    const day = dayWith('2026-11-18', data);
    expect(day.type).toBe('strength');
    expect(day.reasons.join(' ')).not.toMatch(/läufst du nur locker/);
  });
  it('gestern gelaufen → heute (Kraft) kein „verschoben“, kein Lauf-Item', () => {
    const data = { runs: [{ date: '2026-11-17', workout: 'Di Steigerungen', rpe: 4, pain: 0 }] };
    const day = dayWith('2026-11-18', data);
    expect(day.items.some((i) => i.kind === 'watch' || i.kind === 'runlog')).toBe(false);
    expect(day.title).not.toMatch(/verschoben/);
  });
  it('„Pause 0“ hebt eine Pause wegen Krankheit nicht auf', () => {
    const data = { checks: [{ date: '2026-11-19', squat: 0, shin: 0, bone: 0, limp: 0, sick: 1, created_at: '2026-11-19T06:00:00Z' }], manual: [{ date: '2026-11-19', field: 'pause', value: '0', reason: 'x' }] };
    expect(adjust('2026-11-19', data).overrides.pause).toBe(true);
  });
});

import { applyExTexts, normDone, buildExText } from '../shared/extexts.js';
describe('Coach-Erklärungen und alte Haken', () => {
  const day = getDay('2026-11-18');
  it('Coach-Text gilt nur für die passende Variante, Stopp-Zeilen bleiben', () => {
    const t = { A3: buildExText(null, { start: 'Neuer Start mit genug Text für den Test.', steps: ['Eins.', 'Zwei.'], name: 'Wandsitz' }, '2026-11-18T20:00:00Z') };
    expect(applyExTexts(day, t).items.find((i) => i.exId === 'A3').start).toBe('Neuer Start mit genug Text für den Test.');
    const w5 = getDay('2026-12-16');
    expect(applyExTexts(w5, t).items.find((i) => i.exId === 'A3').start).not.toBe('Neuer Start mit genug Text für den Test.');
    const t2 = { A2: buildExText(null, { steps: ['Hoch.', 'Runter.'] }, 'x') };
    expect(applyExTexts(day, t2).items.find((i) => i.exId === 'A2').steps.some((s) => /^Stopp/.test(s))).toBe(true);
  });
  it('Rückgängig stellt die alte Version her', () => {
    const v1 = buildExText(null, { start: 'Version eins' }, 'a');
    const v2 = buildExText(v1, { start: 'Version zwei' }, 'b');
    expect(buildExText(v2, { undo: true }, 'c').start).toBe('Version eins');
  });
  it('alte Haken (Satzzahl) zählen in der neuen Schritt-Zählung voll', () => {
    const it = day.items.find((i) => i.exId === 'A7');
    const d = normDone(day, [{ item_id: it.id, value: 2, done_at: '2026-11-18T19:46:00Z' }]);
    expect(d[it.id]).toBe(it.setList.length);
    const neu = normDone(day, [{ item_id: it.id, value: 2, done_at: '2026-11-19T19:46:00Z' }]);
    expect(neu[it.id]).toBe(2);
  });
});
