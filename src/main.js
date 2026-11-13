import './style.css';
import { api, getToken, setToken, AuthError, API } from './api.js';
import { PLAN, getDay, berlinDate, addDays, formatLong, planWeek, weekInfo, weekdayName, expectedFpWeek } from '../shared/plan.js';
import { parseTime } from '../shared/coach.js';
import { VAPID_PUBLIC_KEY } from './vapid-public.js';

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => berlinDate();
let state = { date: today(), data: null, mini: false };

// ---------- kleine Helfer ----------
function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function confetti() {
  const colors = ['#ff5b2e', '#1f9d63', '#f0b23a', '#4f7cff', '#e64aa8'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.6 + 's';
    c.style.animationDelay = Math.random() * 0.4 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4000);
  }
}
let audioCtx;
function beep(times = 2) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      const t0 = audioCtx.currentTime + i * 0.28;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.start(t0); o.stop(t0 + 0.24);
    }
  } catch { /* kein Ton */ }
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* egal */ }
}
const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const fmtSec = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ---------- Timer (Pause + Halten) ----------
let timer = null;
const SEQ_LABELS = ['Unterarmstütz', 'Seitstütz links', 'Seitstütz rechts'];
function startTimerSeq(list, i = 0) {
  if (i >= list.length) { toast('Runde geschafft!'); return; }
  startTimer(list[i], SEQ_LABELS[i] || 'Halten', () => { beep(1); startTimerSeq(list, i + 1); });
}
function startTimer(seconds, label, onDone) {
  stopTimer();
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* egal */ }
  const el = document.createElement('div');
  el.className = 'timer';
  let left = seconds;
  const end = Date.now() + seconds * 1000;
  el.innerHTML = `<span class="small">${esc(label)}</span><span class="t">${fmtSec(left)}</span><button>Stopp</button>`;
  el.querySelector('button').onclick = stopTimer;
  document.body.appendChild(el);
  const iv = setInterval(() => {
    left = Math.max(0, Math.round((end - Date.now()) / 1000));
    el.querySelector('.t').textContent = fmtSec(left);
    if (left <= 0) {
      stopTimer();
      if (onDone) { onDone(); return; }
      beep(3); toast(label === 'Pause' ? 'Pause vorbei – nächster Satz!' : 'Geschafft!');
    }
  }, 250);
  timer = { el, iv };
}
function stopTimer() {
  if (!timer) return;
  clearInterval(timer.iv); timer.el.remove(); timer = null;
}

