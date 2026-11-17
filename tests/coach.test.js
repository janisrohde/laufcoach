import { describe, it, expect } from 'vitest';
import { adjust, parseNote, checkColor, runColor, vdot, zonesFromVdot, weakSpots, weekReport } from '../shared/coach.js';
import { getDay } from '../shared/plan.js';

const run = (date, workout, x = {}) => ({ date, workout, ...x });
const chk = (date, x = {}) => ({ date, squat: 0, shin: 0, hop: 0, ...x });
const dayWith = (date, data) => getDay(date, { overrides: adjust(date, data).overrides });

describe('Ampel', () => {
  it('1 grün ohne Daten', () => {
    expect(adjust('2026-11-17', {}).ampel).toBe('gruen');
    expect(dayWith('2026-11-17', {}).workout).toBe('Di Steigerungen');
  });
  it('2 Knie gelb am Montag → Tempo wird Locker, Kraft leichter, keine Sprünge', () => {
    const data = { checks: [chk('2026-12-15', { squat: 3 })] };
    const a = adjust('2026-12-15', data);
    expect(a.ampel).toBe('gelb');
    const d = dayWith('2026-12-15', data);
    expect(d.workout).toBe('Locker (frei)');
    expect(d.plannedWorkout).toBe('Di Schwelle 3x6 min');
    expect(d.note).toContain('Puls unter 158');
    expect(d.reasons[0]).toContain('Heute angepasst, weil');
    const kraft = dayWith('2026-12-16', { checks: [chk('2026-12-16', { squat: 3 })] });
    expect(kraft.items.find((i) => i.exId === 'A1')).toBeUndefined();
    expect(kraft.items.find((i) => i.exId === 'A2').doseText).toContain('beidbeinig');
  });
  it('3 Knochenpunkt frisch → heute und morgen Pause, danach nur leicht statt 7 Tage Pause', () => {
    const data = { checks: [chk('2026-11-23', { shin: 6, bone: 1 })] };
    expect(adjust('2026-11-24', data).ampel).toBe('rot');
    expect(dayWith('2026-11-24', data).type).toBe('rest');
    // 2 Tage später ohne neuen Check: nicht abgesagt, aber locker
    const d26 = adjust('2026-11-26', data);
    expect(d26.ampel).toBe('gelb');
    expect(d26.overrides.pause).toBeUndefined();
    expect(d26.messages.some((m) => m.text.includes('Drück'))).toBe(true);
    expect(dayWith('2026-11-26', data).type).not.toBe('rest');
    // nur 2 Checks ohne Knochenschmerz → noch leicht
    const few = { checks: [...data.checks, chk('2026-11-30'), chk('2026-12-01')] };
    expect(adjust('2026-12-01', few).ampel).toBe('gelb');
    // nach 7 Tagen + 5 Checks ohne Knochenschmerz wieder normal, erster langer Lauf halbiert
    const later = { checks: [...data.checks, ...['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01'].map((d) => chk(d))] };
    expect(adjust('2026-12-01', later).ampel).toBe('gruen');
    expect(dayWith('2026-12-06', later).workout).toBe('Lang 9 km');
  });
  it('3b Knochenpunkt, aber danach „ich kann laufen“ → läuft (locker), nicht abgesagt', () => {
    const data = {
      checks: [{ ...chk('2026-11-16', { shin: 2, bone: 1 }), created_at: '2026-11-16T20:21:00Z' }],
      athleteNotes: [{ date: '2026-11-17', text: 'Nein Bro keine Pause ich kann laufen', created_at: '2026-11-17T06:39:00Z' }],
    };
    const a = adjust('2026-11-17', data);
    expect(a.ampel).toBe('gelb');
    expect(a.overrides.pause).toBeUndefined();
    expect(dayWith('2026-11-17', data).type).toBe('run');
  });
  it('4 Rot ohne Knochen → am Tag danach Pause, dann leichter bis 2 grüne Checks, langer Lauf 2/3', () => {
    expect(adjust('2026-11-24', { checks: [chk('2026-11-24', { squat: 6 })] }).ampel).toBe('rot');
    const data = { checks: [chk('2026-11-24', { squat: 6 }), chk('2026-11-25')] };
    expect(adjust('2026-11-26', data).ampel).toBe('gelb');
    expect(adjust('2026-11-26', data).overrides.pause).toBeUndefined();
    const ok = { checks: [...data.checks, chk('2026-11-26')] };
    expect(adjust('2026-11-26', ok).ampel).toBe('gruen');
    expect(dayWith('2026-11-29', ok).workout).toBe('Lang 9 km'); // 2/3 von 11 = 7,3 → kleinstes Lang 9
  });
  it('4b Hinken → Pause', () => {
    expect(adjust('2026-11-24', { checks: [chk('2026-11-24', { limp: 1 })] }).overrides.pause).toBe(true);
  });
  it('4c Schlaf, HRV, Ruhepuls, Zwicken → nie Pause', () => {
    const normal = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'].map((d) => chk(d, { rhr: 52 }));
    const data = {
      checks: [...normal, chk('2026-11-17', { rhr: 62, shin: 3 })],
      wellness: [{ date: '2026-11-17', sleep_min: 300, hrv: 40, hrv_base: 70 }],
      athleteNotes: [{ date: '2026-11-17', text: 'Schienbein zwickt ein bisschen' }],
    };
    const a = adjust('2026-11-17', data);
    expect(a.ampel).toBe('gelb');
    expect(a.overrides.pause).toBeUndefined();
    expect(dayWith('2026-11-17', data).type).toBe('run');
  });
  it('4d Coach sagt Pause ohne echten Grund → lockerer Lauf statt Absage', () => {
    const data = { coachPlan: [{ date: '2026-11-17', kind: 'run', data: JSON.stringify({ pause: true, reason: 'Wade' }) }] };
    const a = adjust('2026-11-17', data);
    expect(a.overrides.pause).toBeUndefined();
    expect(dayWith('2026-11-17', data).workout).toBe('Locker (frei)');
  });
  it('4f FP-Montag: bei Schienbein/Knochenpunkt keine Innenwade', () => {
    const ohne = getDay('2026-11-23').fp.lessons.map((l) => l.station);
    expect(ohne).toContain('innenwade');
    const mit = dayWith('2026-11-23', { checks: [chk('2026-11-20', { shin: 2, bone: 1 })] }).fp.lessons.map((l) => l.station);
    expect(mit).not.toContain('innenwade');
    expect(mit).toContain('wade');
  });
  it('4e Janis will Pause oder ist krank → Pause', () => {
    expect(adjust('2026-11-17', { athleteNotes: [{ date: '2026-11-17', text: 'Ich brauche heute mal Pause' }] }).overrides.pause).toBe(true);
    expect(adjust('2026-11-17', { athleteNotes: [{ date: '2026-11-17', text: 'bin krank, Fieber' }] }).overrides.pause).toBe(true);
    expect(adjust('2026-11-17', { athleteNotes: [{ date: '2026-11-17', text: 'keine Pause bitte' }] }).overrides.pause).toBeUndefined();
  });
  it('5 Schmerz nach dem Lauf, aber schnell weg → Laufen bleibt, Kraft bekommt Extras', () => {
    const data = { runs: [run('2026-11-17', 'Di Steigerungen', { pain: 3, pain_where: 'knie', pain_side: 'rechts', pain_gone: 'schnell', rpe: 6 })] };
    expect(adjust('2026-11-19', data).ampel).toBe('gruen');
    expect(dayWith('2026-11-19', data).workout).toBe('Locker (frei)');
    const a = dayWith('2026-11-18', data);
    expect(a.items.some((i) => i.extra && i.area === 'knie')).toBe(true);
    expect(a.items.some((i) => i.extra && i.area === 'huefte')).toBe(true);
    expect(a.reasons.join(' ')).toContain('rechtes Knie');
  });
  it('6 Schmerz bleibt → gelb', () => {
    const data = { runs: [run('2026-11-17', 'Di Steigerungen', { pain: 4, pain_where: 'schienbein', pain_gone: 'noch', rpe: 6 })] };
    expect(adjust('2026-11-19', data).ampel).toBe('gelb');
  });
  it('7 Ruhepuls deutlich über dem eigenen Normalwert → gelb', () => {
    const normal = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'].map((d) => chk(d, { rhr: 52 }));
    expect(adjust('2026-11-17', { checks: normal }).ampel).toBe('gruen');
    const data = { checks: [...normal, chk('2026-11-18', { rhr: 60 })] };
    expect(adjust('2026-11-18', data).ampel).toBe('gelb');
  });
  it('7b krank → rot', () => {
    expect(adjust('2026-11-18', { checks: [chk('2026-11-18', { sick: 1 })] }).ampel).toBe('rot');
  });
  it('7c wenig Schlaf → Tempo wird locker', () => {
    const d = dayWith('2026-11-17', { wellness: [{ date: '2026-11-17', sleep_min: 380 }] });
    expect(d.workout).toBe('Locker (frei)');
  });
});

