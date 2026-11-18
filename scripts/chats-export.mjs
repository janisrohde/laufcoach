// Exportiert alle Chats + Trainingsdaten seit einem Datum aus der Remote-D1.
// Aufruf: node scripts/chats-export.mjs [seit=2026-11-12] [datei=heute]
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const since = process.argv[2] || '2026-11-12';
const name = process.argv[3] || new Date().toISOString().slice(0, 10);
const q = (sql) => {
  const out = execSync(`npx wrangler d1 execute laufcoach-db --remote --json --command "${sql}"`, {
    cwd: 'worker', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out)[0].results;
};

const tables = {
  athlete_notes: `SELECT * FROM athlete_notes WHERE date >= '${since}' ORDER BY created_at`,
  coach_notes: `SELECT * FROM coach_notes WHERE date >= '${since}' ORDER BY created_at`,
  checks: `SELECT * FROM checks WHERE date >= '${since}' ORDER BY date`,
  wellness: `SELECT * FROM wellness WHERE date >= '${since}' ORDER BY date`,
  done: `SELECT * FROM done WHERE date >= '${since}' ORDER BY done_at`,
  feedback: `SELECT * FROM feedback WHERE date >= '${since}' ORDER BY created_at`,
  overrides: `SELECT * FROM overrides WHERE date >= '${since}' ORDER BY created_at`,
  coach_plan: `SELECT * FROM coach_plan WHERE date >= '${since}' ORDER BY date`,
  spot_checks: `SELECT * FROM spot_checks WHERE date >= '${since}' ORDER BY created_at`,
  runs: `SELECT * FROM runs WHERE date >= '${since}' ORDER BY date`,
};
const data = {};
for (const [k, sql] of Object.entries(tables)) data[k] = q(sql);

mkdirSync('chats-export', { recursive: true });
writeFileSync(`chats-export/${name}.json`, JSON.stringify(data, null, 2));

const berlin = (iso) => new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const msgs = [
  ...data.athlete_notes.map((n) => ({ t: n.created_at, who: 'Janis', date: n.date, text: n.text })),
  ...data.coach_notes.map((n) => ({ t: n.created_at, who: `Coach (${n.author})`, date: n.date, text: n.text })),
].sort((a, b) => a.t.localeCompare(b.t));

let md = `# Chat-Export seit ${since}\n\n`;
for (const m of msgs) md += `### ${berlin(m.t)} – ${m.who} (für Tag ${m.date}, ${m.text.length} Zeichen)\n\n${m.text}\n\n`;
md += `\n## Abgehakt\n\n`;
for (const d of data.done) md += `- ${d.date} ${d.item_id} = ${d.value} (${berlin(d.done_at)})\n`;
md += `\n## Overrides\n\n`;
for (const o of data.overrides) md += `- ${o.date} ${o.field}: ${o.value} – ${o.reason || ''} (${berlin(o.created_at)})\n`;
md += `\n## Coach-Plan\n\n`;
for (const p of data.coach_plan) md += `- ${p.date} ${p.kind}: ${p.data}\n`;
md += `\n## Checks\n\n`;
for (const c of data.checks) md += `- ${JSON.stringify(c)}\n`;
md += `\n## Wellness\n\n`;
for (const c of data.wellness) md += `- ${JSON.stringify(c)}\n`;
md += `\n## Feedback\n\n`;
for (const c of data.feedback) md += `- ${JSON.stringify(c)}\n`;
md += `\n## Spot-Checks\n\n`;
for (const c of data.spot_checks) md += `- ${JSON.stringify(c)}\n`;
md += `\n## Läufe\n\n`;
for (const r of data.runs) md += `- ${r.date} ${r.workout || ''} ${Math.round((r.distance_m || 0) / 100) / 10} km, ${Math.round((r.duration_s || 0) / 60)} min, Puls ${r.hr_avg || '-'}, RPE ${r.rpe ?? '-'}, Schmerz ${r.pain ?? '-'} ${r.note || ''}\n`;
writeFileSync(`chats-export/${name}.md`, md);
console.log(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])));
