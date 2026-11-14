// Sofort-Coach: Claude antwortet direkt, wenn Janis schreibt, einen Lauf einträgt oder eine Nachfrage beantwortet.
// Braucht das Worker-Secret ANTHROPIC_API_KEY. Ohne Schlüssel passiert nichts (die Regel-Logik läuft trotzdem).
import Anthropic from '@anthropic-ai/sdk';
import { getDay, addDays, planWeek, PLAN } from '../../shared/plan.js';
import { adjust, weakSpots, AREAS } from '../../shared/coach.js';
import { spotStatus } from '../../shared/followup.js';
import { analyzeRun } from '../../shared/analysis.js';

const MAX_PER_DAY = 25; // Kostenbremse

const SYSTEM = `Du bist der persönliche Lauf- und Krafttrainer von Janis (14 Jahre, Garmin Forerunner 55). Du arbeitest wie ein sehr guter, aufmerksamer Vereinstrainer: du kennst seinen Plan, seine Läufe, seine Beschwerden und eure bisherigen Nachrichten.

So antwortest du:
- Deutsch, „du“, warm und klar. Höchstens 3 kurze Sätze, keine Listen, kein Fachchinesisch. Ein Emoji ist okay.
- Gehe genau auf das ein, was er gerade geschrieben oder gemacht hat. Wiederhole nichts, was du ihm schon geschrieben hast.
- Bei Schmerz oder komischem Gefühl: frag kurz nach (wo genau, wie stark 0–10, beim Laufen oder danach), wenn das noch unklar ist, und sag, was du anpasst.
- Training immer beidseitig, die betroffene Seite zuerst und mit einem Satz mehr.
- Schmerz bis 3/10, der am nächsten Morgen nicht schlimmer ist, ist okay. Darüber: Laufen ruhiger/kürzer. Ab 5/10, Hinken, Punkt am Knochen oder Schwellung nach Umknicken: kein Laufen und „Sag es deinen Eltern, eventuell zum Arzt.“ Keine Diagnosen.
- Lockere Läufe: Puls 154–162. Er läuft oft zu schnell – wenn ja, freundlich bremsen.
- Läufe nur ändern, wenn wirklich nötig, nie mehr Umfang als geplant. Verpasstes nicht nachholen.

Antworte ausschließlich im JSON-Format des Schemas.
- reply: deine Nachricht an Janis.
- push: true, wenn er die Nachricht sofort aufs Handy/die Uhr bekommen soll (fast immer true, wenn er dir geschrieben hat).
- focus: Körperstellen für extra Kraftübungen in den nächsten 7 Tagen (leer lassen, wenn nichts Neues). count 2 nur bei deutlichen oder wiederholten Beschwerden.
- run_change: Änderung für einen Lauftag (date leer lassen, wenn keine Änderung). workout nur aus der erlaubten Liste oder leer.`;

const SCHEMA = (areas, workouts) => ({
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'push', 'focus', 'focus_reason', 'run_change'],
  properties: {
    reply: { type: 'string' },
    push: { type: 'boolean' },
    focus: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['area', 'side', 'count'],
        properties: { area: { type: 'string', enum: areas }, side: { type: 'string', enum: ['rechts', 'links', 'beide'] }, count: { type: 'integer', enum: [1, 2] } },
      },
    },
    focus_reason: { type: 'string' },
    run_change: {
      type: 'object', additionalProperties: false, required: ['date', 'workout', 'runNote', 'reason'],
      properties: { date: { type: 'string' }, workout: { type: 'string', enum: ['', ...workouts] }, runNote: { type: 'string' }, reason: { type: 'string' } },
    },
  },
});

function compactRun(r, all) {
  const a = analyzeRun(r, all);
  return {
    datum: r.date, workout: r.workout, km: r.distance_m ? +(r.distance_m / 1000).toFixed(1) : null, min: r.duration_s ? Math.round(r.duration_s / 60) : null,
    puls: r.hr_avg, pulsMax: r.hr_max, kadenz: r.cadence, hm: r.ascent_m, gefuehl_1_10: r.rpe, schmerz: r.pain, wo: r.pain_where, seite: r.pain_side, notiz: r.note,
    auto: a ? `${a.verdict}: ${a.title}` : null, deineAnalyse: r.analysis || null,
  };
}

