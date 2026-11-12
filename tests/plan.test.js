import { describe, it, expect } from 'vitest';
import { getDay, addDays, planWeek, PLAN, strengthSession, berlinDate } from '../shared/plan.js';

// Tabelle 4.2 aus dem Auftrag, unabhängig von plan.json abgetippt
const TABLE = [
  ['2026-11-16', 'Di Steigerungen', 'Locker (frei)', 'Lang 10 km'],
  ['2026-11-23', 'Di Zügig 3x6 min', 'Locker (frei)', 'Lang 11 km'],
  ['2026-11-30', 'Di Schnell 8x1 min', 'Locker (frei)', 'Lang 12 km'],
  ['2026-12-07', 'Di Steigerungen', 'Do Puls-Pace-Check', 'Lang 9 km'],
  ['2026-12-14', 'Di Schwelle 3x6 min', 'Locker (frei)', 'Lang 12 km'],
  ['2026-12-21', 'Di Schnell 5x2 min', 'Locker (frei)', 'Lang 13 km'],
  ['2026-12-28', 'Di Schwelle 2x10 min (Check)', 'Locker (frei)', 'Lang 13 km'],
  ['2027-01-04', 'Di Steigerungen', 'Do Puls-Pace-Check', 'Lang 10 km'],
  ['2027-01-11', 'Di Schwelle 4x5 min', 'Locker (frei)', 'Lang 13 km'],
  ['2027-01-18', 'Di Schnell 4x2:30 min', 'Locker (frei)', 'Lang 14 km'],
  ['2027-01-25', 'Di Schwelle 20 min', 'Locker (frei)', 'Lang 14 km'],
  ['2027-02-01', 'Di Test 5 km', 'Locker (frei)', 'Lang 10 km'],
];
const FP_BY_WEEK = { 1: 2, 2: 3, 3: null, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: null, 12: null };
const FP_IDS = { 2: [12, 22], 3: [23, 33], 4: [34, 37], 5: [38, 42], 6: [43, 47], 7: [48, 51], 8: [52, 55], 9: [56, 59], 10: [60, 63] };

describe('Woche 0', () => {
  it('12.–15.11. stimmen', () => {
    expect(getDay('2026-11-12')).toMatchObject({ week: 0, type: 'strength', title: 'Kraft-A-Probe', minutes: 15 });
    expect(getDay('2026-11-12').items.every((i) => i.sets === 1)).toBe(true);
    expect(getDay('2026-11-13').type).toBe('rest');
    expect(getDay('2026-11-14')).toMatchObject({ type: 'run', workout: 'Locker (frei)' });
    expect(getDay('2026-11-15').type).toBe('rest');
  });
});

describe('Jeder Tag vom 16.11.2026 bis 07.02.2027', () => {
  TABLE.forEach(([mon, tue, thu, sun], i) => {
    const n = i + 1;
    it(`Woche ${n}`, () => {
      for (let k = 0; k < 7; k++) expect(planWeek(addDays(mon, k))).toBe(n);
      const d = (k) => getDay(addDays(mon, k));
      expect(d(0).type).toBe('fp');
      expect(d(1)).toMatchObject({ type: 'run', workout: tue });
      expect(d(2)).toMatchObject({ type: 'strength', strengthKey: 'A' });
      expect(d(3)).toMatchObject({ type: 'run', workout: thu });
      expect(d(4)).toMatchObject({ type: 'strength', strengthKey: 'B' });
      expect(d(5).type).toBe('rest');
      expect(d(6)).toMatchObject({ type: 'run', workout: sun });
      expect(d(1).level).toBe(n <= 4 ? 1 : n <= 8 ? 2 : 3);
      expect(d(1).easy).toBe([4, 8, 12].includes(n));
      for (const w of [tue, thu, sun]) expect(PLAN.workouts[w]).toBeTruthy();
    });
    it(`FP-Montag Woche ${n}`, () => {
      const fp = getDay(mon).fp;
      expect(fp.fpWeek).toBe(FP_BY_WEEK[n]);
      if (FP_BY_WEEK[n]) {
        const [a, b] = FP_IDS[FP_BY_WEEK[n]];
        expect(fp.lessons.map((l) => l.lessonId)).toEqual(Array.from({ length: b - a + 1 }, (_, j) => a + j));
        for (const l of fp.lessons) {
          expect(l.url).toBe(`https://learning.functionalpatterns.app/courses/142637/lessons/${l.lessonId}`);
          expect(['machen', 'ansehen', 'freiwillig']).toContain(l.mode);
        }
        expect(fp.weekUrl).toBe(`https://learning.functionalpatterns.app/courses/142637/classes/${FP_BY_WEEK[n]}`);
      } else expect(fp.text.length).toBeGreaterThan(10);
    });
  });
  it('ab 08.02.2027 Erholungswoche', () => {
    expect(getDay('2027-02-08').recovery).toBe(true);
    expect(getDay('2027-02-09')).toMatchObject({ type: 'run', workout: 'Locker (frei)' });
  });
  it('kein Tag ist leer oder kaputt', () => {
    for (let d = '2026-11-12'; d < '2027-02-08'; d = addDays(d, 1)) {
      const x = getDay(d);
      expect(x.title).toBeTruthy();
      if (x.type === 'strength') expect(x.items.length).toBeGreaterThanOrEqual(7);
      if (x.type === 'run') expect(x.items.map((i) => i.kind)).toEqual(expect.arrayContaining(['check', 'watch', 'runlog']));
    }
  });
});

