// Sofort-Coach: Claude antwortet direkt, wenn Janis schreibt, einen Lauf einträgt oder eine Nachfrage beantwortet.
// Braucht das Worker-Secret ANTHROPIC_API_KEY. Ohne Schlüssel passiert nichts (die Regel-Logik läuft trotzdem).
import Anthropic from '@anthropic-ai/sdk';
import { getDay, addDays, planWeek, PLAN } from '../../shared/plan.js';
import { adjust, weakSpots, AREAS } from '../../shared/coach.js';
import { nextCoachRound } from '../../shared/config.js';
import { applyExTexts, buildExText, knownExId, normDone } from '../../shared/extexts.js';
import { spotStatus } from '../../shared/followup.js';
import { analyzeRun } from '../../shared/analysis.js';

const MAX_PER_DAY = 25; // Kostenbremse

const SYSTEM = `Du bist der persönliche Lauf- und Krafttrainer von Janis (14 Jahre, Garmin Forerunner 55). Du arbeitest wie ein sehr guter, aufmerksamer Vereinstrainer: du kennst seinen Plan, seine Läufe, seine Beschwerden und den GANZEN Chat der letzten 7 Tage.

So antwortest du:
- Deutsch, „du“, locker und klar. Höchstens 3–4 kurze Sätze, keine Listen, keine Tagesübersicht, kein Fachchinesisch, kein Englisch. Ein Emoji ist okay.
- Lies den ganzen Chatverlauf: Janis schreibt oft mehrere Nachrichten hintereinander und korrigiert sich („Übung 6, ich meine 5“). Antworte auf ALLE neuen Nachrichten seit deiner letzten Antwort, die neueste Korrektur zählt.
- Übungen ordnest du über die Liste uebungenHeute zu (nr = Nummer in der App, ab 1, dazu id und name). Ist unklar, welche gemeint ist, frag kurz nach („Meinst du Übung 5, Fußspitzen an der Wand?“). Nie raten.
- Diskutiere: Geh auf seine Argumente ein, erklär in einem Satz warum, und biete eine praktikable Lösung (Ersatzübung, ohne Gerät, kürzer, später am Tag) statt Absage oder Standardtext.
- Sagt Janis, eine Übung ist unklar: schreib eine bessere Erklärung in exercise_fix (Startposition ganz konkret: liegen/sitzen/stehen, worauf, wo Hände und Füße sind; 2–4 kurze Schritte, je Schritt eine Sache; woran er merkt, dass es richtig ist; häufigster Fehler; einfache Variante ohne Gerät). Sag ihm in der Antwort kurz, dass die App die Übung jetzt besser erklärt.
- Erwähne einen Lauf nur, wenn er von HEUTE ist oder Janis danach fragt. Nichts von gestern als neu verkaufen.
- Bei Schmerz: kurz nachfragen (wo genau, wie stark 0–10, beim Laufen oder danach), wenn das unklar ist. Anpassen statt absagen. Ab 5/10, Hinken, Punkt am Knochen oder Schwellung nach Umknicken: kein Laufen und „Sag es deinen Eltern, eventuell zum Arzt.“ Keine Diagnosen.
- Training immer beidseitig, die betroffene Seite zuerst und mit einem Satz mehr. Eine Kraft-Einheit dauert höchstens 60 min.
- Lockere Läufe: Puls 145–162. Läufe nur ändern, wenn wirklich nötig, nie mehr Umfang als geplant. Verpasstes nicht nachholen.

Antworte ausschließlich im JSON-Format des Schemas.
- reply: deine Nachricht an Janis.
- push: true, wenn er die Nachricht sofort aufs Handy/die Uhr bekommen soll.
- focus: Körperstellen für extra Kraftübungen in den nächsten 7 Tagen (leer lassen, wenn nichts Neues).
- run_change: Änderung für einen Lauftag (date leer lassen, wenn keine Änderung).
- exercise_fix: bessere Erklärung für eine Übung (exId leer lassen, wenn keine).`;

