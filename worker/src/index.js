// Laufcoach-API (Cloudflare Worker + D1)
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { getDay, berlinDate, berlinTime, addDays, diffDays, morningText, previewText, weekday, planWeek, PLAN } from '../../shared/plan.js';
import { adjust, weekReport, parseNote } from '../../shared/coach.js';

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
  const [checks, runs, feedback, manual] = await Promise.all([
    env.DB.prepare('SELECT * FROM checks WHERE date >= ? ORDER BY date').bind(from).all(),
    env.DB.prepare('SELECT * FROM runs WHERE date >= ? ORDER BY date, id').bind(from).all(),
    env.DB.prepare('SELECT * FROM feedback WHERE date >= ? ORDER BY date, id').bind(from).all(),
    env.DB.prepare('SELECT * FROM overrides WHERE date >= ? ORDER BY id').bind(from).all(),
  ]);
  return { checks: checks.results, runs: runs.results, feedback: feedback.results, manual: manual.results };
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
  if (due('20:00') && (await onceToday(env, `${date}:preview`))) {
    const tomorrow = addDays(date, 1);
    const { day: d2 } = await dayFor(env, tomorrow, data, settings);
    if (d2.type !== 'before') await sendPush(env, { title: previewText(d2), body: d2.reasons[0] || '', url: './#heute' });
  }
  if (due('20:30') && day.type === 'run' && !runToday && (await onceToday(env, `${date}:runlog`))) {
    await sendPush(env, { title: 'Trag kurz deinen Lauf ein', body: 'Dann passe ich morgen an.', url: './#lauf' });
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
    if (!(await verifyToken(env, state))) return new Response('Nicht angemeldet. Bitte aus der App heraus verbinden.', { status: 401 });
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
        runs: data.runs.filter((r) => r.date >= from), checks: data.checks.filter((c) => c.date >= from), feedback: data.feedback.filter((f) => f.date >= from), overrides: data.manual.filter((m) => m.date >= from), done, notes });
    }
    if (path === '/coach/note' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const text = str(b.text, 1500);
      if (!text) return reply({ error: 'text fehlt' }, 400);
      await env.DB.prepare("INSERT INTO coach_notes (date, text, author, created_at) VALUES (?, ?, 'claude', ?)").bind(isDate(b.date) ? b.date : date, text, now()).run();
      if (b.push) await sendPush(env, { title: 'Nachricht von deinem Coach', body: text.slice(0, 120), url: './#heute' });
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
  if (!session) return reply({ error: 'unauthorized' }, 401);

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
      runs: data.runs.filter((r) => r.date === date), notes, feedback: Object.fromEntries(fb.map((f) => [f.ex_id, f.value])), settings: { fpFree: settings.fpFree, fpLinks: settings.fpLinks, onboarded: settings.onboarded } });
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
  if (path === '/check' && req.method === 'POST') {
    await env.DB.prepare('INSERT OR REPLACE INTO checks (date, squat, shin, hop, bone, limp, sick, rhr, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(date, int(body.squat), int(body.shin), int(body.hop), body.bone ? 1 : 0, body.limp ? 1 : 0, body.sick ? 1 : 0, int(body.rhr), now()).run();
    return reply({ ok: true });
  }
  if (path === '/run' && req.method === 'POST') {
    const where = Array.isArray(body.pain_where) ? body.pain_where.join(',') : str(body.pain_where, 100);
    const parsed = parseNote(body.note || '');
    const finalWhere = where || ((int(body.pain) ?? 0) >= 2 && parsed.areas.length ? parsed.areas.join(',') : null);
    if (body.id) {
      await env.DB.prepare('UPDATE runs SET workout=?, duration_s=?, distance_m=?, hr_avg=?, hr_max=?, cadence=?, test_value=?, rpe=?, pain=?, pain_where=?, pain_side=?, pain_when=?, pain_gone=?, note=? WHERE id=?')
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
    return reply({ ok: true, upcoming: upcoming.slice(0, 3), messages: next.messages, ampel: next.ampel });
  }
  if (path === '/run' && req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM runs WHERE id = ?').bind(int(url.searchParams.get('id'))).run();
    return reply({ ok: true });
  }
  if (path === '/history' && req.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM runs ORDER BY date DESC, id DESC LIMIT 200').all();
    return reply({ runs: results });
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
    const day = getDay(date);
    const tomorrow = addDays(date, 1);
    const t = getDay(tomorrow);
    if (day.type !== 'run' && day.type !== 'strength') return reply({ error: 'Heute gibt es nichts zu verschieben.' }, 400);
    const kind = day.type === 'run' ? PLAN.workouts[day.workout].kind : 'strength';
    const t2 = getDay(addDays(date, 2));
    const nextHard = t2.type === 'run' && ['tempo', 'long'].includes(PLAN.workouts[t2.workout].kind);
    const tomorrowHard = t.type === 'run' && ['tempo', 'long'].includes(PLAN.workouts[t.workout].kind);
    if (tomorrowHard || (['tempo', 'long'].includes(kind) && nextHard)) {
      return reply({ error: 'Verschieben geht nicht: Tempo und Lang dürfen nie an zwei Tagen hintereinander sein. Mach heute die Mini-Version oder lass es aus (nicht nachholen).' }, 400);
    }
    if (day.type === 'strength' && day.strengthKey === 'A' && t2.type === 'run' && ['tempo', 'long'].includes(PLAN.workouts[t2.workout].kind)) {
      return reply({ error: 'Beinkraft nie am Tag vor Tempo oder Lang. Mach heute die Mini-Version.' }, 400);
    }
    await env.DB.prepare('INSERT INTO overrides (date, field, value, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(date, 'moved', '1', `Auf morgen verschoben.`, now()).run();
    if (day.type === 'run') await env.DB.prepare('INSERT INTO overrides (date, field, value, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(tomorrow, 'workout', day.workout, `Von gestern verschoben: ${day.workout}.`, now()).run();
    else await env.DB.prepare('INSERT INTO overrides (date, field, value, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(tomorrow, 'runNote', day.title, `Von gestern verschoben: ${day.title} heute zusätzlich machen.`, now()).run();
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
    return reply({ ...s, strava: !!strava, stravaClientId: env.STRAVA_CLIENT_ID || null, vapidPublicKey: env.VAPID_PUBLIC_KEY || null });
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
