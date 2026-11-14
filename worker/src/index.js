// Laufcoach-API (Cloudflare Worker + D1)
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { getDay, berlinDate, berlinTime, addDays, diffDays, morningText, previewText, weekday, planWeek, PLAN } from '../../shared/plan.js';
import { adjust, weekReport, parseNote, weakSpots, AREAS } from '../../shared/coach.js';
import { analyzeRun } from '../../shared/analysis.js';
import { spotStatus, ANSWERS } from '../../shared/followup.js';
import { coachReply } from './ai.js';

const followupsFor = (date, data) => spotStatus(date, weakSpots(date, data.runs, data.checks, data.athleteNotes, data.spotChecks), data.spotChecks);
// Sofort-Antwort von Claude, höchstens ~25 s warten
const askCoach = (env, date, trigger, opts = {}) => Promise.race([
  coachReply(env, date, trigger, { ...opts, sendPush: (p) => sendPush(env, p) }),
  new Promise((r) => setTimeout(() => r(null), 25000)),
]);

const enc = new TextEncoder();
const now = () => new Date().toISOString();

// ---------- Hilfen ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function sha256Hex(text) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function makeToken(env, scope = 'app', days = 365) {
  const payload = b64url(enc.encode(JSON.stringify({ s: scope, exp: Date.now() + days * 86400000 })));
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}
async function verifyToken(env, token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!safeEqual(sig, await hmac(env.SESSION_SECRET, payload))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const ok = origin === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const int = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
const str = (v, max = 2000) => (v == null || v === '' ? null : String(v).slice(0, max));

// ---------- Daten laden ----------
async function loadData(env, until) {
  const from = addDays(until, -60);
  const [checks, runs, feedback, manual, coachPlan, athleteNotes, spotChecks, wellness] = await Promise.all([
    env.DB.prepare('SELECT * FROM checks WHERE date >= ? ORDER BY date').bind(from).all(),
    env.DB.prepare('SELECT * FROM runs WHERE date >= ? ORDER BY date, id').bind(from).all(),
    env.DB.prepare('SELECT * FROM feedback WHERE date >= ? ORDER BY date, id').bind(from).all(),
    env.DB.prepare('SELECT * FROM overrides WHERE date >= ? ORDER BY id').bind(from).all(),
    env.DB.prepare('SELECT * FROM coach_plan WHERE date >= ? ORDER BY date').bind(from).all(),
    env.DB.prepare('SELECT * FROM athlete_notes WHERE date >= ? ORDER BY id').bind(from).all(),
    env.DB.prepare('SELECT * FROM spot_checks WHERE date >= ? ORDER BY date, id').bind(from).all(),
    env.DB.prepare('SELECT * FROM wellness WHERE date >= ? ORDER BY date').bind(from).all(),
  ]);
  return { checks: checks.results, runs: runs.results, feedback: feedback.results, manual: manual.results, coachPlan: coachPlan.results, athleteNotes: athleteNotes.results, spotChecks: spotChecks.results, wellness: wellness.results };
}
async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    push: s.push !== '0',
    morningWeek: s.morningWeek || '06:45',
    morningWeekend: s.morningWeekend || '08:30',
    fpFree: s.fpFree ? Number(s.fpFree) : null,
    fpLinks: s.fpLinks ? JSON.parse(s.fpLinks) : {},
    onboarded: s.onboarded === '1',
  };
}
async function dayFor(env, date, data, settings, opts = {}) {
  const a = adjust(date, data);
  const day = getDay(date, { overrides: a.overrides, fpFree: settings.fpFree ?? undefined, mini: opts.mini });
  return { day, ampel: a.ampel, messages: a.messages };
}

