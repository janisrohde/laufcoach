import { describe, it, expect } from 'vitest';
import { analyzeRun } from '../shared/analysis.js';
import { adjust } from '../shared/coach.js';
import { getDay } from '../shared/plan.js';

const run = (date, workout, x = {}) => ({ date, workout, duration_s: 2700, distance_m: 7000, ...x });
const dayWith = (date, data) => getDay(date, { overrides: adjust(date, data).overrides });

describe('Lauf-Analyse', () => {
  it('lockerer Lauf im Zielbereich ist gut', () => {
    const a = analyzeRun(run('2026-11-19', 'Locker (frei)', { hr_avg: 158, cadence: 171 }));
    expect(a.verdict).toBe('gut');
  });
  it('lockerer Lauf mit Puls 167 ist zu hart', () => {
    const a = analyzeRun(run('2026-11-19', 'Locker (frei)', { hr_avg: 167, hr_max: 183, cadence: 166 }));
    expect(a.verdict).toBe('achtung');
    expect(a.tip).toContain('langsam');
  });
  it('langer Lauf zu lang wird erwähnt', () => {
    const a = analyzeRun(run('2026-11-22', 'Lang 10 km', { distance_m: 12500, duration_s: 4800, hr_avg: 158 }));
    expect(a.points.some((p) => p.text.includes('länger als geplant'))).toBe(true);
  });
  it('Ausdauer-Fortschritt wird erkannt', () => {
    const prev = [run('2026-11-05', 'Locker (frei)', { hr_avg: 160 }), run('2026-11-08', 'Locker (frei)', { hr_avg: 160 })];
    const a = analyzeRun(run('2026-11-19', 'Locker (frei)', { hr_avg: 150 }), prev);
    expect(a.points.some((p) => p.text.startsWith('Ausdauer'))).toBe(true);
  });
  it('kurzer Lauf wird nicht bewertet', () => {
    expect(analyzeRun(run('2026-11-13', 'Locker (frei)', { distance_m: 1260 })).title).toBe('Kurzer Lauf');
  });
});

describe('Verschieben zeigt die ganze Einheit', () => {
  it('Kraft A von Mittwoch auf Donnerstag (Lauftag) wird angehängt', () => {
    const data = { manual: [{ date: '2026-11-19', field: 'addSession', value: JSON.stringify({ key: 'A' }), reason: 'Von gestern verschoben: Kraft A.' }] };
    const d = dayWith('2026-11-19', data);
    expect(d.type).toBe('run');
    expect(d.items.some((i) => i.kind === 'section')).toBe(true);
    expect(d.items.filter((i) => i.id.startsWith('plus:kraftA')).length).toBeGreaterThanOrEqual(7);
  });
  it('auf einen Ruhetag wird es die Einheit des Tages', () => {
    const data = { manual: [{ date: '2026-11-21', field: 'addSession', value: JSON.stringify({ key: 'B' }) }] };
    const d = dayWith('2026-11-21', data);
    expect(d.type).toBe('strength');
    expect(d.items[0].steps.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Plan von Claude', () => {
  it('Fokus-Bereiche erzeugen Extra-Übungen für 7 Tage', () => {
    const data = { coachPlan: [{ date: '2026-11-16', kind: 'focus', data: JSON.stringify({ areas: [{ area: 'schulter' }], reason: 'Schulter zwickt beim Armschwung.' }) }] };
    const d = dayWith('2026-11-20', data);
    expect(d.items.some((i) => i.extra && i.area === 'schulter')).toBe(true);
    expect(d.reasons.join(' ')).toContain('Coach:');
    expect(dayWith('2026-11-27', data).items.some((i) => i.extra)).toBe(false);
  });
  it('Lauf-Anpassung von Claude', () => {
    const data = { coachPlan: [{ date: '2026-11-17', kind: 'run', data: JSON.stringify({ workout: 'Locker (frei)', reason: 'Zu viele harte Läufe letzte Woche.' }) }] };
    expect(dayWith('2026-11-17', data).workout).toBe('Locker (frei)');
  });
});