// ---------- Navigation ----------
const NAV = [
  ['heute', 'Heute', '<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><circle cx="12" cy="12" r="4"/>'],
  ['woche', 'Woche', '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
  ['verlauf', 'Verlauf', '<path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"/>'],
  ['hilfe', 'Hilfe', '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>'],
  ['einstellungen', 'Mehr', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'],
];
function nav(active) {
  let n = document.querySelector('nav.tabs');
  if (!n) { n = document.createElement('nav'); n.className = 'tabs'; document.body.appendChild(n); }
  n.innerHTML = `<div class="inner">${NAV.map(([id, label, icon]) => `<a href="#${id}" class="${id === active ? 'on' : ''}"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${label}</a>`).join('')}</div>`;
}
function hideNav() { document.querySelector('nav.tabs')?.remove(); }

// ---------- Login ----------
function renderLogin(msg = '') {
  hideNav();
  app.innerHTML = `
    <div class="login">
      <h1>Laufcoach 🏃</h1>
      <p class="muted">Dein Trainer für die nächsten 12 Wochen. Gib einmal deinen Zugangscode ein.</p>
      <input id="code" class="in" autocomplete="one-time-code" autocapitalize="characters" maxlength="12" placeholder="ZUGANGSCODE" />
      <button id="go" class="btn primary block">Rein</button>
      <div class="err" id="err">${esc(msg)}</div>
    </div>`;
  const go = async () => {
    const code = document.getElementById('code').value.trim();
    if (!code) return;
    document.getElementById('go').disabled = true;
    try {
      const r = await api('/auth', { method: 'POST', body: { code } });
      setToken(r.token);
      if (location.hash === '#heute') route(); else location.hash = '#heute';
    } catch (e) {
      document.getElementById('err').textContent = e.message;
      document.getElementById('go').disabled = false;
    }
  };
  document.getElementById('go').onclick = go;
  document.getElementById('code').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}

// ---------- Onboarding ----------
const ONB = [
  ['So funktioniert deine Woche', `<p>Jeden Tag steht hier genau, was dran ist – in der richtigen Reihenfolge. Du hakst ab, fertig.</p>
    <ul><li><b>Mo</b> Ruhetag + Functional Patterns</li><li><b>Di</b> Tempo-Lauf</li><li><b>Mi</b> Kraft A (Beine & Fuß)</li><li><b>Do</b> Lockerer Lauf</li><li><b>Fr</b> Kraft B (Hüfte, Rumpf, Oberkörper)</li><li><b>Sa</b> Ruhetag</li><li><b>So</b> Langer Lauf</li></ul>
    <p>Nach jedem Lauf trägst du kurz ein, wie es war. Dann passe ich den Plan an – wie ein echter Trainer.</p>`],
  ['Deine Zonen in einem Satz', `<p><b>Locker heißt: Puls 154–162, du kannst ganze Sätze reden.</b> Die Uhr piept über 164 – dann langsamer oder gehen.</p>
    <p class="muted">Schnelle Stücke am Dienstag sagt dir die Uhr. Bergauf zählt nur der Puls, Gehen ist richtig.</p>`],
  ['So startest du ein Training auf der Uhr', `<ol><li>Laufen-Taste drücken</li><li><b>Up</b> lange halten</li><li>Training → Trainingskalender</li><li>Heutiges Training wählen → <b>Training ausführen</b></li></ol>
    <p class="muted">Welches Training es heute ist, steht immer oben in der App.</p>`],
  ['Benachrichtigungen erlauben', `<p>Jeden Morgen kommt: „Heute ist dran: …“ – auch auf deiner Uhr.</p>
    <ol><li>Diese App muss vom <b>Home-Bildschirm</b> geöffnet sein (Safari → Teilen → Zum Home-Bildschirm).</li><li>Unten auf <b>Erlauben</b> tippen.</li><li>In der Garmin-Connect-App: Smart Notifications an.</li></ol>`],
];
function renderOnboarding(i = 0) {
  hideNav();
  const [title, body] = ONB[i];
  const last = i === ONB.length - 1;
  app.innerHTML = `<div class="onb"><div class="step">${i + 1} von ${ONB.length}</div><h2>${title}</h2><div>${body}</div>
    <div class="dots">${ONB.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
    ${last ? '<button class="btn primary block" id="allow">Benachrichtigungen erlauben</button><button class="btn block" id="next" style="margin-top:10px">Später</button>' : '<button class="btn primary block" id="next">Weiter</button>'}</div>`;
  const finish = async () => { await api('/settings', { method: 'POST', body: { onboarded: true } }).catch(() => {}); if (location.hash === '#heute') route(); else location.hash = '#heute'; };
  document.getElementById('next').onclick = () => (last ? finish() : renderOnboarding(i + 1));
  if (last) document.getElementById('allow').onclick = async () => { await enablePush(); finish(); };
}

// ---------- Push ----------
function urlB64ToUint8Array(b) {
  const pad = '='.repeat((4 - (b.length % 4)) % 4);
  const raw = atob((b + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast(isStandalone() ? 'Dieses Gerät kann keine Benachrichtigungen.' : 'Erst zum Home-Bildschirm hinzufügen und von dort öffnen.', 4000);
    return false;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Benachrichtigungen sind nicht erlaubt. In den iPhone-Einstellungen → Laufcoach → Mitteilungen einschalten.', 5000); return false; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) });
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  toast('Benachrichtigungen sind an ✓');
  return true;
}

// ---------- Heute ----------
function exerciseCard(it, idx, done, fb) {
  const setsDone = done[it.id] || 0;
  const isDone = it.sets > 1 ? setsDone >= it.sets : setsDone > 0;
  const kg = it.weight && it.weight !== 'ohne Gewicht';
  return `
  <div class="card ${isDone ? 'done' : ''}" data-id="${esc(it.id)}">
    <div class="ex">
      <div class="num">${idx}</div>
      <div>
        ${it.extra ? '<div class="extra-badge">EXTRA FÜR DEINE SCHWACHSTELLE</div>' : ''}
        <h3>${esc(it.name)}</h3>
        <div class="dose">${esc(it.doseText)}</div>
        <span class="weight ${kg ? 'kg' : ''}">${kg ? '🏋️ ' : ''}${esc(it.weight)}</span>${it.tool ? `<span class="weight">🧰 ${esc(it.tool)}</span>` : ''}
        ${it.extraSet ? `<div class="small" style="color:var(--accent);font-weight:650;margin-top:6px">${esc(it.extraSet)}</div>` : ''}
        ${it.shiftNote ? `<div class="small muted" style="margin-top:6px">${esc(it.shiftNote)}</div>` : ''}
        <div class="collapse-when-done">
          <div class="why">${esc(it.why)}</div>
          ${it.sets > 1 ? `<div class="sets">${Array.from({ length: it.sets }, (_, k) => `<button class="set ${k < setsDone ? 'on' : ''}" data-set="${k + 1}">${k + 1}</button>`).join('')}</div>` : ''}
          ${it.holds ? `<div class="row"><button class="btn small hold" data-holds="${it.holds.join(',')}">⏱ Runde starten (${it.holds.join(' / ')} s)</button></div>` : it.hold ? `<div class="row"><button class="btn small hold" data-hold="${it.hold}">⏱ ${fmtSec(it.hold)} halten</button></div>` : ''}
          <details class="how"><summary>So geht's</summary><div class="how-body">
            <h4>Startposition</h4><div>${esc(it.start)}</div>
            <h4>Bewegung</h4><ol>${(it.steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
            <h4>Achte darauf</h4><div>${esc(it.watch)}</div>
            <h4>Häufiger Fehler</h4><div>${esc(it.mistake)}</div>
            ${it.perSide ? '<h4>Seiten</h4><div>Erst eine Seite, dann die andere. Die andere Seite ist die Pause.</div>' : ''}
          </div></details>
        </div>
        ${isDone && !it.exId.endsWith('0') && !it.extra ? `<div class="fb">Wie war's? <button data-fb="leicht" class="${fb[it.exId] === 'leicht' ? 'on' : ''}">zu leicht</button><button data-fb="ok" class="${!fb[it.exId] ? '' : ''}">passt</button><button data-fb="schwer" class="${fb[it.exId] === 'schwer' ? 'on' : ''}">zu schwer</button></div>` : ''}
      </div>
      <button class="tick" aria-label="Erledigt">${TICK}</button>
    </div>
  </div>`;
}

function checkCard(it, check) {
  const v = check || {};
  const done = !!check;
  return `<div class="card ${done ? 'done' : ''}" id="check" data-id="run:check">
    <div class="ex"><div class="num">✓</div><div>
      <h3>${esc(it.name)}</h3><div class="why">Vor dem Lauf. 0 = nichts, 10 = sehr schlimm.</div>
      <div class="collapse-when-done">
        ${slider('squat', 'Tief in die Hocke und hoch – Schmerz?', v.squat ?? 0)}
        ${slider('shin', 'Schienbein abdrücken – Schmerz?', v.shin ?? 0)}
        ${it.hop ? slider('hop', '10 Hüpfer je Bein – Schmerz?', v.hop ?? 0) : ''}
        <label class="check"><input type="checkbox" id="c-bone" ${v.bone ? 'checked' : ''}> Ein Punkt am Knochen tut beim Drücken weh</label>
        <label class="check"><input type="checkbox" id="c-limp" ${v.limp ? 'checked' : ''}> Ich hinke</label>
        <label class="check"><input type="checkbox" id="c-sick" ${v.sick ? 'checked' : ''}> Ich bin krank</label>
        <label class="f">Ruhepuls heute (optional, von der Uhr)</label><input class="in" id="c-rhr" inputmode="numeric" value="${v.rhr ?? ''}" placeholder="z. B. 54">
        <button class="btn primary block" id="save-check" style="margin-top:14px">Check speichern</button>
      </div>
      ${done ? '<div class="small muted" style="margin-top:6px">Gespeichert. Antippen zum Ändern.</div>' : ''}
    </div><button class="tick" aria-label="Erledigt">${TICK}</button></div></div>`;
}
function slider(id, label, val) {
  return `<label class="f">${esc(label)}</label><div class="slider"><input type="range" min="0" max="10" step="1" id="s-${id}" value="${val}" oninput="this.nextElementSibling.value=this.value"><output>${val}</output></div>`;
}
function watchCard(it, day) {
  return `<div class="card" data-id="run:watch"><div class="label">Auf der Uhr starten</div>
    <h3 style="font-size:20px">⌚ ${esc(it.workout)}</h3>
    ${day.plannedWorkout ? `<div class="small" style="color:var(--accent);font-weight:650;margin-top:4px">Statt „${esc(day.plannedWorkout)}“ (angepasst)</div>` : ''}
    <p class="why">${esc(it.summary)}</p>
    <ol class="steps-list">${it.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <details class="how"><summary>So startest du es auf der Uhr</summary><div class="how-body"><ol>${it.howto.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div></details>
  </div>`;
}
function analysisHtml(r) {
  const a = r.auto;
  if (!a && !r.analysis) return '';
  const cls = a ? (a.verdict === 'gut' ? 'good' : a.verdict === 'achtung' ? 'warn' : 'info') : 'info';
  return `<div class="card note ${cls}"><div class="label">Coach-Auswertung · ${esc(r.workout || 'Lauf')}</div>
    ${a ? `<h3 style="margin-bottom:6px">${esc(a.title)}</h3>${a.points.map((p) => `<p style="margin:4px 0">${p.icon} ${esc(p.text)}</p>`).join('')}${a.tip ? `<p style="margin-top:8px"><b>Tipp:</b> ${esc(a.tip)}</p>` : ''}` : ''}
    ${r.analysis ? `<div class="label" style="margin-top:12px">Nachricht von Claude</div><p style="margin:0">${esc(r.analysis)}</p>` : ''}
  </div>`;
}
function runSummary(r) {
  const pace = r.distance_m && r.duration_s ? r.duration_s / (r.distance_m / 1000) : null;
  return [r.distance_m ? (r.distance_m / 1000).toFixed(1) + ' km' : null, r.duration_s ? fmtSec(r.duration_s) + ' min' : null, pace ? fmtSec(Math.round(pace)) + ' /km' : null, r.hr_avg ? 'Ø ' + r.hr_avg + ' Puls' : null, r.cadence ? r.cadence + ' Schritte/min' : null, r.source === 'garmin' ? 'von Garmin' : r.source === 'strava' ? 'von Strava' : null].filter(Boolean).join(' · ');
}
function runlogCard(it, runs) {
  const r = runs[0];
  return `<div class="card ${r && r.rpe ? 'done' : ''}" data-id="run:log"><div class="ex"><div class="num">📝</div><div>
    <h3>${esc(it.name)}</h3>
    ${r ? `<div class="dose">${esc(runSummary(r))}</div>` : ''}
    <div class="why">${r && r.rpe ? 'Eingetragen ✓ – antippen zum Ändern.' : r ? 'Die Uhr hat die Werte geschickt. Trag noch ein, wie es sich angefühlt hat und ob etwas gezwickt hat.' : 'Kommt nach dem Lauf automatisch von der Uhr. Oder selbst eintragen – dauert 1 Minute.'}</div>
    <div class="row"><a class="btn primary" href="#lauf">${r && r.rpe ? 'Ändern' : 'Jetzt eintragen'}</a></div>
  </div><div></div></div></div>`;
}

function fpView(day, done) {
  const fp = day.fp;
  if (!fp) return '';
  const total = fp.lessons.length;
  const n = fp.lessons.filter((l) => done[l.id]).length;
  const links = state.data?.settings?.fpLinks || {};
  return `
  <div class="card"><div class="label">Functional Patterns</div>
    <h3>${fp.fpWeek ? `FP-Woche ${fp.fpWeek} von 10 · ${esc(fp.title)}` : 'Wiederholungswoche'}</h3>
    ${fp.goal ? `<p class="why">${esc(fp.goal)}</p>` : ''}
    <p>${esc(fp.text)}</p>
    <p class="small"><b>Werkzeug:</b> ${esc(fp.tools)}</p>
    <div class="bar"><i style="width:${((fp.fpWeek || Math.min(day.fpFree, 10)) / 10) * 100}%"></i></div>
    <div class="small muted" style="margin-top:4px">Functional Patterns: Woche ${fp.fpWeek || day.fpFree} von 10</div>
    <div class="row"><a class="btn primary" href="${esc(fp.weekUrl)}" target="_blank" rel="noopener">Woche im Kurs öffnen</a></div>
    <details class="how"><summary>Was ist Functional Patterns?</summary><div class="how-body"><p>${esc(PLAN.fp.explain)}</p><h4>Regeln fürs Rollen</h4><p>${esc(PLAN.fp.rollRules)}</p><h4>Wichtig</h4><p>${esc(PLAN.fp.unlockNote)}</p></div></details>
  </div>
  ${day.shopping ? `<div class="card note warn"><b>🛒 ${esc(day.shopping)}</b></div>` : ''}
  ${total ? `<div class="label" style="margin:16px 4px 8px">Lektionen der Reihe nach · ${n} von ${total}</div>` : ''}
  ${fp.lessons.map((l, i) => `
    <div class="card ${done[l.id] ? 'done' : ''}" data-id="${esc(l.id)}">
      <div class="ex"><div class="num">${i + 1}</div><div>
        <h3>${esc(l.name)} <span class="lesson-mode ${l.mode}">${l.mode === 'machen' ? 'Machen' : l.mode === 'freiwillig' ? 'Freiwillig' : 'Nur ansehen'}</span></h3>
        <div class="why">${esc(l.how)}</div>
        <div class="row collapse-when-done"><a class="btn small" href="${esc(links[l.lessonId] || l.url)}" target="_blank" rel="noopener">▶ Video öffnen</a></div>
      </div><button class="tick" aria-label="Erledigt">${TICK}</button></div>
    </div>`).join('')}`;
}

async function renderToday() {
  nav('heute');
  if (!state.data || state.data.day.date !== state.date || state.data.mini !== state.mini) app.innerHTML = '<div class="spinner">Lade …</div>';
  let data;
  try {
    data = await api(`/day?date=${state.date}${state.mini ? '&mini=1' : ''}`);
    data.mini = state.mini;
    state.data = data;
  } catch (e) {
    if (e instanceof AuthError) return renderLogin(e.message);
    // offline: Plan trotzdem zeigen
    data = { day: getDay(state.date, { mini: state.mini }), done: {}, runs: [], notes: [], messages: [], feedback: {}, ampel: null, offline: true, settings: {} };
    state.data = data;
  }
  if (data.settings && data.settings.onboarded === false && !sessionStorage.getItem('onbSkip')) { sessionStorage.setItem('onbSkip', '1'); return renderOnboarding(0); }
  const { day, done, runs, notes, messages, feedback, ampel, check } = data;
  const isToday = state.date === today();
  const weekLabel = day.week === 0 ? 'Woche 0 · Vorbereitung' : day.week > 12 ? 'Nach dem Plan' : `Woche ${day.week} · Level ${day.level}${day.easy ? ' · leichte Woche' : ''}`;
  const typeIcon = { run: '🏃', strength: '💪', fp: '🧘', rest: '😴', before: '⏳' }[day.type] || '';
  const ampelPill = ampel ? `<span class="pill ${ampel}">${ampel === 'gruen' ? 'Grün' : ampel === 'gelb' ? 'Gelb' : 'Rot'}</span>` : '';

  const counted = day.items.filter((it) => it.kind !== 'watch' && it.kind !== 'section');
  const doneCount = counted.filter((it) => isItemDone(it, done, runs, check)).length;
  const allDone = counted.length > 0 && doneCount === counted.length;

  let html = `
  <div class="head">
    <div class="date">${isToday ? '' : '<span class="muted" style="font-size:16px;font-weight:600;display:block">Vorschau</span>'}${esc(day.label)}</div>
    <div class="meta">${esc(weekLabel)}</div>
    <div class="type">${typeIcon} ${esc(day.title)}${day.minutes ? ` <span class="pill">${day.minutes} min</span>` : ''} ${ampelPill}</div>
    <div class="dayswitch"><button data-go="-1">‹ Gestern</button>${isToday ? '' : '<button data-go="0">Heute</button>'}<button data-go="1">Morgen ›</button></div>
  </div>`;
  if (data.offline) html += '<div class="card note warn small">Offline – Haken werden gerade nicht gespeichert.</div>';
  for (const n of notes || []) html += `<div class="card note claude"><div class="label">Nachricht von Claude</div>${esc(n.text)}</div>`;
  for (const r of day.reasons || []) html += `<div class="card note"><div class="label">Heute angepasst</div>${esc(r)}</div>`;
  for (const m of messages || []) html += `<div class="card note ${m.type}"><div class="label">Coach</div>${esc(m.text)}</div>`;
  if (day.note) html += `<div class="card"><p style="margin:0">${esc(day.note)}</p></div>`;
  if (day.dailyReminder) html += `<div class="card note info">🧍 ${esc(day.dailyReminder)}</div>`;
  if (day.general) html += `<div class="card note info small">${esc(day.general)}</div>`;

  if (day.type === 'fp') html += fpView(day, done);
  let idx = 0;
  for (const it of day.items) {
    if (it.kind === 'exercise') html += exerciseCard(it, idx++, done, feedback || {});
    else if (it.kind === 'check') html += checkCard(it, check);
    else if (it.kind === 'watch') html += watchCard(it, day);
    else if (it.kind === 'runlog') { html += runlogCard(it, runs); for (const r of runs) html += analysisHtml(r); }
    else if (it.kind === 'section') { html += `<div class="label" style="margin:22px 4px 8px;font-size:14px;color:var(--accent)">${esc(it.name)}</div>`; if (it.general) html += `<div class="card note info small">${esc(it.general)}</div>`; idx = 0; }
  }
  if (!day.items.some((it) => it.kind === 'runlog') && runs.length) {
    html += '<div class="label" style="margin:18px 4px 8px">Dein Lauf heute</div>';
    for (const r of runs) html += `<div class="card"><h3>${esc(r.workout || 'Lauf')}</h3><div class="dose">${esc(runSummary(r))}</div><div class="row"><a class="btn small" href="#lauf">${r.rpe ? 'Ändern' : 'Gefühl und Schmerz eintragen'}</a></div></div>` + analysisHtml(r);
  }
  if (day.optional) html += `<div class="card note info">${esc(day.optional)}</div>`;
  if (day.type === 'rest' && !day.optional && day.week >= 0) html += `<div class="card note info small">${esc(PLAN.rules.food)}</div>`;

  if (state.date <= today()) {
    html += `<div class="card" id="coachnote"><div class="label">Sag deinem Coach, wie's dir geht</div>
      ${(data.myNotes || []).map((n) => `<p class="small" style="margin:4px 0">💬 ${esc(n.text)}</p>`).join('')}
      <textarea class="in" id="cn-text" placeholder="z. B. „Knöchel heute komisch, wenn ich ihn nach außen biege“ oder „Beine schwer, schlecht geschlafen“"></textarea>
      <button class="btn primary block" id="cn-send" style="margin-top:10px">An den Coach senden</button>
      <div id="cn-reply"></div></div>`;
  }
  if (allDone) html += `<div class="card finished"><div class="big">Erledigt ✓</div><div class="muted" id="weekprog">Stark gemacht!</div><p class="small">${esc(PLAN.rules.food)}</p></div>`;
  if (day.type === 'strength' || day.type === 'run') {
    html += `<div class="row" style="margin-top:4px">${day.hasMini ? `<button class="btn" id="mini">${state.mini ? 'Ganze Einheit zeigen' : 'Mini-Version (15 min)'}</button>` : ''}${isToday ? '<button class="btn" id="move">Heute verschieben</button>' : ''}</div>`;
  }
  app.innerHTML = html;
  bindToday(day, done, runs);
  if (allDone) {
    if (sessionStorage.getItem('confetti') !== state.date) { sessionStorage.setItem('confetti', state.date); confetti(); }
    api(`/week?date=${state.date}`).then((w) => {
      const tr = w.days.filter((d) => d.type === 'run' || d.type === 'strength');
      const el = document.getElementById('weekprog');
      if (el) el.textContent = `${tr.filter((d) => d.complete).length} von ${tr.length} diese Woche`;
    }).catch(() => {});
  }
}
function isItemDone(it, done, runs, check) {
  if (it.kind === 'check') return !!check;
  if (it.kind === 'runlog') return runs && runs.some((r) => r.rpe);
  if (it.kind === 'lesson') return !!done[it.id];
  const v = done[it.id] || 0;
  return it.sets > 1 ? v >= it.sets : v > 0;
}

function bindToday(day, done) {
  app.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => {
    const g = +b.dataset.go;
    state.date = g === 0 ? today() : addDays(state.date, g);
    state.mini = false;
    renderToday();
  });
  const save = async (id, value) => {
    done[id] = value;
    try { await api('/done', { method: 'POST', body: { date: state.date, item_id: id, value } }); } catch (e) { toast(e.message); }
  };
  app.querySelectorAll('.card[data-id]').forEach((card) => {
    const id = card.dataset.id;
    const it = day.items.find((x) => x.id === id);
    if (!it) return;
    const tick = card.querySelector('.tick');
    if (it.kind === 'check') {
      tick.onclick = () => { card.classList.toggle('done'); };
      card.querySelector('#save-check').onclick = async () => {
        const body = { date: state.date, squat: +card.querySelector('#s-squat').value, shin: +card.querySelector('#s-shin').value, hop: card.querySelector('#s-hop') ? +card.querySelector('#s-hop').value : null,
          bone: card.querySelector('#c-bone').checked, limp: card.querySelector('#c-limp').checked, sick: card.querySelector('#c-sick').checked, rhr: card.querySelector('#c-rhr').value };
        try { await api('/check', { method: 'POST', body }); toast('Check gespeichert'); renderToday(); } catch (e) { toast(e.message); }
      };
      return;
    }
    if (!tick) return;
    if (it.kind === 'exercise' || it.kind === 'lesson') {
      tick.onclick = async () => {
        const cur = done[id] || 0;
        const full = it.sets > 1 ? it.sets : 1;
        const next = cur >= full ? 0 : full;
        await save(id, next);
        if (next && navigator.vibrate) navigator.vibrate(15);
        renderToday();
      };
      card.querySelectorAll('.set').forEach((s) => s.onclick = async () => {
        const n = +s.dataset.set;
        const cur = done[id] || 0;
        const next = cur === n ? n - 1 : n;
        await save(id, next);
        if (next > cur && next < it.sets) startTimer(60, 'Pause');
        renderToday();
      });
      card.querySelectorAll('.hold').forEach((h) => h.onclick = () => (h.dataset.holds ? startTimerSeq(h.dataset.holds.split(',').map(Number)) : startTimer(+h.dataset.hold, 'Halten')));
      card.querySelectorAll('[data-fb]').forEach((b) => b.onclick = async () => {
        try {
          await api('/feedback', { method: 'POST', body: { date: state.date, ex_id: it.exId, value: b.dataset.fb } });
          toast(b.dataset.fb === 'leicht' ? 'Notiert. Zweimal „zu leicht“ → nächste Stufe.' : b.dataset.fb === 'schwer' ? 'Notiert. Nächstes Mal leichtere Stufe.' : 'Gut so!');
          renderToday();
        } catch (e) { toast(e.message); }
      });
    }
  });
  const cn = document.getElementById('cn-send');
  if (cn) cn.onclick = async () => {
    const text = document.getElementById('cn-text').value.trim();
    if (!text) return toast('Schreib kurz, wie es dir geht.');
    cn.disabled = true;
    try {
      const r = await api('/note', { method: 'POST', body: { date: state.date, text } });
      const NAMES = { knie: 'Knie', schienbein: 'Schienbein', innenknoechel: 'Innenknöchel', aussenknoechel: 'Außenknöchel', grosszehe: 'Großzehe', wade: 'Wade', huefte: 'Hüfte', schulter: 'Schulter' };
      document.getElementById('cn-reply').innerHTML = `<div class="card note good" style="margin:12px 0 0">${r.areas.length ? `Verstanden: <b>${r.areas.map((a) => NAMES[a] || a).join(', ')}</b>. ` : 'Danke, ist angekommen. '}${r.upcoming.length ? r.upcoming.map((u) => `${esc(u.label)}: Extra-Übungen ${esc(u.extras.join(', '))}.`).join(' ') : ''} Heute Abend schaut sich Claude das genau an und passt deinen Plan an.</div>`;
      document.getElementById('cn-text').value = '';
    } catch (e) { toast(e.message); }
    cn.disabled = false;
  };
  const mini = document.getElementById('mini');
  if (mini) mini.onclick = () => { state.mini = !state.mini; renderToday(); };
  const move = document.getElementById('move');
  if (move) move.onclick = async () => {
    if (!confirm('Training auf morgen verschieben? (Regeln: höchstens 1 Tag, nicht nachholen)')) return;
    try { await api('/move', { method: 'POST', body: { date: state.date } }); toast('Auf morgen verschoben'); renderToday(); } catch (e) { alert(e.message); }
  };
}

// ---------- Lauf eintragen ----------
const SPOTS = [['knie', 'Knie'], ['schienbein', 'Schienbein'], ['innenknoechel', 'Innenknöchel'], ['aussenknoechel', 'Außenknöchel'], ['grosszehe', 'Großzehe'], ['wade', 'Wade'], ['huefte', 'Hüfte'], ['schulter', 'Schulter'], ['sonstiges', 'Sonstiges']];
async function renderRunForm() {
  nav('heute');
  let data = state.data;
  if (!data || data.day.date !== state.date) {
    try { data = await api(`/day?date=${state.date}`); state.data = data; } catch (e) { if (e instanceof AuthError) return renderLogin(); }
  }
  const day = data?.day || getDay(state.date);
  const r = (data?.runs || [])[0] || {};
  const wname = day.workout || r.workout || 'Locker (frei)';
  const w = PLAN.workouts[wname] || {};
  const sel = { rpe: r.rpe ?? null, where: new Set((r.pain_where || '').split(',').filter(Boolean)), side: r.pain_side || null, when: r.pain_when || null, gone: r.pain_gone || null };
  app.innerHTML = `
    <h2 class="sec">Lauf eintragen</h2>
    <div class="card"><div class="label">${esc(formatLong(state.date))}</div><h3>${esc(wname)}</h3>
      ${r.source === 'strava' ? '<p class="small muted">Werte kommen von Strava. Du musst nur Gefühl und Schmerz ergänzen.</p>' : '<p class="small muted">Alles optional außer dem Gefühl. Werte findest du in Garmin Connect.</p>'}
      <div class="grid2">
        <div><label class="f">Dauer (min:s)</label><input class="in" id="dur" placeholder="45:30" value="${r.duration_s ? fmtSec(r.duration_s) : ''}"></div>
        <div><label class="f">Distanz (km)</label><input class="in" id="dist" inputmode="decimal" placeholder="7,2" value="${r.distance_m ? (r.distance_m / 1000).toFixed(2).replace('.', ',') : ''}"></div>
        <div><label class="f">Ø-Puls</label><input class="in" id="hr" inputmode="numeric" placeholder="158" value="${r.hr_avg ?? ''}"></div>
        <div><label class="f">Max-Puls</label><input class="in" id="hrmax" inputmode="numeric" placeholder="175" value="${r.hr_max ?? ''}"></div>
        <div><label class="f">Ø-Schrittfrequenz</label><input class="in" id="cad" inputmode="numeric" placeholder="170" value="${r.cadence ?? ''}"></div>
        ${w.test ? `<div><label class="f">${esc(w.testLabel)}</label><input class="in" id="test" placeholder="${w.test === 'threshold' ? '176' : w.test === '5k' ? '22:30' : '6:15'}" value="${esc(r.test_value ?? '')}"></div>` : ''}
      </div>
    </div>
    <div class="card"><h3>Wie hat es sich angefühlt?</h3><p class="small muted">1 = super leicht · 10 = am Limit</p>
      <div class="faces">${Array.from({ length: 10 }, (_, i) => `<button data-rpe="${i + 1}" class="${sel.rpe === i + 1 ? 'on' : ''}">${i + 1}</button>`).join('')}</div>
      <div class="small muted" style="display:flex;justify-content:space-between;margin-top:4px"><span>😌 leicht</span><span>😅</span><span>🥵 Limit</span></div>
    </div>
    <div class="card"><h3>Hat etwas wehgetan oder gezwickt?</h3>
      ${slider('pain', 'Schmerz (0 = nichts)', r.pain ?? 0)}
      <div id="painmore" style="${(r.pain ?? 0) > 0 ? '' : 'display:none'}">
        <label class="f">Wo?</label><div class="chips" id="where">${SPOTS.map(([k, l]) => `<button class="chip ${sel.where.has(k) ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
        <label class="f">Welche Seite?</label><div class="chips" id="side">${['links', 'rechts', 'beide'].map((s) => `<button class="chip ${sel.side === s ? 'on' : ''}" data-k="${s}">${s}</button>`).join('')}</div>
        <label class="f">Wann?</label><div class="chips" id="when">${[['anfang', 'am Anfang'], ['waehrend', 'während'], ['ende', 'am Ende'], ['danach', 'danach']].map(([k, l]) => `<button class="chip ${sel.when === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
        <label class="f">War es schnell wieder weg?</label><div class="chips" id="gone">${[['schnell', 'ja, nach ≤ 1 h weg'], ['noch', 'nein, ist noch da']].map(([k, l]) => `<button class="chip ${sel.gone === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
      </div>
      <label class="f">Notiz (z. B. „rechtes Knie gezwickt bergab“)</label><textarea class="in" id="note" placeholder="Was war los? Wetter, Strecke, Gefühl …">${esc(r.source === 'strava' && !r.rpe ? '' : r.note ?? '')}</textarea>
    </div>
    <button class="btn primary block" id="save">Speichern</button>
    <a class="btn block" href="#heute" style="margin-top:10px">Abbrechen</a>
    <div id="reply"></div>`;
  app.querySelectorAll('[data-rpe]').forEach((b) => b.onclick = () => { sel.rpe = +b.dataset.rpe; app.querySelectorAll('[data-rpe]').forEach((x) => x.classList.toggle('on', x === b)); });
  const painEl = app.querySelector('#s-pain');
  painEl.addEventListener('input', () => { app.querySelector('#painmore').style.display = +painEl.value > 0 ? '' : 'none'; });
  app.querySelectorAll('#where .chip').forEach((c) => c.onclick = () => { const k = c.dataset.k; sel.where.has(k) ? sel.where.delete(k) : sel.where.add(k); c.classList.toggle('on'); });
  for (const g of ['side', 'when', 'gone']) {
    app.querySelectorAll(`#${g} .chip`).forEach((c) => c.onclick = () => { sel[g] = sel[g] === c.dataset.k ? null : c.dataset.k; app.querySelectorAll(`#${g} .chip`).forEach((x) => x.classList.toggle('on', x.dataset.k === sel[g])); });
  }
  app.querySelector('#save').onclick = async () => {
    if (!sel.rpe) { toast('Bitte noch das Gefühl (1–10) antippen.'); return; }
    const dist = app.querySelector('#dist').value.replace(',', '.');
    const body = {
      id: r.id || undefined, date: state.date, workout: wname,
      duration_s: parseTime(app.querySelector('#dur').value), distance_m: dist ? Math.round(parseFloat(dist) * 1000) : null,
      hr_avg: app.querySelector('#hr').value, hr_max: app.querySelector('#hrmax').value, cadence: app.querySelector('#cad').value,
      test_value: app.querySelector('#test')?.value || null, rpe: sel.rpe, pain: +painEl.value,
      pain_where: +painEl.value > 0 ? [...sel.where].join(',') || null : null, pain_side: +painEl.value > 0 ? sel.side : null,
      pain_when: +painEl.value > 0 ? sel.when : null, pain_gone: +painEl.value > 0 ? sel.gone : null, note: app.querySelector('#note').value,
    };
    app.querySelector('#save').disabled = true;
    try {
      const res = await api('/run', { method: 'POST', body });
      state.data = null;
      const up = res.upcoming || [];
      app.querySelector('#reply').innerHTML = `<div class="card note good" style="margin-top:14px"><div class="label">Gespeichert ✓ – das passe ich an</div>
        ${(res.messages || []).map((m) => `<p>💬 ${esc(m.text)}</p>`).join('')}
        ${up.length ? up.map((u) => `<p><b>${esc(u.label)}:</b> ${esc(u.reasons.join(' '))}</p>`).join('') : '<p>Alles grün – der Plan bleibt, wie er ist. 💪</p>'}
        <a class="btn primary block" href="#heute" style="margin-top:10px">Fertig</a></div>`;
      app.querySelector('#save').style.display = 'none';
      app.querySelector('#reply').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { toast(e.message); app.querySelector('#save').disabled = false; }
  };
}

// ---------- Woche ----------
async function renderWeek() {
  nav('woche');
  app.innerHTML = '<div class="spinner">Lade …</div>';
  let w;
  try { w = await api(`/week?date=${state.date}`); } catch (e) { if (e instanceof AuthError) return renderLogin(); app.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  const tr = w.days.filter((d) => d.type === 'run' || d.type === 'strength');
  const n = tr.filter((d) => d.complete).length;
  const t = today();
  const mon = w.days[0].date;
  app.innerHTML = `
    <h2 class="sec">${w.week <= 0 ? 'Woche 0' : w.week > 12 ? 'Erholung' : `Woche ${w.week}`}</h2>
    <div class="card"><div class="label">Diese Woche</div><h3>${n} von ${tr.length} Einheiten ${n >= Math.min(4, tr.length) && tr.length ? '– Woche geschafft! 🎉' : ''}</h3>
      <div class="bar"><i style="width:${tr.length ? (n / tr.length) * 100 : 0}%"></i></div><p class="small muted">${esc(PLAN.rules.weekDone)}</p></div>
    <div class="card week-list">${w.days.map((d) => `
      <a class="wd ${d.date === t ? 'today' : ''}" href="#tag/${d.date}">
        <div class="d">${weekdayName(d.date).slice(0, 2)}<small>${+d.date.slice(8)}.${+d.date.slice(5, 7)}.</small></div>
        <div><div style="font-weight:650">${esc(d.title)}</div>${d.adjusted ? '<div class="small" style="color:var(--accent)">angepasst</div>' : ''}</div>
        <div class="dot ${d.complete ? 'ok' : ''}">${d.complete ? '✓' : d.type === 'rest' || d.type === 'fp' ? '·' : ''}</div>
      </a>`).join('')}</div>
    <div class="row"><button class="btn" id="prev">‹ Woche davor</button><button class="btn" id="next">Nächste Woche ›</button></div>
    <div class="row"><a class="btn block" href="#plan">Ganzer 12-Wochen-Plan</a><a class="btn block" href="#bericht">Wochenbericht</a></div>`;
  app.querySelector('#prev').onclick = () => { state.date = addDays(mon, -7); renderWeek(); };
  app.querySelector('#next').onclick = () => { state.date = addDays(mon, 7); renderWeek(); };
}

// ---------- Plan ----------
function renderPlan() {
  nav('woche');
  const cur = planWeek(today());
  app.innerHTML = `<h2 class="sec">12-Wochen-Plan</h2>
    <div class="card"><table class="plan"><thead><tr><th>Wo</th><th>Dienstag</th><th>Donnerstag</th><th>Sonntag</th></tr></thead><tbody>
    ${PLAN.weeks.map((w) => `<tr class="${w.n === cur ? 'cur' : ''}"><td><b>${w.n}</b>${w.easy ? '<br><span class="small muted">leicht</span>' : ''}<br><span class="small muted">L${w.level}</span></td><td>${esc(w.tue)}</td><td>${esc(w.thu)}</td><td>${esc(w.sun)}</td></tr>`).join('')}
    </tbody></table><p class="small muted">Mo Ruhetag + FP · Mi Kraft A · Fr Kraft B · Sa Ruhetag. Level 1 = Woche 1–4, Level 2 = 5–8, Level 3 = 9–12.</p></div>
    <a class="btn block" href="#woche">‹ Zurück</a>`;
}

// ---------- Verlauf ----------
function lineChart(points, { color = 'var(--accent)', unit = '' } = {}) {
  if (points.length < 2) return '<p class="small muted">Noch zu wenig Daten – nach ein paar Läufen erscheint hier ein Diagramm.</p>';
  const W = 320, H = 130, P = 22;
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals) - 2, max = Math.max(...vals) + 2;
  const x = (i) => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = (v) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="3.5" fill="${color}"/>`).join('')}
    <text x="${P}" y="12" font-size="11" fill="var(--muted)">${Math.round(max - 2)}${unit}</text>
    <text x="${P}" y="${H - 4}" font-size="11" fill="var(--muted)">${points[0].l}</text>
    <text x="${W - P}" y="${H - 4}" font-size="11" fill="var(--muted)" text-anchor="end">${points[points.length - 1].l}</text>
  </svg>`;
}
async function renderHistory() {
  nav('verlauf');
  app.innerHTML = '<div class="spinner">Lade …</div>';
  let h;
  try { h = await api('/history'); } catch (e) { if (e instanceof AuthError) return renderLogin(); app.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  const runs = h.runs;
  const asc = [...runs].reverse();
  const easy = asc.filter((r) => PLAN.workouts[r.workout]?.kind === 'easy' && r.hr_avg).map((r) => ({ v: r.hr_avg, l: `${+r.date.slice(8)}.${+r.date.slice(5, 7)}.` }));
  const weeks = {};
  for (const r of asc) { const mon = addDays(r.date, -((new Date(r.date + 'T12:00:00Z').getUTCDay() + 6) % 7)); weeks[mon] = (weeks[mon] || 0) + (r.distance_m || 0) / 1000; }
  const km = Object.entries(weeks).map(([m, v]) => ({ v: Math.round(v * 10) / 10, l: `${+m.slice(8)}.${+m.slice(5, 7)}.` }));
  app.innerHTML = `<h2 class="sec">Verlauf</h2>
    <div class="card"><div class="label">Puls bei lockeren Läufen</div>${lineChart(easy)}<p class="small muted">Wird der Puls bei gleichem Tempo niedriger, wird deine Ausdauer besser.</p></div>
    <div class="card"><div class="label">Wochen-km</div>${lineChart(km, { color: 'var(--ok)', unit: ' km' })}</div>
    <div class="card"><div class="label">Alle Läufe (${runs.length})</div>
      ${runs.length ? runs.map((r) => `<div class="run-item"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(r.workout || 'Lauf')}</b><span class="muted small">${+r.date.slice(8)}.${+r.date.slice(5, 7)}.</span></div>
        <div class="small">${[r.distance_m ? (r.distance_m / 1000).toFixed(1) + ' km' : null, r.duration_s ? fmtSec(r.duration_s) + ' min' : null, r.hr_avg ? 'Ø ' + r.hr_avg : null, r.rpe ? 'Gefühl ' + r.rpe : null, r.pain ? `Schmerz ${r.pain}${r.pain_where ? ' (' + r.pain_where + (r.pain_side ? ', ' + r.pain_side : '') + ')' : ''}` : null, r.source === 'strava' ? 'Strava' : null].filter(Boolean).join(' · ')}</div>
        ${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}
        ${r.auto ? `<details class="how"><summary>${r.auto.verdict === 'gut' ? '🟢' : r.auto.verdict === 'achtung' ? '🟠' : '⚪'} Coach-Auswertung</summary><div class="how-body">${r.auto.points.map((p) => `<p style="margin:4px 0">${p.icon} ${esc(p.text)}</p>`).join('')}${r.auto.tip ? `<p><b>Tipp:</b> ${esc(r.auto.tip)}</p>` : ''}${r.analysis ? `<p><b>Claude:</b> ${esc(r.analysis)}</p>` : ''}</div></details>` : ''}</div>`).join('') : '<p class="muted">Noch keine Läufe eingetragen.</p>'}
    </div>`;
}

// ---------- Bericht ----------
async function renderReport() {
  nav('woche');
  app.innerHTML = '<div class="spinner">Lade …</div>';
  let r;
  try { r = await api(`/report?date=${state.date}`); } catch (e) { if (e instanceof AuthError) return renderLogin(); app.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  const col = { gruen: '🟢', gelb: '🟡', rot: '🔴', '–': '⚪' };
  app.innerHTML = `<h2 class="sec">Wochenbericht${r.week >= 1 && r.week <= 12 ? ` · Woche ${r.week}` : ''}</h2>
    <div class="card"><div class="grid2">
      <div><div class="label">Erledigt</div><div style="font-size:26px;font-weight:800">${r.done} von ${r.planned}</div></div>
      <div><div class="label">Kilometer</div><div style="font-size:26px;font-weight:800">${r.km}</div></div>
      <div><div class="label">Ø-Puls locker</div><div style="font-size:26px;font-weight:800">${r.easyHr ?? '–'}</div></div>
      <div><div class="label">Längster Lauf</div><div style="font-size:26px;font-weight:800">${r.longest || '–'} km</div></div>
    </div><div class="label" style="margin-top:14px">Ampel Mo–So</div><div style="font-size:22px;letter-spacing:4px">${r.ampel.map((a) => col[a] || '⚪').join('')}</div></div>
    <div class="card note"><div class="label">Coach für nächste Woche</div>${esc(r.coach)}</div>
    ${(r.nextMessages || []).map((m) => `<div class="card note ${m.type}">${esc(m.text)}</div>`).join('')}
    <a class="btn block" href="#woche">‹ Zurück</a>`;
}

// ---------- Hilfe ----------
function renderHelp() {
  nav('hilfe');
  const z = PLAN.zones.map((x) => `<tr><td><b>${x.z}</b> ${x.name}</td><td>${x.hr}</td><td>${x.pace}</td><td>${x.feel}</td></tr>`).join('');
  const lib = Object.keys(PLAN.workouts).map((k) => `<li><b>${esc(k)}:</b> ${esc(PLAN.workouts[k].steps.join(' · '))}</li>`).join('');
  const ex = (key) => PLAN.strength[key].exercises.map((e) => `<li><b>${esc(e.name)}</b> – ${esc(e.why)}</li>`).join('');
  const sections = [
    ['Deine Woche', `<ul><li>Mo: Ruhetag + Functional Patterns (20–30 min)</li><li>Di: Tempo-Lauf</li><li>Mi: Kraft A – Beine & Fuß (35 min)</li><li>Do: Lockerer Lauf</li><li>Fr: Kraft B – Hüfte, Rumpf, Oberkörper (35 min)</li><li>Sa: Ruhetag</li><li>So: Langer Lauf</li></ul><p>Level 1 = Woche 1–4, Level 2 = Woche 5–8, Level 3 = Woche 9–12. Woche 4, 8 und 12 sind leichte Wochen.</p><p>${esc(PLAN.rules.weekDone)}</p>`],
    ['Deine Zonen', `<table class="plan"><tr><th>Zone</th><th>Puls</th><th>Tempo</th><th>Gefühl</th></tr>${z}</table><p>${esc(PLAN.zonesNote)}</p>`],
    ['Training auf der Uhr starten', `<ol>${PLAN.runCards.tempo.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`],
    ['Alle Lauf-Trainings', `<ul>${lib}</ul>`],
    ['Kraft A – Übungen', `<ul>${ex('A')}</ul><p>${esc(PLAN.strength.A.general)}</p>`],
    ['Kraft B – Übungen', `<ul>${ex('B')}</ul>`],
    ['Ampel: Grün, Gelb, Rot', `<p><b>Morgen-Check (30 s):</b> ${esc(PLAN.rules.morningCheck.join(' · '))}</p><p>🟢 ${esc(PLAN.rules.ampel.gruen)}</p><p>🟡 ${esc(PLAN.rules.ampel.gelb)}</p><p>🔴 ${esc(PLAN.rules.ampel.rot)}</p><p>💪 ${esc(PLAN.rules.ampel.kraft)}</p>`],
    ['Wenn etwas zwickt (Schwachstellen)', '<p>Trag nach dem Lauf ein, <b>wo</b> und auf <b>welcher Seite</b> es gezwickt hat und ob es schnell wieder weg war. War es schnell weg, bleibt dein Lauf-Plan gleich – aber die App gibt dir in Kraft A und B gezielt <b>Extra-Übungen</b> für genau diese Stelle und 1 Satz mehr bei passenden Übungen. So wird die Stelle stärker. Bleibt der Schmerz oder ist der Morgen-Check gelb oder rot, wird auch das Laufen angepasst.</p>'],
    ['Langer Lauf – Regeln', `<p>${esc(PLAN.rules.long)}</p>`],
    ['Tauschen und Verschieben', `<ul>${PLAN.rules.swap.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`],
    ['Functional Patterns', `<p>${esc(PLAN.fp.explain)}</p><p><b>Routine:</b> Montag Lektionen der Reihe nach · Mittwoch und Freitag 2 Stellen im Start-Teil · Samstag freiwillig Follow-Along · Woche 4 täglich 1 min Standing Neutral.</p><p><b>Rollen:</b> ${esc(PLAN.fp.rollRules)}</p><p>${esc(PLAN.fp.unlockNote)}</p><p><a href="${PLAN.fp.courseUrl}" target="_blank" rel="noopener">Kurs öffnen</a></p>`],
    ['Deine Ausstattung', `<ul>${PLAN.equipment.have.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><p><b>Hantel-Regeln:</b></p><ul>${PLAN.equipment.rules.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><p><b>Fehlt noch:</b> ${esc(PLAN.equipment.missing)}</p>`],
    ['Essen', `<p>${esc(PLAN.rules.food)}</p>`],
    ['Woche 0 (12.–15.11.)', '<ul><li>Do 12.11.: Kraft-A-Probe (1 Satz je Übung, 15 min)</li><li>Fr 13.11.: Ruhe</li><li>Sa 14.11.: Probelauf „Locker (frei)“ 5–6 km flach – testen, ob die Uhr bei Puls über 164 piept</li><li>So 15.11.: Ruhe</li></ul>'],
  ];
  app.innerHTML = `<h2 class="sec">Hilfe</h2><div class="acc">${sections.map(([t, b]) => `<details><summary>${esc(t)}</summary><div class="body">${b}</div></details>`).join('')}</div>`;
}

// ---------- Einstellungen ----------
async function renderSettings() {
  nav('einstellungen');
  app.innerHTML = '<div class="spinner">Lade …</div>';
  let s;
  try { s = await api('/settings'); } catch (e) { if (e instanceof AuthError) return renderLogin(); app.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const fpExpected = expectedFpWeek(Math.max(1, planWeek(today())));
  app.innerHTML = `<h2 class="sec">Einstellungen</h2>
    <div class="card"><div class="label">Benachrichtigungen</div>
      <p>Status: <b>${perm === 'granted' ? 'erlaubt ✓' : perm === 'denied' ? 'blockiert' : isStandalone() ? 'noch nicht erlaubt' : 'erst zum Home-Bildschirm hinzufügen'}</b></p>
      ${!isStandalone() ? '<ol class="small"><li>In Safari unten auf <b>Teilen</b> (Quadrat mit Pfeil).</li><li><b>Zum Home-Bildschirm</b> → Hinzufügen.</li><li>Die App <b>vom Home-Bildschirm</b> öffnen.</li><li>Hier auf „Erlauben“ tippen.</li></ol>' : ''}
      <div class="row"><button class="btn primary" id="allow">Erlauben</button><button class="btn" id="test">Test-Benachrichtigung</button></div>
      <label class="check"><input type="checkbox" id="push" ${s.push ? 'checked' : ''}> Benachrichtigungen an</label>
      <div class="grid2"><div><label class="f">Morgens Mo–Fr</label><input class="in" type="time" id="mw" value="${s.morningWeek}"></div><div><label class="f">Morgens Sa/So</label><input class="in" type="time" id="me" value="${s.morningWeekend}"></div></div>
      <p class="small muted">Außerdem: 17:30 Erinnerung, wenn noch nichts abgehakt ist · 20:00 Vorschau auf morgen · 20:30 „Lauf eintragen“ · Sonntag 19:00 Wochenbericht. Auf der Uhr: Garmin Connect → Smart Notifications an.</p>
    </div>
    <div class="card"><div class="label">Functional Patterns</div>
      <label class="f">Welche FP-Woche ist bei dir im Kurs gerade frei?</label>
      <select class="in" id="fp">${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${(s.fpFree ?? fpExpected) === i + 1 ? 'selected' : ''}>Woche ${i + 1}${i + 1 === fpExpected ? ' (laut Plan)' : ''}</option>`).join('')}</select>
      <p class="small muted">Hängst du hinterher, zeigt die App einfach die freie Woche weiter. Kein Stress.</p>
      <details class="how"><summary>Video-Link anpassen</summary><div class="how-body"><p class="small">Passt ein Lektions-Link nicht? Lektions-Nummer und richtigen Link eintragen.</p>
        <div class="grid2"><input class="in" id="lid" placeholder="Nr. z. B. 14" inputmode="numeric"><input class="in" id="lurl" placeholder="https://…"></div><button class="btn small" id="lsave" style="margin-top:8px">Link speichern</button></div></details>
    </div>
    <div class="card"><div class="label">Strava</div>
      <p>${s.strava ? 'Verbunden ✓ – neue Läufe kommen automatisch.' : s.stravaClientId ? 'Noch nicht verbunden.' : 'Wird gerade eingerichtet.'}</p>
      <div class="row">${s.stravaClientId && !s.strava ? '<button class="btn primary" id="strava">Mit Strava verbinden</button>' : ''}${s.strava ? '<button class="btn" id="sync">Jetzt abrufen</button>' : ''}</div>
    </div>
    <div class="card"><button class="btn block" id="onb">Einführung nochmal ansehen</button><button class="btn block" id="logout" style="margin-top:10px">Abmelden</button></div>`;
  const saveS = async (b) => { try { await api('/settings', { method: 'POST', body: b }); toast('Gespeichert'); } catch (e) { toast(e.message); } };
  app.querySelector('#allow').onclick = enablePush;
  app.querySelector('#test').onclick = async () => { try { const r = await api('/push/test', { method: 'POST' }); toast(r.sent ? 'Gesendet – schau aufs Handy und die Uhr.' : 'Kein Gerät angemeldet. Erst „Erlauben“ tippen.', 4000); } catch (e) { toast(e.message); } };
  app.querySelector('#push').onchange = (e) => saveS({ push: e.target.checked });
  app.querySelector('#mw').onchange = (e) => saveS({ morningWeek: e.target.value });
  app.querySelector('#me').onchange = (e) => saveS({ morningWeekend: e.target.value });
  app.querySelector('#fp').onchange = (e) => { state.data = null; saveS({ fpFree: +e.target.value }); };
  app.querySelector('#lsave').onclick = () => {
    const id = app.querySelector('#lid').value.trim(); const u = app.querySelector('#lurl').value.trim();
    if (!id || !/^https:\/\//.test(u)) return toast('Nummer und https-Link eintragen.');
    saveS({ fpLinks: { ...(s.fpLinks || {}), [id]: u } });
  };
  const st = app.querySelector('#strava');
  if (st) st.onclick = async () => { try { const r = await api('/strava/connect'); location.href = r.url; } catch (e) { toast(e.message); } };
  const sy = app.querySelector('#sync');
  if (sy) sy.onclick = async () => { try { const r = await api('/strava/sync', { method: 'POST' }); toast(`${r.imported} neue Läufe geholt`); } catch (e) { toast(e.message); } };
  app.querySelector('#onb').onclick = () => renderOnboarding(0);
  app.querySelector('#logout').onclick = () => { if (confirm('Wirklich abmelden? Du brauchst dann wieder den Zugangscode.')) { setToken(null); renderLogin(); } };
}

// ---------- Router ----------
function route() {
  stopTimer();
  window.scrollTo(0, 0);
  if (!getToken()) return renderLogin();
  const h = (location.hash || '#heute').slice(1);
  if (h.startsWith('tag/')) { state.date = h.slice(4); state.mini = false; return renderToday(); }
  switch (h) {
    case 'woche': return renderWeek();
    case 'plan': return renderPlan();
    case 'verlauf': return renderHistory();
    case 'hilfe': return renderHelp();
    case 'einstellungen': return renderSettings();
    case 'bericht': return renderReport();
    case 'lauf': return renderRunForm();
    case 'check': state.date = today(); return renderToday().then(() => document.getElementById('check')?.scrollIntoView());
    default:
      state.date = today(); state.mini = false;
      return renderToday();
  }
}
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  // Nach Mitternacht oder Rückkehr: auf heute springen
  if (document.visibilityState === 'visible' && (location.hash === '#heute' || !location.hash) && state.date !== today() && state.lastToday !== today()) {
    state.date = today(); state.lastToday = today(); route();
  }
});
state.lastToday = today();

// ---------- Automatisch aktualisieren ----------
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';
async function checkUpdate() {
  if (BUILD === 'dev') return;
  try {
    const v = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => r.json());
    if (v.build && v.build !== BUILD) location.reload();
  } catch { /* offline */ }
}
function softRefresh() {
  const h = (location.hash || '#heute').slice(1);
  const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (typing || timer || document.querySelector('details[open]') || h === 'lauf' || document.getElementById('cn-text')?.value) return;
  if (h === 'heute' || h.startsWith('tag/')) renderToday();
  else if (['woche', 'verlauf', 'bericht'].includes(h)) route();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { checkUpdate(); softRefresh(); } });
setInterval(() => { if (document.visibilityState === 'visible') { checkUpdate(); softRefresh(); } }, 60000);
checkUpdate();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
route();
window.__API = API;