// ---------- Push ----------
async function sendPush(env, payload) {
  const { results } = await env.DB.prepare('SELECT * FROM push_subs').all();
  const vapid = { subject: env.VAPID_SUBJECT || 'mailto:laufcoach@example.com', publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  let sent = 0;
  for (const row of results) {
    const sub = { endpoint: row.endpoint, expirationTime: null, keys: JSON.parse(row.keys_json) };
    try {
      const req = await buildPushPayload({ data: JSON.stringify(payload), options: { ttl: 3600 * 6, urgency: 'high' } }, sub, vapid);
      const res = await fetch(sub.endpoint, req);
      if (res.status === 404 || res.status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(row.endpoint).run();
      else if (res.ok) sent++;
    } catch (e) { console.log('push error', e.message); }
  }
  return sent;
}
async function onceToday(env, key) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO push_log (key, sent_at) VALUES (?, ?)').bind(key, now()).run();
  return r.meta.changes > 0;
}
const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

async function cron(env) {
  const settings = await getSettings(env);
  if (!settings.push) return;
  const date = berlinDate();
  const { hour, minute } = berlinTime();
  const t = hour * 60 + minute;
  const wd = weekday(date);
  const due = (hhmm) => t >= minutes(hhmm) && t < minutes(hhmm) + 60;
  const data = await loadData(env, addDays(date, 1));
  const { day } = await dayFor(env, date, data, settings);
  if (day.type === 'before') return;

  const morning = wd === 0 || wd === 6 ? settings.morningWeekend : settings.morningWeek;
  if (due(morning) && (await onceToday(env, `${date}:morning`))) {
    let body = morningText(day);
    if (day.adjusted || (day.reasons && day.reasons.length)) body += ' (angepasst)';
    if (day.dailyReminder) body += ` · ${day.dailyReminder}`;
    await sendPush(env, { title: body, body: day.reasons[0] || day.note || '', url: './#heute' });
    if (wd === 1 && planWeek(date) >= 2) {
      await sendPush(env, { title: 'Wie ist die Hocke nach dem langen Lauf?', body: 'Kurz den Morgen-Check machen – entscheidet über +1 km.', url: './#check' });
    }
  }
  const { results: doneRows } = await env.DB.prepare('SELECT item_id FROM done WHERE date = ?').bind(date).all();
  const runToday = data.runs.some((r) => r.date === date);
  if (due('17:30') && ['run', 'strength', 'fp'].includes(day.type) && !doneRows.length && !runToday && (await onceToday(env, `${date}:remind`))) {
    await sendPush(env, { title: `Noch offen: ${day.title}`, body: 'Du schaffst das. Kurz die App öffnen.', url: './#heute' });
  }
  if (wd === 0 && due('19:00') && planWeek(date) >= 1 && (await onceToday(env, `${date}:report`))) {
    await sendPush(env, { title: 'Dein Wochenbericht ist da 📊', body: 'Was lief gut, was kommt nächste Woche.', url: './#bericht' });
  }
  const checkToday = data.checks.some((c) => c.date === date);
  if (due('15:00') && day.type === 'run' && !checkToday && !runToday && (await onceToday(env, `${date}:precheck`))) {
    await sendPush(env, { title: 'Vor dem Lauf: Wie geht es dir?', body: '30 Sekunden Check – dann weiß ich, ob heute alles passt.', url: `./#heute/${date}` });
  }
  if (due('20:00') && (await onceToday(env, `${date}:preview`))) {
    const tomorrow = addDays(date, 1);
    const { day: d2 } = await dayFor(env, tomorrow, data, settings);
    if (d2.type !== 'before') await sendPush(env, { title: previewText(d2), body: d2.reasons[0] || '', url: './#heute' });
  }
  if (due('20:30') && day.type === 'run' && !runToday && (await onceToday(env, `${date}:runlog`))) {
    await sendPush(env, { title: 'Wie war dein Lauf?', body: 'Kurz antippen: Gefühl und ob etwas wehtat.', url: `./#lauf/${date}` });
  }
}

// ---------- Strava ----------
async function stravaToken(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'strava'").first();
  if (!row) return null;
  let tok = JSON.parse(row.value);
  if (tok.expires_at * 1000 < Date.now() + 60000) {
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: tok.refresh_token }),
    });
    if (!res.ok) return null;
    const t = await res.json();
    tok = { ...tok, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at };
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('strava', ?)").bind(JSON.stringify(tok)).run();
  }
  return tok.access_token;
}
async function importStravaActivity(env, id) {
  const token = await stravaToken(env);
  if (!token) return 'no-token';
  const res = await fetch(`https://www.strava.com/api/v3/activities/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return `strava ${res.status}`;
  const a = await res.json();
  if (!['Run', 'TrailRun', 'VirtualRun'].includes(a.sport_type || a.type)) return 'not-run';
  const date = berlinDate(new Date(a.start_date));
  const planned = getDay(date);
  const workout = planned.type === 'run' ? planned.workout : 'Locker (frei)';
  const existing = await env.DB.prepare("SELECT id FROM runs WHERE date = ? AND (strava_id IS NULL) AND source = 'app' ORDER BY id DESC").bind(date).first();
  const vals = [a.moving_time ?? a.elapsed_time ?? null, Math.round(a.distance || 0) || null, int(a.average_heartrate), int(a.max_heartrate), a.average_cadence ? Math.round(a.average_cadence * 2) : null];
  if (existing) {
    // Eintrag aus der App (Gefühl, Schmerz) mit Strava-Werten ergänzen
    await env.DB.prepare('UPDATE runs SET duration_s = COALESCE(duration_s, ?), distance_m = COALESCE(distance_m, ?), hr_avg = COALESCE(hr_avg, ?), hr_max = COALESCE(hr_max, ?), cadence = COALESCE(cadence, ?), strava_id = ? WHERE id = ?')
      .bind(...vals, String(id), existing.id).run();
  } else {
    await env.DB.prepare("INSERT OR IGNORE INTO runs (date, workout, duration_s, distance_m, hr_avg, hr_max, cadence, source, strava_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'strava', ?, ?, ?)")
      .bind(date, workout, ...vals, String(id), str(a.name, 200), now()).run();
  }
  return 'ok';
}

// ---------- Router ----------
async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const ch = cors(env, req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });
  const reply = (d, s = 200) => json(d, s, ch);

  if (path === '/' || path === '/health') return reply({ ok: true, name: 'laufcoach-api' });

  // Strava-Webhook (öffentlich, von Strava aufgerufen)
  if (path === '/strava/webhook') {
    if (req.method === 'GET') {
      if (url.searchParams.get('hub.verify_token') !== env.STRAVA_VERIFY_TOKEN) return new Response('no', { status: 403 });
      return json({ 'hub.challenge': url.searchParams.get('hub.challenge') });
    }
    const ev = await req.json().catch(() => null);
    if (ev && ev.object_type === 'activity' && (ev.aspect_type === 'create' || ev.aspect_type === 'update')) ctx.waitUntil(importStravaActivity(env, ev.object_id));
    return new Response('ok');
  }
  if (path === '/strava/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') || '';
    if ((await verifyToken(env, state))?.s !== 'strava') return new Response('Nicht angemeldet. Bitte aus der App heraus verbinden.', { status: 401 });
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, code, grant_type: 'authorization_code' }),
    });
    if (!res.ok) return new Response('Strava-Verbindung fehlgeschlagen.', { status: 400 });
    const t = await res.json();
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('strava', ?)").bind(JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, athlete: t.athlete?.id })).run();
    return Response.redirect(`${env.ALLOWED_ORIGIN}/laufcoach/#einstellungen`, 302);
  }

  // Login
  if (path === '/wellness/in') {
    // Schlaf vom iPhone-Kurzbefehl (Apple Health). Eigener Schlüssel, kann nur Schlafdaten schreiben.
    const k = url.searchParams.get('k') || '';
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'wellnessKey'").first();
    if (!row || !safeEqual(k, row.value)) return new Response('Link ungültig – bitte in der App neu kopieren.', { status: 401 });
    const raw = req.method === 'POST' ? await req.text() : '';
    let b = {};
    try { b = raw ? JSON.parse(raw) : {}; } catch { b = { sleep: raw }; }
    for (const [key, v] of url.searchParams) if (key !== 'k' && b[key] == null) b[key] = v;
    const num = (v) => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };
    // Schlaf: Sekunden (> 1000), Stunden (< 24) oder Minuten
    let s = num(b.sleep_min ?? b.sleep ?? b.schlaf);
    if (s != null) s = s > 1000 ? Math.round(s / 60) : s < 24 ? Math.round(s * 60) : Math.round(s);
    if (s != null && (s < 60 || s > 960)) s = null;
    const rhr = num(b.rhr ?? b.ruhepuls); const hrv = num(b.hrv);
    const day = isDate(b.date) ? b.date : berlinDate();
    if (s == null && !rhr && !hrv) return new Response('Keine Werte gefunden. Kommt der Schlaf in Apple Health an?', { status: 400 });
    await env.DB.prepare('INSERT INTO wellness (date, sleep_min, rhr, hrv, source, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET sleep_min = COALESCE(excluded.sleep_min, sleep_min), rhr = COALESCE(excluded.rhr, rhr), hrv = COALESCE(excluded.hrv, hrv), source = excluded.source')
      .bind(day, s, rhr ? Math.round(rhr) : null, hrv ? Math.round(hrv) : null, 'iphone', now()).run();
    return new Response(`Laufcoach: ${s != null ? `Schlaf ${Math.floor(s / 60)} h ${s % 60} min gespeichert` : 'gespeichert'}${rhr ? `, Ruhepuls ${Math.round(rhr)}` : ''} ✓`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (path === '/auth' && req.method === 'POST') {
    const ip = req.headers.get('CF-Connecting-IP') || 'x';
    const since = Date.now() - 15 * 60000;
    await env.DB.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(Date.now() - 86400000).run();
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts > ?').bind(ip, since).first();
    if (n >= 5) return reply({ error: 'Zu viele Versuche. Warte 15 Minuten.' }, 429);
    const body = await req.json().catch(() => ({}));
    const code = String(body.code || '').trim().toUpperCase();
    const [salt, hash] = String(env.ACCESS_CODE_HASH || ':').split(':');
    if (code && hash && safeEqual(await sha256Hex(salt + code), hash)) {
      return reply({ token: await makeToken(env) });
    }
    await env.DB.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)').bind(ip, Date.now()).run();
    return reply({ error: `Falscher Code. Noch ${Math.max(0, 4 - n)} Versuche.` }, 401);
  }

  // Coach-Schnittstelle für Claude (eigener Token, nur lesen + Notiz schreiben)
  if (path.startsWith('/coach/')) {
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!env.COACH_TOKEN || !safeEqual(auth, env.COACH_TOKEN)) return reply({ error: 'unauthorized' }, 401);
    const date = berlinDate();
    if (path === '/coach/summary') {
      const weeks = Math.min(12, int(url.searchParams.get('weeks')) || 2);
      const from = addDays(date, -7 * weeks);
      const data = await loadData(env, date);
      const settings = await getSettings(env);
      const { results: done } = await env.DB.prepare('SELECT * FROM done WHERE date >= ? ORDER BY date').bind(from).all();
      const { results: notes } = await env.DB.prepare('SELECT * FROM coach_notes WHERE date >= ? ORDER BY id').bind(from).all();
      const today = await dayFor(env, date, data, settings);
      const next = [];
      for (let i = 1; i <= 7; i++) { const d = addDays(date, i); const x = await dayFor(env, d, data, settings); next.push({ date: d, type: x.day.type, title: x.day.title, workout: x.day.workout, reasons: x.day.reasons }); }
      return reply({ today: date, week: planWeek(date), ampel: today.ampel, todayPlan: { type: today.day.type, title: today.day.title, workout: today.day.workout, reasons: today.day.reasons }, messages: today.messages, next7: next,
        followups: followupsFor(date, data).map(({ area, side, count, last, lastAnswer, lastCheckDate, closed, due }) => ({ area, side, count, last, lastAnswer, lastCheckDate, closed, due })),
        spotChecks: data.spotChecks.filter((c) => c.date >= from), wellness: data.wellness.filter((w) => w.date >= from),
        runs: data.runs.filter((r) => r.date >= from).map((r) => ({ ...r, auto: analyzeRun(r, data.runs) })), coachPlan: data.coachPlan.filter((c) => c.date >= addDays(date, -7)), athleteNotes: data.athleteNotes.filter((n) => n.date >= from),
        allowed: { focusAreas: Object.keys(PLAN.extraExercises), workouts: Object.keys(PLAN.workouts), exerciseIds: [...PLAN.strength.A.exercises, ...PLAN.strength.B.exercises].map((e) => `${e.id} ${e.name}`) }, checks: data.checks.filter((c) => c.date >= from), feedback: data.feedback.filter((f) => f.date >= from), overrides: data.manual.filter((m) => m.date >= from), done, notes });
    }
    if (path === '/coach/note' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const text = str(b.text, 1500);
      if (!text) return reply({ error: 'text fehlt' }, 400);
      await env.DB.prepare("INSERT INTO coach_notes (date, text, author, created_at) VALUES (?, ?, 'claude', ?)").bind(isDate(b.date) ? b.date : date, text, now()).run();
      if (b.push) await sendPush(env, { title: 'Nachricht von deinem Coach', body: text.slice(0, 120), url: './#heute' });
      return reply({ ok: true });
    }
    if (path === '/coach/runs' && req.method === 'POST') {
      // Läufe importieren (z. B. aus Garmin/Tredict durch die Claude-Routine)
      const b = await req.json().catch(() => ({}));
      let added = 0; let lastDate = null;
      const impData = await loadData(env, addDays(date, 1));
      const impSettings = await getSettings(env);
      for (const r of (b.runs || []).slice(0, 50)) {
        if (!isDate(r.date) || !r.ext_id) continue;
        const planned = (await dayFor(env, r.date, impData, impSettings)).day;
        if (!lastDate || r.date > lastDate) lastDate = r.date;
        const workout = r.workout && PLAN.workouts[r.workout] ? r.workout : planned.type === 'run' ? planned.workout : 'Locker (frei)';
        const ext = `ext:${String(r.ext_id).replace(/^ext:/, '').slice(0, 80)}`;
        const known = await env.DB.prepare('SELECT id FROM runs WHERE strava_id IN (?, ?)').bind(ext, ext.slice(4)).first();
        const rpe = r.rpe != null && Number.isFinite(Number(r.rpe)) ? Math.max(1, Math.min(10, Math.round(Number(r.rpe)))) : null;
        const enjoyment = r.enjoyment != null && Number.isFinite(Number(r.enjoyment)) ? Number(r.enjoyment) : null;
        if (known) {
          if (rpe || enjoyment) await env.DB.prepare('UPDATE runs SET rpe = COALESCE(rpe, ?), enjoyment = COALESCE(enjoyment, ?) WHERE id = ?').bind(rpe, enjoyment, known.id).run();
          continue;
        }
        const appRun = await env.DB.prepare("SELECT id FROM runs WHERE date = ? AND strava_id IS NULL AND source = 'app' ORDER BY id DESC").bind(r.date).first();
        const vals = [int(r.duration_s), int(r.distance_m), int(r.hr_avg), int(r.hr_max), int(r.cadence), int(r.ascent_m)];
        if (appRun) {
          await env.DB.prepare('UPDATE runs SET duration_s = COALESCE(duration_s, ?), distance_m = COALESCE(distance_m, ?), hr_avg = COALESCE(hr_avg, ?), hr_max = COALESCE(hr_max, ?), cadence = COALESCE(cadence, ?), ascent_m = COALESCE(ascent_m, ?), rpe = COALESCE(rpe, ?), enjoyment = COALESCE(enjoyment, ?), strava_id = ? WHERE id = ?').bind(...vals, rpe, enjoyment, ext, appRun.id).run();
        } else {
          await env.DB.prepare("INSERT OR IGNORE INTO runs (date, workout, duration_s, distance_m, hr_avg, hr_max, cadence, ascent_m, rpe, enjoyment, source, strava_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'garmin', ?, ?)").bind(r.date, workout, ...vals, rpe, enjoyment, ext, now()).run();
        }
        added++;
      }
      if (added && b.push) await sendPush(env, { title: 'Wie war dein Lauf? 🏃', body: 'Dein Lauf ist da. Kurz antippen, wie es sich angefühlt hat.', url: `./#heute/${lastDate || date}` });
      return reply({ ok: true, added });
    }
    if (path === '/coach/wellness' && req.method === 'POST') {
      // Schlaf, HRV, Ruhepuls (Tredict-Vollzugang oder iPhone-Kurzbefehl)
      const b = await req.json().catch(() => ({}));
      let n = 0;
      for (const w of (b.days || []).slice(0, 60)) {
        if (!isDate(w.date)) continue;
        await env.DB.prepare('INSERT INTO wellness (date, sleep_min, sleep_base, hrv, hrv_base, rhr, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET sleep_min = COALESCE(excluded.sleep_min, sleep_min), sleep_base = COALESCE(excluded.sleep_base, sleep_base), hrv = COALESCE(excluded.hrv, hrv), hrv_base = COALESCE(excluded.hrv_base, hrv_base), rhr = COALESCE(excluded.rhr, rhr), source = excluded.source')
          .bind(w.date, int(w.sleep_min), int(w.sleep_base), int(w.hrv), int(w.hrv_base), int(w.rhr), str(w.source || 'coach', 30), now()).run();
        n++;
      }
      return reply({ ok: true, saved: n });
    }
    if (path === '/coach/analysis' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const text = str(b.text, 1500);
      if (!text || !b.run_id) return reply({ error: 'run_id und text nötig' }, 400);
      await env.DB.prepare('UPDATE runs SET analysis = ? WHERE id = ?').bind(text, int(b.run_id)).run();
      return reply({ ok: true });
    }
    if (path === '/coach/plan' && req.method === 'POST') {
      // Personalisierte Anpassungen: kind = focus | run | strength
      const b = await req.json().catch(() => ({}));
      if (!isDate(b.date) || !['focus', 'run', 'strength'].includes(b.kind) || typeof b.data !== 'object') return reply({ error: 'date, kind (focus|run|strength), data nötig' }, 400);
      if (b.kind === 'run' && b.data.workout && !PLAN.workouts[b.data.workout]) return reply({ error: 'unbekanntes Workout', allowed: Object.keys(PLAN.workouts) }, 400);
      await env.DB.prepare('INSERT OR REPLACE INTO coach_plan (date, kind, data, created_at) VALUES (?, ?, ?, ?)').bind(b.date, b.kind, JSON.stringify(b.data).slice(0, 4000), now()).run();
      return reply({ ok: true });
    }
    if (path === '/coach/override' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      if (!isDate(b.date) || !['workout', 'runNote', 'pause'].includes(b.field)) return reply({ error: 'date/field ungültig' }, 400);
      if (b.field === 'workout' && !PLAN.workouts[b.value]) return reply({ error: 'unbekanntes Workout' }, 400);
      await env.DB.prepare('INSERT INTO overrides (date, field, value, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(b.date, b.field, str(b.value, 300), str(b.reason, 300) || 'Von Claude angepasst.', now()).run();
      return reply({ ok: true });
    }
    return reply({ error: 'not found' }, 404);
  }

  // Ab hier nur mit App-Token
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const session = await verifyToken(env, token);
  if (!session || (session.s && session.s !== 'app')) return reply({ error: 'unauthorized' }, 401);

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const qDate = url.searchParams.get('date');
  const date = isDate(qDate) ? qDate : isDate(body.date) ? body.date : berlinDate();

  if (path === '/day' && req.method === 'GET') {
    const settings = await getSettings(env);
    const data = await loadData(env, addDays(date, 1));
    const mini = url.searchParams.get('mini') === '1';
    const { day, ampel, messages } = await dayFor(env, date, data, settings, { mini });
    const { results: done } = await env.DB.prepare('SELECT item_id, value FROM done WHERE date = ?').bind(date).all();
    const { results: notes } = await env.DB.prepare('SELECT * FROM coach_notes WHERE date >= ? ORDER BY id DESC LIMIT 3').bind(addDays(date, -3)).all();
    const fb = data.feedback.filter((f) => f.date === date);
    return reply({ day, ampel, messages, done: Object.fromEntries(done.map((d) => [d.item_id, d.value])), check: data.checks.find((c) => c.date === date) || null,
      followups: followupsFor(date, data).filter((f) => f.due).slice(0, 2).map((f) => ({ area: f.area, side: f.side, question: f.question })),
      wellness: data.wellness.find((w) => w.date === date) || null,
      runs: data.runs.filter((r) => r.date === date).map((r) => ({ ...r, auto: analyzeRun(r, data.runs) })), notes, myNotes: data.athleteNotes.filter((n) => n.date === date), feedback: Object.fromEntries(fb.map((f) => [f.ex_id, f.value])), settings: { fpFree: settings.fpFree, fpLinks: settings.fpLinks, onboarded: settings.onboarded } });
  }
  if (path === '/week' && req.method === 'GET') {
    const settings = await getSettings(env);
    const mon = addDays(date, -((weekday(date) + 6) % 7));
    const data = await loadData(env, addDays(mon, 7));
    const { results: done } = await env.DB.prepare('SELECT date, item_id FROM done WHERE date >= ? AND date <= ?').bind(mon, addDays(mon, 6)).all();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(mon, i);
      const { day } = await dayFor(env, d, data, settings);
      const ids = done.filter((x) => x.date === d).map((x) => x.item_id);
      const ran = data.runs.some((r) => r.date === d);
      const total = day.items.filter((it) => it.kind !== 'check').length;
      days.push({ date: d, label: day.label, type: day.type, title: day.title, workout: day.workout, adjusted: !!day.adjusted || day.reasons.length > 0, done: ids.length, total, ran,
        complete: day.type === 'run' ? ran : day.type === 'strength' || day.type === 'fp' ? total > 0 && ids.length >= Math.ceil(total * 0.6) : false });
    }
    return reply({ week: planWeek(mon), days });
  }
  if (path === '/done' && req.method === 'POST') {
    const item = str(body.item_id, 80);
    if (!item) return reply({ error: 'item_id fehlt' }, 400);
    const value = int(body.value) ?? 1;
    if (value <= 0) await env.DB.prepare('DELETE FROM done WHERE date = ? AND item_id = ?').bind(date, item).run();
    else await env.DB.prepare('INSERT OR REPLACE INTO done (date, item_id, value, done_at) VALUES (?, ?, ?, ?)').bind(date, item, value, now()).run();
    return reply({ ok: true });
  }
  if (path === '/feedback' && req.method === 'POST') {
    const ex = str(body.ex_id, 40);
    if (!ex || !['leicht', 'schwer', 'ok'].includes(body.value)) return reply({ error: 'ungültig' }, 400);
    await env.DB.prepare('DELETE FROM feedback WHERE date = ? AND ex_id = ?').bind(date, ex).run();
    if (body.value !== 'ok') await env.DB.prepare('INSERT INTO feedback (date, ex_id, value, created_at) VALUES (?, ?, ?, ?)').bind(date, ex, body.value, now()).run();
    return reply({ ok: true });
  }
  if (path === '/spotcheck' && req.method === 'POST') {
    // Antwort auf die Nachfrage, z. B. Wie geht es deinem rechten Schienbein?
    const area = str(body.area, 30);
    const answer = str(body.answer, 20);
    if (!AREAS[area] || !ANSWERS[answer]) return reply({ error: 'area/answer ungültig' }, 400);
    await env.DB.prepare('INSERT INTO spot_checks (date, area, side, answer, created_at) VALUES (?, ?, ?, ?, ?)').bind(date, area, str(body.side, 10) || null, answer, now()).run();
    const text = {
      weg: 'Super, dass es weg ist! Die Extra-Übungen machst du noch eine Woche zur Vorbeugung, dann fallen sie weg.',
      besser: 'Gut, es wird besser. Die Extra-Übungen bleiben, ich frage in 2 Tagen nochmal.',
      gleich: 'Okay, ich behalte es im Blick. Die Extra-Übungen bleiben, ich frage morgen wieder.',
      schlimmer: 'Danke, dass du es sagst. Dein nächster Lauf wird vorsichtiger. Bleibt es so: Sag es deinen Eltern.',
    }[answer];
    ctx.waitUntil(askCoach(env, date, `Antwort auf Nachfrage: ${area}${body.side ? ' ' + body.side : ''} ist „${answer}“.`, { quiet: answer === 'besser' || answer === 'weg' }));
    return reply({ ok: true, text });
  }
  if (path === '/note' && req.method === 'POST') {
    // Nachricht von Janis an den Coach (Gefühl, Zwicken, Fragen)
    const text = str(body.text, 1000);
    if (!text) return reply({ error: 'Text fehlt' }, 400);
    await env.DB.prepare('INSERT INTO athlete_notes (date, text, created_at) VALUES (?, ?, ?)').bind(date, text, now()).run();
    const settings = await getSettings(env);
    const data = await loadData(env, addDays(date, 8));
    const parsed = parseNote(text);
    const upcoming = [];
    for (let i = 0; i <= 7 && upcoming.length < 2; i++) {
      const d = addDays(date, i);
      const { day } = await dayFor(env, d, data, settings);
      if (day.type === 'strength' && day.items.some((it) => it.extra)) upcoming.push({ label: day.label, extras: day.items.filter((it) => it.extra).map((it) => it.name) });
    }
    const ai = await askCoach(env, date, `Janis schreibt dir: „${text}“`, { quiet: true });
    return reply({ ok: true, areas: parsed.areas, upcoming, coach: ai?.reply || null });
  }
  if (path === '/check' && req.method === 'POST') {
    await env.DB.prepare('INSERT OR REPLACE INTO checks (date, squat, shin, hop, bone, limp, sick, rhr, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(date, int(body.squat), int(body.shin), int(body.hop), body.bone ? 1 : 0, body.limp ? 1 : 0, body.sick ? 1 : 0, int(body.rhr), now()).run();
    return reply({ ok: true });
  }
  if (path === '/run' && req.method === 'POST') {
    const where = Array.isArray(body.pain_where) ? body.pain_where.join(',') : str(body.pain_where, 100);
    const parsed = parseNote(body.note || '');
    const finalWhere = where || ((int(body.pain) ?? 0) >= 2 && parsed.areas.length ? parsed.areas.join(',') : null);
    if (!body.id) {
      const open = await env.DB.prepare('SELECT id FROM runs WHERE date = ? AND rpe IS NULL AND pain IS NULL ORDER BY id DESC').bind(date).first();
      if (open) body.id = open.id;
    }
    if (body.id) {
      await env.DB.prepare('UPDATE runs SET workout=COALESCE(?, workout), duration_s=COALESCE(?, duration_s), distance_m=COALESCE(?, distance_m), hr_avg=COALESCE(?, hr_avg), hr_max=COALESCE(?, hr_max), cadence=COALESCE(?, cadence), test_value=?, rpe=?, pain=?, pain_where=?, pain_side=?, pain_when=?, pain_gone=?, note=? WHERE id=?')
        .bind(str(body.workout, 60), int(body.duration_s), int(body.distance_m), int(body.hr_avg), int(body.hr_max), int(body.cadence), str(body.test_value, 20), int(body.rpe), int(body.pain), finalWhere, str(body.pain_side, 10), str(body.pain_when, 10), str(body.pain_gone, 10), str(body.note), int(body.id)).run();
    } else {
      await env.DB.prepare('INSERT INTO runs (date, workout, duration_s, distance_m, hr_avg, hr_max, cadence, test_value, rpe, pain, pain_where, pain_side, pain_when, pain_gone, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(date, str(body.workout, 60), int(body.duration_s), int(body.distance_m), int(body.hr_avg), int(body.hr_max), int(body.cadence), str(body.test_value, 20), int(body.rpe), int(body.pain), finalWhere, str(body.pain_side, 10), str(body.pain_when, 10), str(body.pain_gone, 10), str(body.note), 'app', now()).run();
    }
    // Antwort vom Coach: was passiert jetzt?
    const settings = await getSettings(env);
    const data = await loadData(env, addDays(date, 8));
    const upcoming = [];
    for (let i = 1; i <= 7; i++) {
      const d = addDays(date, i);
      const { day } = await dayFor(env, d, data, settings);
      if (day.reasons.length) upcoming.push({ date: d, label: day.label, title: day.title, reasons: day.reasons });
    }
    const next = adjust(addDays(date, 1), data);
    const ai = await askCoach(env, date, `Janis hat gerade seinen Lauf eingetragen: ${JSON.stringify({ workout: body.workout, km: body.distance_m ? body.distance_m / 1000 : null, puls: body.hr_avg, gefuehl: body.rpe, schmerz: body.pain, wo: finalWhere, seite: body.pain_side, wann: body.pain_when, schnellWeg: body.pain_gone, notiz: body.note })}`, { quiet: true });
    return reply({ ok: true, coach: ai?.reply || null, upcoming: upcoming.slice(0, 3), messages: next.messages, ampel: next.ampel });
  }
  if (path === '/run/feel' && req.method === 'POST') {
    // Kurz nach dem Lauf: Wie war's? (nur Gefühl + Schmerz, Garmin-Daten bleiben)
    const id = int(body.id);
    if (!id) return reply({ error: 'id fehlt' }, 400);
    const where = Array.isArray(body.pain_where) ? body.pain_where.join(',') : str(body.pain_where, 100);
    await env.DB.prepare('UPDATE runs SET rpe = COALESCE(?, rpe), pain = COALESCE(?, pain), pain_where = COALESCE(?, pain_where), pain_side = COALESCE(?, pain_side), pain_gone = COALESCE(?, pain_gone), note = COALESCE(?, note) WHERE id = ?')
      .bind(int(body.rpe), int(body.pain), where || null, str(body.pain_side, 10) || null, str(body.pain_gone, 10) || null, str(body.note) || null, id).run();
    const r = await env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(id).first();
    const ai = await askCoach(env, date, `Janis sagt nach dem Lauf vom ${r?.date}: Gefühl ${body.rpe ?? '-'}/10, Schmerz ${body.pain ?? 0}/10${where ? ' an ' + where : ''}${body.pain_side ? ' ' + body.pain_side : ''}${body.note ? ', Notiz: ' + body.note : ''}. Lauf-Daten: ${JSON.stringify({ workout: r?.workout, km: r?.distance_m ? r.distance_m / 1000 : null, puls: r?.hr_avg, kadenz: r?.cadence })}`, { quiet: true });
    return reply({ ok: true, coach: ai?.reply || null });
  }
  if (path === '/run' && req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM runs WHERE id = ?').bind(int(url.searchParams.get('id'))).run();
    return reply({ ok: true });
  }
  if (path === '/history' && req.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM runs ORDER BY date DESC, id DESC LIMIT 200').all();
    const asc = [...results].reverse();
    const hd = await loadData(env, date);
    const spots = followupsFor(date, hd).map(({ area, side, count, first, last, lastAnswer, closed }) => ({ area, side, count, first, last, lastAnswer, closed }));
    return reply({ runs: results.map((r) => ({ ...r, auto: analyzeRun(r, asc) })), spots });
  }
  if (path === '/report' && req.method === 'GET') {
    const data = await loadData(env, addDays(date, 1));
    const mon = addDays(date, -((weekday(date) + 6) % 7));
    const { results: done } = await env.DB.prepare('SELECT date, item_id FROM done WHERE date >= ? AND date <= ?').bind(mon, addDays(mon, 6)).all();
    const by = {};
    for (const d of done) (by[d.date] ||= []).push(d.item_id);
    return reply(weekReport(date, data, by));
  }
  if (path === '/move' && req.method === 'POST') {
    // „Heute verschieben“: Lauf 1 Tag später (Regeln: max. 1 Tag, Tempo/Lang nie hintereinander)
    const mvSettings = await getSettings(env);
    const mvData = await loadData(env, addDays(date, 3));
    const day = (await dayFor(env, date, mvData, mvSettings)).day;
    const tomorrow = addDays(date, 1);
    const t = (await dayFor(env, tomorrow, mvData, mvSettings)).day;
    if (day.type !== 'run' && day.type !== 'strength') return reply({ error: 'Heute gibt es nichts zu verschieben.' }, 400);
    const kind = day.type === 'run' ? PLAN.workouts[day.workout].kind : 'strength';
    const t2 = (await dayFor(env, addDays(date, 2), mvData, mvSettings)).day;
    const nextHard = t2.type === 'run' && ['tempo', 'long'].includes(PLAN.workouts[t2.workout].kind);
    const tomorrowHard = t.type === 'run' && ['tempo', 'long'].includes(PLAN.workouts[t.workout].kind);
    if (tomorrowHard || (['tempo', 'long'].includes(kind) && nextHard)) {
      return reply({ error: 'Verschieben geht nicht: Tempo und Lang dürfen nie an zwei Tagen hintereinander sein. Mach heute die Mini-Version oder lass es aus (nicht nachholen).' }, 400);
    }
    if (day.type === 'strength' && day.strengthKey === 'A' && t2.type === 'run' && ['tempo', 'long'].includes(PLAN.workouts[t2.workout].kind)) {
      return reply({ error: 'Beinkraft nie am Tag vor Tempo oder Lang. Mach heute die Mini-Version.' }, 400);
    }
    await env.DB.prepare('INSERT INTO overrides (date, field, value, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(date, 'moved', '1', `Auf morgen verschoben.`, now()).run();
    if (day.type === 'run') await env.DB.prepare('INSERT INTO overrides (date, field, value, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(tomorrow, 'addRun', day.workout, `Von gestern verschoben: ${day.workout}.`, now()).run();
    else await env.DB.prepare('INSERT INTO overrides (date, field, value, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(tomorrow, 'addSession', JSON.stringify({ key: day.strengthKey, probe: day.title === 'Kraft-A-Probe' }), `Von gestern verschoben: ${day.title}.`, now()).run();
    return reply({ ok: true });
  }
  if (path === '/settings') {
    if (req.method === 'POST') {
      const allowed = ['push', 'morningWeek', 'morningWeekend', 'fpFree', 'fpLinks', 'onboarded'];
      for (const [k, v] of Object.entries(body)) {
        if (!allowed.includes(k)) continue;
        const val = k === 'fpLinks' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
        await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(k, val).run();
      }
    }
    const s = await getSettings(env);
    const strava = await env.DB.prepare("SELECT value FROM settings WHERE key = 'strava'").first();
    let wk = (await env.DB.prepare("SELECT value FROM settings WHERE key = 'wellnessKey'").first())?.value;
    if (!wk) { wk = b64url(crypto.getRandomValues(new Uint8Array(18))); await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('wellnessKey', ?)").bind(wk).run(); }
    const lastW = await env.DB.prepare('SELECT * FROM wellness ORDER BY date DESC LIMIT 1').first();
    return reply({ ...s, wellnessUrl: `${url.origin}/wellness/in?k=${wk}`, lastWellness: lastW || null, strava: !!strava, stravaClientId: env.STRAVA_CLIENT_ID || null, vapidPublicKey: env.VAPID_PUBLIC_KEY || null });
  }
  if (path === '/strava/connect' && req.method === 'GET') {
    if (!env.STRAVA_CLIENT_ID) return reply({ error: 'Strava ist noch nicht eingerichtet.' }, 400);
    const state = await makeToken(env, 'strava', 1);
    const redirect = `${url.origin}/strava/callback`;
    return reply({ url: `https://www.strava.com/oauth/authorize?client_id=${env.STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirect)}&approval_prompt=auto&scope=activity:read_all&state=${encodeURIComponent(state)}` });
  }
  if (path === '/strava/sync' && req.method === 'POST') {
    const tokenS = await stravaToken(env);
    if (!tokenS) return reply({ error: 'Strava nicht verbunden.' }, 400);
    const after = Math.floor(Date.now() / 1000) - 14 * 86400;
    const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=30`, { headers: { Authorization: `Bearer ${tokenS}` } });
    if (!res.ok) return reply({ error: `Strava ${res.status}` }, 502);
    const list = await res.json();
    let n = 0;
    for (const a of list) {
      const known = await env.DB.prepare('SELECT id FROM runs WHERE strava_id = ?').bind(String(a.id)).first();
      if (!known && (await importStravaActivity(env, a.id)) === 'ok') n++;
    }
    return reply({ ok: true, imported: n });
  }
  if (path === '/push/subscribe' && req.method === 'POST') {
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys) return reply({ error: 'subscription fehlt' }, 400);
    await env.DB.prepare('INSERT OR REPLACE INTO push_subs (endpoint, keys_json, created_at) VALUES (?, ?, ?)').bind(sub.endpoint, JSON.stringify(sub.keys), now()).run();
    return reply({ ok: true });
  }
  if (path === '/push/test' && req.method === 'POST') {
    const n = await sendPush(env, { title: 'Test: Laufcoach funktioniert ✓', body: 'So sieht deine Nachricht auf der Uhr aus.', url: './#heute' });
    return reply({ ok: true, sent: n });
  }
  return reply({ error: 'not found' }, 404);
}

export default {
  async fetch(req, env, ctx) {
    try { return await handle(req, env, ctx); } catch (e) {
      console.log('error', e.stack || e.message);
      return json({ error: 'Serverfehler' }, 500, cors(env, req));
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cron(env));
  },
};
