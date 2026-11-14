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
    expect(d.items.find((i) => i.kind === 'exercise').steps.length).toBeGreaterThanOrEqual(3);
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

describe('Nachricht an den Coach', () => {
  it('„Knöchel komisch nach außen“ → Extra-Übungen Außenknöchel', () => {
    const data = { athleteNotes: [{ date: '2026-11-18', text: 'Knöchel heute komisch, wenn ich nach außen biege' }] };
    const d = dayWith('2026-11-20', data);
    expect(d.items.some((i) => i.extra && i.area === 'aussenknoechel')).toBe(true);
  });
});

describe('Extra-Übungen immer beidseitig', () => {
  it('rechtes Knie → beide Beine, rechts 1 Satz mehr', () => {
    const d = getDay('2026-11-18', { overrides: { extras: [{ area: 'knie', side: 'rechte', count: 2 }] } });
    const ex = d.items.filter((i) => i.extra);
    expect(ex.length).toBe(2);
    for (const i of ex.filter((x) => /je (Seite|Bein|Fuß)/.test(x.doseText))) expect(i.doseText).toContain('beide Seiten');
    expect(ex.some((x) => x.doseText.includes('Rechte Seite zuerst'))).toBe(true);
  });
});

describe('Fehler aus der Code-Prüfung', () => {
  it('verschobener Lauf erscheint am Krafttag', () => {
    const data = { manual: [{ date: '2026-11-18', field: 'addRun', value: 'Di Steigerungen' }] };
    const d = dayWith('2026-11-18', data);
    expect(d.items.some((i) => i.id === 'run:watch')).toBe(true);
    expect(d.items.some((i) => i.kind === 'exercise')).toBe(true);
  });
  it('Morgen-Check gibt es jeden Tag', () => {
    for (const d of ['2026-11-16', '2026-11-18', '2026-11-21']) expect(getDay(d).items.some((i) => i.kind === 'check')).toBe(true);
  });
  it('„Sonstiges“ + Notiz „rechtes Knie zwickt“ → Knie-Extras', () => {
    const data = { runs: [{ date: '2026-11-17', workout: 'Di Steigerungen', pain: 4, pain_where: 'sonstiges', note: 'rechtes Knie zwickt' }] };
    const d = dayWith('2026-11-18', data);
    expect(d.items.some((i) => i.extra && i.area === 'knie')).toBe(true);
  });
  it('Extras steigen nach einer Woche auf Stufe 2', () => {
    const data = { athleteNotes: [{ date: '2026-11-16', text: 'rechtes Schienbein zwickt' }] };
    expect(dayWith('2026-11-18', data).items.find((i) => i.extra).level).toBe(1);
    expect(dayWith('2026-11-25', { athleteNotes: [...data.athleteNotes, { date: '2026-11-24', text: 'Schienbein zwickt noch etwas' }] }).items.find((i) => i.extra).level).toBe(2);
  });
  it('Nachfrage am Tag nach der Meldung', async () => {
    const { spotStatus } = await import('../shared/followup.js');
    const { weakSpots } = await import('../shared/coach.js');
    const notes = [{ date: '2026-11-17', text: 'rechtes Schienbein tut weh' }];
    const st = spotStatus('2026-11-18', weakSpots('2026-11-18', [], [], notes, []), []);
    expect(st[0].due).toBe(true);
    expect(st[0].question).toBe("Wie geht's deinem rechten Schienbein heute?");
    const st2 = spotStatus('2026-11-18', weakSpots('2026-11-18', [], [], notes, []), [{ date: '2026-11-18', area: 'schienbein', answer: 'besser' }]);
    expect(st2[0].due).toBe(false);
  });
});