/** Lädt den Kontext und fragt Claude. trigger = was gerade passiert ist (Klartext). */
export async function coachReply(env, date, trigger, opts = {}) {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    // Kostenbremse
    const key = `ai_calls_${date}`;
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
    const used = Number(row?.value || 0);
    if (used >= MAX_PER_DAY) return null;
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, String(used + 1)).run();

    const from = addDays(date, -21);
    const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then((r) => r.results);
    const [runs, checks, notes, mine, plan, spotChecks, wellness, feedback] = await Promise.all([
      q('SELECT * FROM runs WHERE date >= ? ORDER BY date, id', addDays(date, -60)),
      q('SELECT * FROM checks WHERE date >= ? ORDER BY date', from),
      q('SELECT date, text, created_at FROM coach_notes WHERE date >= ? ORDER BY id', from),
      q('SELECT date, text, created_at FROM athlete_notes WHERE date >= ? ORDER BY id', from),
      q('SELECT * FROM coach_plan WHERE date >= ? ORDER BY date', addDays(date, -10)),
      q('SELECT * FROM spot_checks WHERE date >= ? ORDER BY date, id', from),
      q('SELECT * FROM wellness WHERE date >= ? ORDER BY date', addDays(date, -7)),
      q('SELECT * FROM feedback WHERE date >= ? ORDER BY date', from),
    ]);
    const data = { runs, checks, athleteNotes: mine, coachPlan: plan, spotChecks, wellness, feedback, manual: [] };
    const days = [];
    for (let i = 0; i <= 6; i++) {
      const d = addDays(date, i);
      const a = adjust(d, data);
      const day = getDay(d, { overrides: a.overrides });
      days.push({ datum: d, typ: day.type, titel: day.title, workout: day.workout, angepasst: day.reasons, extraUebungen: day.items.filter((it) => it.extra).map((it) => it.name) });
    }
    const verlauf = [
      ...notes.map((n) => ({ t: n.created_at, von: 'Coach (du)', text: n.text })),
      ...mine.map((n) => ({ t: n.created_at, von: 'Janis', text: n.text })),
    ].sort((a, b) => a.t.localeCompare(b.t)).slice(-14);
    const ctxData = {
      heute: date, planWoche: planWeek(date), ampelHeute: adjust(date, data).ampel,
      naechste7Tage: days,
      laeufe: runs.filter((r) => r.date >= from).map((r) => compactRun(r, runs)),
      morgenChecks: checks.slice(-7),
      beschwerden: spotStatus(date, weakSpots(date, runs, checks, mine, spotChecks), spotChecks).map(({ area, side, count, last, lastAnswer, closed }) => ({ area, side, count, last, lastAnswer, closed })),
      schlafUndErholung: wellness,
      uebungsFeedback: feedback.slice(-10),
      nachrichtenVerlauf: verlauf,
    };

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const workouts = Object.keys(PLAN.workouts);
    const res = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA(Object.keys(AREAS), workouts) } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Daten (JSON):\n${JSON.stringify(ctxData)}\n\nGerade passiert: ${trigger}` }],
    });
    if (res.stop_reason === 'refusal') return null;
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const out = JSON.parse(text);

    const created = new Date().toISOString();
    if (out.reply && !opts.silent) {
      await env.DB.prepare("INSERT INTO coach_notes (date, text, author, created_at) VALUES (?, ?, 'claude', ?)").bind(date, out.reply.slice(0, 1500), created).run();
    }
    const sideOf = (s) => (s === 'rechts' ? 'rechts' : s === 'links' ? 'links' : null);
    if (out.focus?.length) {
      await env.DB.prepare('INSERT INTO coach_plan (date, kind, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(date, kind) DO UPDATE SET data = excluded.data, created_at = excluded.created_at')
        .bind(date, 'focus', JSON.stringify({ areas: out.focus.slice(0, 3).map((f) => ({ area: f.area, side: sideOf(f.side), count: f.count })), days: 7, reason: out.focus_reason || '' }), created).run();
    }
    const rc = out.run_change;
    if (rc?.date && /^\d{4}-\d{2}-\d{2}$/.test(rc.date) && rc.date >= date && rc.date <= addDays(date, 7) && getDay(rc.date).type === 'run') {
      await env.DB.prepare('INSERT INTO coach_plan (date, kind, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(date, kind) DO UPDATE SET data = excluded.data, created_at = excluded.created_at')
        .bind(rc.date, 'run', JSON.stringify({ workout: rc.workout || undefined, runNote: rc.runNote || undefined, reason: rc.reason || '' }), created).run();
    }
    if (out.push && !opts.quiet && opts.sendPush) await opts.sendPush({ title: 'Dein Coach', body: out.reply.slice(0, 140), url: './#heute' });
    return out;
  } catch (e) {
    console.log('coachReply', e.message);
    return null;
  }
}