const SCHEMA = (areas, workouts) => ({
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'push', 'focus', 'focus_reason', 'run_change', 'exercise_fix'],
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
    exercise_fix: {
      type: 'object', additionalProperties: false, required: ['exId', 'start', 'steps', 'watch', 'mistake', 'easier'],
      properties: { exId: { type: 'string' }, start: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } }, watch: { type: 'string' }, mistake: { type: 'string' }, easier: { type: 'string' } },
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
    const [runs, checks, notes, mine, plan, spotChecks, wellness, feedback, doneRows] = await Promise.all([
      q('SELECT * FROM runs WHERE date >= ? ORDER BY date, id', addDays(date, -60)),
      q('SELECT * FROM checks WHERE date >= ? ORDER BY date', from),
      q('SELECT date, text, created_at FROM coach_notes WHERE date >= ? ORDER BY id', from),
      q('SELECT date, text, created_at FROM athlete_notes WHERE date >= ? ORDER BY id', from),
      q('SELECT * FROM coach_plan WHERE date >= ? ORDER BY date', addDays(date, -10)),
      q('SELECT * FROM spot_checks WHERE date >= ? ORDER BY date, id', from),
      q('SELECT * FROM wellness WHERE date >= ? ORDER BY date', addDays(date, -7)),
      q('SELECT * FROM feedback WHERE date >= ? ORDER BY date', from),
      q('SELECT * FROM done WHERE date >= ? ORDER BY date', addDays(date, -1)),
    ]);
    const manual = await q('SELECT * FROM overrides WHERE date >= ? ORDER BY id', addDays(date, -10));
    const setRows = await q("SELECT key, value FROM settings WHERE key IN ('fpFree', 'exTexts')");
    const fpFree = Number(setRows.find((r) => r.key === 'fpFree')?.value) || undefined;
    let exTexts = {};
    try { exTexts = JSON.parse(setRows.find((r) => r.key === 'exTexts')?.value || '{}'); } catch { exTexts = {}; }
    const data = { runs, checks, athleteNotes: mine, coachPlan: plan, spotChecks, wellness, feedback, manual };
    const days = [];
    for (let i = 0; i <= 6; i++) {
      const d = addDays(date, i);
      const a = adjust(d, data);
      const day = getDay(d, { overrides: a.overrides, fpFree });
      days.push({ datum: d, typ: day.type, titel: day.title, workout: day.workout, angepasst: day.reasons, extraUebungen: day.items.filter((it) => it.extra).map((it) => it.name) });
    }
    const verlauf = [
      ...notes.map((n) => ({ t: n.created_at, von: 'Coach (du)', text: n.text })),
      ...mine.map((n) => ({ t: n.created_at, von: 'Janis', text: n.text })),
    ].sort((a, b) => a.t.localeCompare(b.t)).filter((m) => m.t >= addDays(date, -7));
    const exOf = (d) => {
      const a2 = adjust(d, data);
      const day = applyExTexts(getDay(d, { overrides: a2.overrides, fpFree }), exTexts);
      const dn = normDone(day, doneRows.filter((r) => r.date === d));
      let n = 0;
      return { typ: day.type, titel: day.title, uebungen: day.items.filter((it) => it.kind === 'exercise').map((it) => ({ nr: ++n, id: it.exId, name: it.name, dosis: it.doseText, saetze: (it.setList || []).map((x) => x.label), abgehakt: dn[it.id] || 0 })) };
    };
    const heuteEx = exOf(date);
    const gesternEx = exOf(addDays(date, -1));
    const ctxData = {
      heute: date, jetzt: new Date().toISOString(), naechsteRoutine: nextCoachRound().text, planWoche: planWeek(date), ampelHeute: adjust(date, data).ampel,
      uebungenHeute: heuteEx, gestern: { ...gesternEx, laeufe: runs.filter((r) => r.date === addDays(date, -1)).map((r) => compactRun(r, runs)) },
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
      const old = await env.DB.prepare("SELECT data FROM coach_plan WHERE date = ? AND kind = 'focus'").bind(date).first();
      if (old) { try { for (const a of JSON.parse(old.data).areas || []) if (!out.focus.some((f) => f.area === a.area)) out.focus.push({ area: a.area, side: a.side || 'beide', count: a.count || 1 }); } catch { /* alt */ } }
      await env.DB.prepare('INSERT INTO coach_plan (date, kind, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(date, kind) DO UPDATE SET data = excluded.data, created_at = excluded.created_at')
        .bind(date, 'focus', JSON.stringify({ areas: out.focus.slice(0, 3).map((f) => ({ area: f.area, side: sideOf(f.side), count: f.count })), days: 7, reason: out.focus_reason || '' }), created).run();
    }
    const rc = out.run_change;
    if (rc?.date && /^\d{4}-\d{2}-\d{2}$/.test(rc.date) && rc.date >= date && rc.date <= addDays(date, 7) && getDay(rc.date).type === 'run') {
      await env.DB.prepare('INSERT INTO coach_plan (date, kind, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(date, kind) DO UPDATE SET data = excluded.data, created_at = excluded.created_at')
        .bind(rc.date, 'run', JSON.stringify({ workout: rc.workout || undefined, runNote: rc.runNote || undefined, reason: rc.reason || '' }), created).run();
    }
    const fx = out.exercise_fix;
    if (fx?.exId && knownExId(fx.exId) && (fx.start || fx.steps?.length)) {
      const name = heuteEx.uebungen.find((u) => u.id === fx.exId)?.name || null;
      const next = buildExText(exTexts[fx.exId], { ...fx, name, reason: 'Sofort-Coach' }, created);
      if (next && !next.error) {
        exTexts[fx.exId] = next;
        await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('exTexts', ?)").bind(JSON.stringify(exTexts)).run();
      }
    }
    if (out.push && !opts.quiet && opts.sendPush) await opts.sendPush({ title: 'Dein Coach', body: out.reply.slice(0, 140), url: './#heute' });
    return out;
  } catch (e) {
    console.log('coachReply', e.message);
    return null;
  }
}