describe('Kraft-Dosis laut 4.5/4.6', () => {
  const dose = (k, w, id) => strengthSession(k, w).items.find((i) => i.exId === id);
  it('Wadenheben A2', () => {
    expect(dose('A', 1, 'A2').doseText).toBe('2×15 beidbeinig');
    expect(dose('A', 3, 'A2').doseText).toBe('3×15 beidbeinig');
    expect(dose('A', 5, 'A2').doseText).toContain('einbeinig');
    expect(dose('A', 9, 'A2').weight).toBe('1 × 3 kg');
  });
  it('Knie-Übung A3 Level-Wechsel', () => {
    expect(dose('A', 1, 'A3').name).toContain('Wandsitz');
    expect(dose('A', 5, 'A3').name).toContain('Ausfallschritt');
    expect(dose('A', 7, 'A3').weight).toBe('2 × 2 kg');
    expect(dose('A', 9, 'A3').name).toContain('Step-Down');
  });
  it('Pogo-Hüpfer erst ab Level 2, nicht in leichten Wochen', () => {
    expect(dose('A', 3, 'A1')).toBeUndefined();
    expect(dose('A', 5, 'A1')).toBeTruthy();
    expect(dose('A', 8, 'A1')).toBeUndefined();
    expect(dose('A', 12, 'A1')).toBeUndefined();
  });
  it('Liegestütz erst ab Woche 2, Kreuzheben-Hanteln', () => {
    expect(dose('B', 1, 'B5')).toBeUndefined();
    expect(dose('B', 2, 'B5')).toBeTruthy();
    expect(dose('B', 1, 'B3').weight).toBe('ohne Gewicht');
    expect(dose('B', 5, 'B3').weight).toBe('1 × 2 kg');
    expect(dose('B', 9, 'B3').weight).toBe('1 × 3 kg');
  });
  it('FP ersetzt Level-Übung, wenn freigeschaltet', () => {
    expect(dose('B', 5, 'B6').doseText).toContain('FP');
    expect(strengthSession('B', 5, { fpFree: 3 }).items.find((i) => i.exId === 'B6').doseText).not.toContain('FP');
    expect(dose('A', 8, 'A4').doseText).toContain('Supine Bridge');
    expect(dose('B', 10, 'B4').doseText).toContain('Unilateral Row');
  });
  it('Standing Neutral ab Woche 4', () => {
    expect(dose('A', 3, 'A8')).toBeUndefined();
    expect(dose('A', 4, 'A8').hold).toBe(120);
    expect(dose('A', 5, 'A8')).toBeUndefined();
    expect(dose('B', 5, 'B6q').doseText).toBe('2×8 je Seite');
    expect(dose('B', 10, 'B5b')).toBeTruthy();
    expect(dose('B', 1, 'B6').holds).toEqual([30, 20, 20]);
  });
  it('Mini-Version', () => {
    expect(strengthSession('A', 2, { mini: true }).items.map((i) => i.exId)).toEqual(['A0', 'A2', 'A3', 'A6']);
    expect(strengthSession('B', 2, { mini: true }).items.map((i) => i.exId)).toEqual(['B0', 'B1', 'B4', 'B6']);
  });
  it('Jede Übungskarte ist vollständig', () => {
    for (let w = 0; w <= 12; w++) for (const k of ['A', 'B']) for (const it of strengthSession(k, w).items) {
      for (const f of ['name', 'why', 'start', 'watch', 'mistake', 'doseText', 'weight']) expect(it[f], `${it.id} W${w} ${f}`).toBeTruthy();
      expect(it.steps.length).toBeGreaterThanOrEqual(3);
    }
  });
  it('Alte Pace 6:45–7:45 taucht nirgends auf', () => {
    expect(JSON.stringify(PLAN)).not.toContain('7:45');
  });
});

describe('Zeitzone', () => {
  it('Berlin-Datum über Mitternacht', () => {
    expect(berlinDate(new Date('2026-11-15T23:30:00Z'))).toBe('2026-11-16');
    expect(berlinDate(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02');
  });
});
