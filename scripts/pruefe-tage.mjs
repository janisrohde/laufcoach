// Prüft mit den Live-Daten (Remote-D1), was der Coach an den nächsten Tagen macht.
// Aufruf: node scripts/pruefe-tage.mjs [JJJJ-MM-TT] [Tage]
import { execSync } from 'node:child_process';
import { adjust } from '../shared/coach.js';
import { getDay, addDays, berlinDate } from '../shared/plan.js';

const start = process.argv[2] || berlinDate();
const n = Number(process.argv[3] || 7);
const from = addDays(start, -60);
const q = (sql) => {
  const out = execSync(`npx wrangler d1 execute laufcoach-db --remote --json --command "${sql}"`, { cwd: new URL('../worker', import.meta.url), stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  return JSON.parse(out)[0].results;
};
const T = { checks: 'checks', runs: 'runs', feedback: 'feedback', manual: 'overrides', coachPlan: 'coach_plan', athleteNotes: 'athlete_notes', spotChecks: 'spot_checks', wellness: 'wellness' };
const data = {};
for (const [k, t] of Object.entries(T)) data[k] = q(`SELECT * FROM ${t} WHERE date >= '${from}'`);

for (let i = 0; i < n; i++) {
  const d = addDays(start, i);
  const a = adjust(d, data);
  const day = getDay(d, { overrides: a.overrides });
  const run = day.type === 'run' ? (a.overrides.pause ? 'ABGESAGT' : a.overrides.workout || day.workout || '') : '';
  console.log(`${d} ${day.type.padEnd(9)} ampel=${a.ampel.padEnd(5)} pause=${!!a.overrides.pause} ${run}`);
  for (const r of a.overrides.reasons) console.log(`   · ${r}`);
  if (a.overrides.runNote) console.log(`   → ${a.overrides.runNote}`);
}