describe('Langer Lauf', () => {
  it('8 Montag-Hocke nicht grün → gleiche Länge wie letzte Woche', () => {
    const data = { checks: [chk('2026-11-23', { squat: 3 }), chk('2026-11-24'), chk('2026-11-25')], runs: [run('2026-11-22', 'Lang 10 km', { distance_m: 10000, rpe: 6 })] };
    expect(dayWith('2026-11-29', data).workout).toBe('Lang 10 km');
  });
  it('9 10-%-Regel', () => {
    const data = { runs: [run('2026-11-22', 'Lang 10 km', { distance_m: 9000, rpe: 5 })] };
    // geplant 11 km, längster Lauf 9 km → höchstens 9,9 → Lang 9 km
    expect(dayWith('2026-11-29', data).workout).toBe('Lang 9 km');
  });
  it('10 normale Steigerung bleibt', () => {
    const data = { checks: [chk('2026-11-23')], runs: [run('2026-11-22', 'Lang 10 km', { distance_m: 10200, rpe: 5 })] };
    expect(dayWith('2026-11-29', data).workout).toBe('Lang 11 km');
  });
});

describe('Puls und Tempo', () => {
  it('11 lockerer Lauf zu schnell → Hinweis', () => {
    const a = adjust('2026-11-21', { runs: [run('2026-11-19', 'Locker (frei)', { hr_avg: 168 })] });
    expect(a.messages[0].text).toContain('zu schnell');
  });
  it('12 zweimal zu schnell → deutlicher Hinweis, keine Planänderung', () => {
    const data = { runs: [run('2026-11-19', 'Locker (frei)', { hr_avg: 168 }), run('2026-11-22', 'Lang 10 km', { hr_avg: 166 })] };
    const a = adjust('2026-11-24', data);
    expect(a.messages[0].type).toBe('warn');
    expect(dayWith('2026-11-24', data).workout).toBe('Di Zügig 3x6 min');
  });
  it('13 Tempo zu hart → eine Wiederholung weniger', () => {
    const d = dayWith('2026-11-24', { runs: [run('2026-11-17', 'Di Steigerungen', { rpe: 9 })] });
    expect(d.note).toContain('nach 2 Stücken Stopp');
  });
  it('14 zwei leichte Tempo-Läufe → Lob', () => {
    const a = adjust('2026-11-26', { runs: [run('2026-11-17', 'Di Steigerungen', { rpe: 5 }), run('2026-11-24', 'Di Zügig 3x6 min', { rpe: 4 })] });
    expect(a.messages.some((m) => m.text.startsWith('Stark!'))).toBe(true);
  });
});

