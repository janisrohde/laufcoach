// Zeigt den kompletten Inhalt eines Tages als Text (wie in der App), mit Live-Daten.
// Aufruf: node scripts/zeige-tag.mjs [JJJJ-MM-TT]
import { readFileSync } from 'node:fs';
import { adjust } from '../shared/coach.js';
import { getDay, berlinDate } from '../shared/plan.js';
const date = process.argv[2] || berlinDate();
const x = JSON.parse(readFileSync('chats-export/2026-11-18.json', 'utf8'));
const data = { checks: x.checks, runs: x.runs, feedback: x.feedback, manual: x.overrides, coachPlan: x.coach_plan, athleteNotes: x.athlete_notes, spotChecks: x.spot_checks, wellness: x.wellness };
const a = adjust(date, data);
const d = getDay(date, { overrides: a.overrides });
console.log(`# ${d.label} – ${d.title} (${d.minutes} min angezeigt)\nGründe: ${d.reasons.join(' | ')}\nAblauf: ${d.general || ''}\n`);
let i = 1;
for (const it of d.items) {
  if (it.kind !== 'exercise') { console.log(`[${it.kind}] ${it.name}\n`); continue; }
  console.log(`## Übung ${i++}  – ${it.name} [${it.id}]${it.extra ? ' EXTRA ' + it.area + (it.side ? ' ' + it.side : '') : ''}`);
  console.log(`Dosis: ${it.doseText} · Sätze ${it.sets} · Halten ${it.hold || '-'} · ca. ${Math.round(it.seconds / 60)} min · je Seite ${it.perSide} · Gewicht ${it.weight}${it.extraSet ? ' · ' + it.extraSet : ''}`);
  console.log(`Sätze: ${(it.setList || []).map((x) => x.label).join(' | ')}`);
  console.log(`Start: ${it.start}`);
  (it.steps || []).forEach((s, k) => console.log(`  ${k + 1}. ${s}`));
  console.log(`Richtig: ${it.watch}\nFehler: ${it.mistake}\nOhne Gerät/zu schwer: ${it.easier || '-'}
Werkzeug: ${it.tool}\nWofür: ${it.why}\n`);
}