describe('Tests', () => {
  it('15 Puls-Pace-Check W4 → W8 Vergleich', () => {
    const a = adjust('2027-01-08', { runs: [run('2026-12-10', 'Do Puls-Pace-Check', { test_value: '6:20' }), run('2027-01-07', 'Do Puls-Pace-Check', { test_value: '6:12' })] });
    expect(a.messages.some((m) => m.text.includes('6:20 → 6:12'))).toBe(true);
  });
  it('16 Schwellen-Check', () => {
    expect(adjust('2026-12-30', { runs: [run('2026-12-29', 'Di Schwelle 2x10 min (Check)', { test_value: '174', rpe: 6 })] }).messages[0].text).toContain('fitter als gedacht');
    expect(adjust('2026-12-30', { runs: [run('2026-12-29', 'Di Schwelle 2x10 min (Check)', { test_value: '187', rpe: 8 })] }).messages[0].text).toContain('zu schnell');
  });
  it('17 5-km-Test → VDOT und neue Zonen', () => {
    const a = adjust('2027-02-03', { runs: [run('2027-02-02', 'Di Test 5 km', { test_value: '22:30' })] });
    const m = a.messages.find((x) => x.zones);
    expect(m.zones.vdot).toBeGreaterThan(42);
    expect(m.zones.vdot).toBeLessThan(46);
    expect(vdot(20 * 60)).toBeCloseTo(49.8, 0);
    expect(zonesFromVdot(50).schwelle).toMatch(/^\d:\d\d–\d:\d\d$/);
  });
});

describe('Schwachstellen und Feedback', () => {
  it('18 Freitext wird verstanden', () => {
    expect(parseNote('heute rechtes Knie gezwickt')).toEqual({ areas: ['knie'], side: 'rechte' });
    expect(parseNote('linker Innenknöchel zieht')).toEqual({ areas: ['innenknoechel'], side: 'linke' });
  });
  it('19 Notiz ohne Schmerzwert zählt, wenn sie nach Schmerz klingt', () => {
    expect(weakSpots('2026-11-20', [run('2026-11-19', 'Locker (frei)', { note: 'Schienbein links zwickt etwas', pain: 0 })])[0]).toMatchObject({ area: 'schienbein', side: 'linke' });
  });
  it('20 nach 3 Wochen ohne Zwicken keine Extras mehr', () => {
    const data = { runs: [run('2026-11-17', 'Di Steigerungen', { pain: 3, pain_where: 'knie', pain_gone: 'schnell' })] };
    expect(dayWith('2026-12-16', data).items.some((i) => i.extra)).toBe(false);
  });
  it('21 zweimal „zu leicht“ → nächste Stufe, „zu schwer“ → leichter', () => {
    const fb = [{ date: '2026-11-18', ex_id: 'A2', value: 'leicht' }, { date: '2026-11-25', ex_id: 'A2', value: 'leicht' }];
    const d = dayWith('2026-12-02', { feedback: fb });
    expect(d.items.find((i) => i.exId === 'A2').doseText).toContain('einbeinig');
    const d2 = dayWith('2026-12-16', { feedback: [{ date: '2026-12-16', ex_id: 'A3', value: 'schwer' }, { date: '2026-12-09', ex_id: 'A3', value: 'schwer' }] });
    expect(d2.items.find((i) => i.exId === 'A3').name).toContain('Wandsitz');
  });
  it('22 Verschieben (manuell)', () => {
    const data = { manual: [{ date: '2026-11-17', field: 'moved', value: '1', reason: 'Auf morgen verschoben.' }, { date: '2026-11-18', field: 'workout', value: 'Di Steigerungen', reason: 'Von gestern verschoben.' }] };
    expect(dayWith('2026-11-17', data).type).toBe('rest');
  });
  it('23 Wochenbericht', () => {
    const data = { runs: [run('2026-11-17', 'Di Steigerungen', { distance_m: 8000, rpe: 6 }), run('2026-11-19', 'Locker (frei)', { distance_m: 7000, hr_avg: 158, rpe: 4 }), run('2026-11-22', 'Lang 10 km', { distance_m: 10000, rpe: 6 })], checks: [] };
    const r = weekReport('2026-11-22', data, { '2026-11-18': ['a', 'b', 'c', 'd'], '2026-11-20': ['a', 'b', 'c', 'd'] });
    expect(r).toMatchObject({ planned: 5, done: 5, km: 25, longest: 10, easyHr: 158 });
    expect(r.coach).toContain('Woche geschafft');
  });
  it('24 Farben', () => {
    expect(checkColor({ squat: 2 })).toBe('gruen');
    expect(checkColor({ squat: 4 })).toBe('gelb');
    expect(checkColor({ hop: 5 })).toBe('rot');
    expect(runColor({ pain: 6, pain_gone: 'schnell' })).toBe('rot');
    expect(runColor({ pain: 3, pain_gone: 'schnell' })).toBe('gruen');
  });
});
