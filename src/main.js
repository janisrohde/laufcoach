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
  ['Deine Zonen in einem Satz', `<p><b>Locker heißt: Puls 145–162 – du kannst noch ganze Sätze reden.</b> Die Uhr piept über 164 – dann langsamer oder gehen.</p>
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

const SPOTS = [['knie', 'Knie'], ['schienbein', 'Schienbein'], ['aussenknoechel', 'Knöchel außen'], ['innenknoechel', 'Knöchel innen'], ['ferse', 'Ferse'], ['wade', 'Wade'], ['grosszehe', 'Großzehe'], ['huefte', 'Hüfte'], ['schulter', 'Schulter'], ['sonstiges', 'Sonstiges']];
// ---------- Icons (SVG statt Emojis) ----------
const IC = {
  run: '<path d="M13 4.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0"/><path d="M7 21l3-6 3 2v5M10 15l1-5 4 3 3-1M8 9l3-2 2 1"/>',
  strength: '<path d="M6 7v10M18 7v10M3 9.5v5M21 9.5v5M6 12h12"/>',
  fp: '<circle cx="12" cy="5" r="2"/><path d="M12 7v6l-4 7M12 13l4 7M6 10l6-1 6 1"/>',
  rest: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  before: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  coach: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  check: '<path d="M9 4h6v3H9z"/><path d="M7 5H5v15h14V5h-2"/><path d="M8.5 13l2.5 2.5L16 10"/>',
  watch: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3M12 9v3l2 1"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  send: '<path d="M4 12l16-8-6 16-2-6z"/>',
};
const icon = (k, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || IC.info}</svg>`;
const AREA_NAMES = { knie: 'Knie', schienbein: 'Schienbein', innenknoechel: 'Innenknöchel', aussenknoechel: 'Außenknöchel', grosszehe: 'Großzehe', wade: 'Wade', huefte: 'Hüfte', schulter: 'Schulter', ferse: 'Ferse' };

// ---------- Heute ----------
function exerciseCard(it, idx, done, fb) {
  const setsDone = done[it.id] || 0;
  const isDone = it.sets > 1 ? setsDone >= it.sets : setsDone > 0;
  const kg = it.weight && it.weight !== 'ohne Gewicht';
  const isStart = it.exId.endsWith('0');
  return `
  <div class="card ex-card ${isDone ? 'done' : ''} ${it.extra ? 'extra' : ''}" data-id="${esc(it.id)}">
    <div class="ex">
      <div class="num">${idx}</div>
      <div class="ex-main">
        ${it.extra ? `<div class="tag accent">Extra · ${esc(AREA_NAMES[it.area] || '')}${it.level > 1 ? ` · Stufe ${it.level}` : ''}</div>` : ''}
        <h3>${esc(it.name)}</h3>
        <div class="dose">${esc(it.doseText)}</div>
        ${kg || it.extraSet ? `<div class="chips-inline">${kg ? `<span class="weight kg">${esc(it.weight)}</span>` : ''}${it.extraSet ? `<span class="weight acc">${esc(it.extraSet)}</span>` : ''}</div>` : ''}
        ${it.cue ? `<div class="cue">„${esc(it.cue)}“</div>` : ''}
        <div class="collapse-when-done">
          ${it.sets > 1 ? `<div class="sets" aria-label="Sätze">${Array.from({ length: it.sets }, (_, k) => `<button class="set ${k < setsDone ? 'on' : ''}" data-set="${k + 1}" aria-label="Satz ${k + 1}">${k + 1}</button>`).join('')}<span class="sets-hint">Satz antippen = Pause-Timer</span></div>` : ''}
          ${it.holds ? `<button class="btn small hold" data-holds="${it.holds.join(',')}">Timer: ${it.holds.join(' / ')} s</button>` : it.hold ? `<button class="btn small hold" data-hold="${it.hold}">Timer: ${fmtSec(it.hold)} halten</button>` : ''}
          <details class="how"><summary>So geht's</summary><div class="how-body">
            <div class="how-start"><b>Start:</b> ${esc(it.start)}</div>
            <ol class="how-steps">${(it.steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
            <div class="how-row ok"><b>Richtig:</b> ${esc(it.watch)}</div>
            <div class="how-row bad"><b>Fehler:</b> ${esc(it.mistake)}</div>
            ${it.perSide ? '<div class="how-row"><b>Seiten:</b> Erst eine Seite, dann die andere. Die andere Seite ist deine Pause.</div>' : ''}
            ${it.tool ? `<div class="how-row"><b>Du brauchst:</b> ${esc(it.tool)}</div>` : ''}
            <div class="how-row muted"><b>Wofür:</b> ${esc(it.why)}</div>
            ${it.shiftNote ? `<div class="how-row muted">${esc(it.shiftNote)}</div>` : ''}
          </div></details>
        </div>
        ${isDone && !isStart && !it.extra ? `<div class="fb"><span>Wie war's?</span><button data-fb="leicht" class="${fb[it.exId] === 'leicht' ? 'on' : ''}">zu leicht</button><button data-fb="ok" class="${fb[it.exId] === 'ok' ? 'on' : ''}">passt</button><button data-fb="schwer" class="${fb[it.exId] === 'schwer' ? 'on' : ''}">zu schwer</button></div>` : ''}
      </div>
      <button class="tick" aria-label="Übung erledigt">${TICK}</button>
    </div>
  </div>`;
}

function checkCard(it, check, day) {
  const v = check || {};
  const done = !!check;
  const needed = day.type === 'run' || day.weekday === 1 || (state.data?.ampel && state.data.ampel !== 'gruen');
  return `<div class="card check-card ${done ? 'done' : ''}" id="check" data-id="${esc(it.id)}">
    <div class="row-head">${icon('check')}<div><h3>Wie geht's dir heute?</h3>
      <div class="sub">${done ? 'Check gemacht ✓' : needed ? '30 Sekunden – entscheidet, ob heute alles passt.' : 'Optional heute.'}</div></div>
      <button class="btn small ${done ? '' : 'primary'}" id="check-open">${done ? 'Ändern' : 'Check'}</button></div>
    <div class="check-body" hidden>
      ${slider('squat', 'Tief in die Hocke und wieder hoch. Tut etwas weh?', v.squat ?? 0)}
      ${slider('shin', 'Mit dem Daumen innen am Schienbein entlang drücken. Schmerz?', v.shin ?? 0)}
      ${it.hop ? slider('hop', '10 Hüpfer auf jedem Bein. Schmerz?', v.hop ?? 0) : ''}
      <p class="small muted">0 = nichts · 3 = merkbar · 5 = stark</p>
      <label class="check"><input type="checkbox" id="c-bone" ${v.bone ? 'checked' : ''}> Ein Punkt am Knochen tut beim Drücken weh</label>
      <label class="check"><input type="checkbox" id="c-limp" ${v.limp ? 'checked' : ''}> Ich hinke</label>
      <label class="check"><input type="checkbox" id="c-sick" ${v.sick ? 'checked' : ''}> Ich bin krank (Fieber, Halsweh, Husten)</label>
      <label class="f" for="c-rhr">Ruhepuls von der Uhr (optional)</label><input class="in" id="c-rhr" inputmode="numeric" value="${v.rhr ?? ''}" placeholder="z. B. 54">
      <button class="btn primary block" id="save-check" style="margin-top:14px">Speichern</button>
    </div></div>`;
}
function slider(id, label, val) {
  return `<label class="f" for="s-${id}">${esc(label)}</label><div class="slider"><input type="range" min="0" max="10" step="1" id="s-${id}" value="${val}" oninput="this.nextElementSibling.value=this.value"><output>${val}</output></div>`;
}
function watchCard(it, day) {
  return `<div class="card watch-card" data-id="run:watch">
    <div class="row-head">${icon('watch')}<div><div class="label">Auf der Uhr starten</div><h3>${esc(it.workout)}</h3></div></div>
    ${day.plannedWorkout ? `<div class="tag accent">statt „${esc(day.plannedWorkout)}“</div>` : ''}
    <p class="lead">${esc(it.summary)}</p>
    <ol class="steps-list">${it.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <details class="how"><summary>So startest du es auf der Uhr</summary><div class="how-body"><ol>${it.howto.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div></details>
  </div>`;
}
function analysisHtml(r) {
  const a = r.auto;
  if (!a && !r.analysis) return '';
  const cls = a ? (a.verdict === 'gut' ? 'good' : a.verdict === 'achtung' ? 'warn' : 'info') : 'info';
  return `<div class="card note ${cls}"><div class="label">Auswertung · ${esc(r.workout || 'Lauf')}</div>
    ${r.analysis ? `<p class="coach-text">${esc(r.analysis)}</p>` : ''}
    ${a ? `<details class="how"><summary>${esc(a.title)} – Details</summary><div class="how-body">${a.points.map((p) => `<p style="margin:4px 0">${p.icon} ${esc(p.text)}</p>`).join('')}${a.tip ? `<p style="margin-top:8px"><b>Tipp:</b> ${esc(a.tip)}</p>` : ''}</div></details>` : ''}
  </div>`;
}
function runSummary(r) {
  const pace = r.distance_m && r.duration_s ? r.duration_s / (r.distance_m / 1000) : null;
  return [r.distance_m ? (r.distance_m / 1000).toFixed(1) + ' km' : null, r.duration_s ? Math.round(r.duration_s / 60) + ' min' : null, pace ? fmtSec(Math.round(pace)) + ' /km' : null, r.hr_avg ? 'Puls ' + r.hr_avg : null].filter(Boolean).join(' · ');
}
const FEELS = [[2, '😌', 'locker'], [4, '🙂', 'gut'], [6, '😐', 'mittel'], [8, '😓', 'hart'], [10, '🥵', 'Limit']];
/** Kurze Frage nach dem Lauf: Gefühl + Schmerz. */
function feelCard(r) {
  return `<div class="card feel-card" data-run="${r.id}">
    <div class="row-head">${icon('run')}<div><h3>Wie war dein Lauf?</h3><div class="sub">${esc(runSummary(r))}</div></div></div>
    <div class="feels">${FEELS.map(([v, e, l]) => `<button class="feel" data-v="${v}"><span>${e}</span>${l}</button>`).join('')}</div>
    <div class="feel-more" hidden>
      <div class="label" style="margin-top:14px">Hat etwas wehgetan oder gezwickt?</div>
      <div class="chips" id="hurt"><button class="chip" data-k="nein">Nein, alles gut</button><button class="chip" data-k="ja">Ja</button></div>
      <div id="hurt-more" hidden>
        <div class="mini-label">Wo?</div><div class="chips" id="fwhere">${SPOTS.map(([k, l]) => `<button class="chip" data-k="${k}">${l}</button>`).join('')}</div>
        <div class="mini-label">Welche Seite?</div><div class="chips" id="fside">${['links', 'rechts', 'beide'].map((s) => `<button class="chip" data-k="${s}">${s}</button>`).join('')}</div>
        ${slider('fpain', 'Wie stark? (0–10)', 2)}
        <div class="mini-label">Ist es wieder weg?</div><div class="chips" id="fgone"><button class="chip" data-k="schnell">war schnell weg</button><button class="chip" data-k="noch">ist noch da</button></div>
        <textarea class="in" id="fnote" placeholder="Optional: z. B. „beim Bergablaufen“"></textarea>
      </div>
      <button class="btn primary block" id="feel-save" style="margin-top:12px">Fertig</button>
    </div>
    <div id="feel-reply"></div>
  </div>`;
}
function followCard(f) {
  return `<div class="card follow-card" data-area="${esc(f.area)}" data-side="${esc(f.side || '')}">
    <div class="row-head">${icon('heart')}<div><div class="label">Kurze Nachfrage</div><h3>${esc(f.question)}</h3></div></div>
    <div class="answers">${[['weg', 'Weg'], ['besser', 'Besser'], ['gleich', 'Gleich'], ['schlimmer', 'Schlimmer']].map(([k, l]) => `<button class="ans ${k}" data-a="${k}">${l}</button>`).join('')}</div>
    <div class="follow-reply"></div></div>`;
}

function fpView(day, done) {
  const fp = day.fp;
  if (!fp) return '';
  const total = fp.lessons.length;
  const n = fp.lessons.filter((l) => done[l.id]).length;
  const links = state.data?.settings?.fpLinks || {};
  return `
  <div class="card"><div class="label">Functional Patterns · Woche ${fp.fpWeek || day.fpFree} von 10</div>
    <h3>${fp.fpWeek ? esc(fp.title) : 'Wiederholungswoche'}</h3>
    <p class="lead">${esc(fp.text)}</p>
    <div class="bar"><i style="width:${((fp.fpWeek || Math.min(day.fpFree, 10)) / 10) * 100}%"></i></div>
    <div class="row"><a class="btn primary" href="${esc(fp.weekUrl)}" target="_blank" rel="noopener">Woche im Kurs öffnen</a></div>
    <details class="how"><summary>Was ist Functional Patterns?</summary><div class="how-body"><p>${esc(PLAN.fp.explain)}</p><p><b>Rollen:</b> ${esc(PLAN.fp.rollRules)}</p><p><b>Werkzeug:</b> ${esc(fp.tools)}</p>${fp.goal ? `<p><b>Ziel:</b> ${esc(fp.goal)}</p>` : ''}</div></details>
  </div>
  ${day.shopping ? `<div class="card note warn"><b>Einkaufen:</b> ${esc(day.shopping)}</div>` : ''}
  ${total ? `<div class="sec-label">Lektionen · ${n} von ${total}</div>` : ''}
  ${fp.lessons.map((l, i) => `
    <div class="card ex-card ${done[l.id] ? 'done' : ''}" data-id="${esc(l.id)}">
      <div class="ex"><div class="num">${i + 1}</div><div class="ex-main">
        <h3>${esc(l.name)}</h3><span class="lesson-mode ${l.mode}">${l.mode === 'machen' ? 'Mitmachen' : l.mode === 'freiwillig' ? 'Freiwillig' : 'Nur ansehen'}</span>
        <div class="collapse-when-done"><div class="sub">${esc(l.how)}</div><div class="row"><a class="btn small" href="${esc(links[l.lessonId] || l.url)}" target="_blank" rel="noopener">Video öffnen</a></div></div>
      </div><button class="tick" aria-label="Lektion erledigt">${TICK}</button></div>
    </div>`).join('')}`;
}

function coachCard(data, day) {
  const notes = data.notes || [];
  const reasons = day.reasons || [];
  const msgs = data.messages || [];
  if (!notes.length && !reasons.length && !msgs.length && !day.note) return '';
  const latest = notes[0];
  const warn = msgs.find((m) => m.type === 'warn');
  const more = [...notes.slice(1).map((n) => n.text), ...msgs.filter((m) => m !== warn).map((m) => m.text)];
  return `<div class="card coach-card ${warn ? 'warn' : ''}">
    <div class="row-head">${icon('coach')}<div class="label">Dein Coach</div></div>
    ${warn ? `<p class="coach-text strong">${esc(warn.text)}</p>` : ''}
    ${latest ? `<p class="coach-text">${esc(latest.text)}</p>` : ''}
    ${reasons.length ? `<div class="adjusted"><b>Heute angepasst:</b> ${esc(reasons[0])}</div>${reasons.length > 1 ? `<details class="how"><summary>Mehr Gründe (${reasons.length - 1})</summary><div class="how-body">${reasons.slice(1).map((r) => `<p>${esc(r)}</p>`).join('')}</div></details>` : ''}` : ''}
    ${!latest && !reasons.length && day.note ? `<p class="coach-text">${esc(day.note)}</p>` : ''}
    ${more.length ? `<details class="how"><summary>Weitere Hinweise (${more.length})</summary><div class="how-body">${more.map((t) => `<p>${esc(t)}</p>`).join('')}</div></details>` : ''}
  </div>`;
}

function chatCard(data) {
  const mine = (data.myNotes || []).map((n) => ({ t: n.created_at || '', me: true, text: n.text }));
  const firstMine = mine.map((m) => m.t).sort()[0];
  const theirs = (data.notes || []).filter((n) => n.date === state.date && firstMine && (n.created_at || '') > firstMine).map((n) => ({ t: n.created_at || '', me: false, text: n.text }));
  const conv = [...mine, ...theirs].sort((a, b) => a.t.localeCompare(b.t)).slice(-6);
  return `<div class="card chat-card" id="coachnote">
    <div class="row-head">${icon('coach')}<div><h3>Schreib deinem Coach</h3><div class="sub">Zwickt was? Müde? Frage? Die App passt sofort an, Claude antwortet um 7, 10, 13, 18, 20 und 22 Uhr.</div></div></div>
    <div class="bubbles" id="bubbles">${conv.map((m) => `<div class="bubble ${m.me ? 'me' : ''}">${esc(m.text)}</div>`).join('')}</div>
    <div class="chat-input"><textarea class="in" id="cn-text" rows="2" placeholder="z. B. „Rechtes Schienbein hat beim Laufen etwas wehgetan“"></textarea>
    <button class="btn primary send" id="cn-send" aria-label="Senden">${icon('send')}</button></div>
  </div>`;
}

/** Wann schaut Claude das nächste Mal drauf? */
function nextRound() {
  const h = +new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(new Date());
  const n = [7, 10, 13, 18, 20, 22].find((x) => x > h);
  return n ? `Claude schaut es sich um ${n} Uhr genau an und antwortet dir.` : 'Claude schaut es sich morgen um 7 Uhr genau an und antwortet dir.';
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
    data = { day: getDay(state.date, { mini: state.mini }), done: {}, runs: [], notes: [], messages: [], feedback: {}, ampel: null, offline: true, settings: {} };
    state.data = data;
  }
  if (data.settings && data.settings.onboarded === false && !sessionStorage.getItem('onbSkip')) { sessionStorage.setItem('onbSkip', '1'); return renderOnboarding(0); }
  const { day, done, runs, feedback, ampel, check } = data;
  const isToday = state.date === today();
  const weekLabel = day.week === 0 ? 'Vorbereitung' : day.week > 12 ? 'Nach dem Plan' : `Woche ${day.week} von 12${day.easy ? ' · leichte Woche' : ''}`;
  const AMPEL = { gruen: ['Grün', 'Alles okay'], gelb: ['Gelb', 'Heute vorsichtiger'], rot: ['Rot', 'Heute Pause für die Beine'] };

  const counted = day.items.filter((it) => !['watch', 'section'].includes(it.kind) && !(it.kind === 'check' && day.type !== 'run'));
  const doneCount = counted.filter((it) => isItemDone(it, done, runs, check)).length;
  const allDone = counted.length > 0 && doneCount === counted.length;
  const pct = counted.length ? Math.round((doneCount / counted.length) * 100) : 0;

  let html = `
  <header class="head">
    <div class="head-top"><span class="meta">${isToday ? 'Heute' : 'Vorschau'} · ${esc(day.label)}</span><span class="meta">${esc(weekLabel)}</span></div>
    <div class="head-main">
      <div class="type-ic ${day.type}">${icon(day.type)}</div>
      <div class="head-title"><h1>${esc(day.title)}</h1>
        <div class="chips-inline">${day.minutes ? `<span class="pill">${day.minutes} min</span>` : ''}${ampel ? `<span class="pill ${ampel}" title="${AMPEL[ampel][1]}"><i class="dot-c"></i>${AMPEL[ampel][0]} · ${AMPEL[ampel][1]}</span>` : ''}</div></div>
      ${counted.length > 1 ? `<div class="ring" style="--p:${pct}"><span>${doneCount}/${counted.length}</span></div>` : ''}
    </div>
    <div class="dayswitch"><button data-go="-1" aria-label="Vorheriger Tag">‹</button>${isToday ? '' : '<button data-go="0">Heute</button>'}<button data-go="1" aria-label="Nächster Tag">›</button></div>
  </header>`;
  if (data.offline) html += '<div class="card note warn small">Offline – Haken werden gerade nicht gespeichert.</div>';

  // 1. Fragen zuerst: Nachfrage, Lauf-Gefühl
  for (const f of data.followups || []) if (isToday) html += followCard(f);
  const openRun = runs.find((r) => !r.rpe);
  if (openRun && state.date <= today()) html += feelCard(openRun);

  // 2. Coach
  html += coachCard(data, day);
  if (day.general && day.type === 'strength') html += `<details class="how general"><summary>So läuft die Einheit ab</summary><div class="how-body">${esc(day.general)}</div></details>`;
  if (day.dailyReminder) html += `<div class="card note info small">${esc(day.dailyReminder)}</div>`;

  // 3. Training
  if (day.type === 'fp') html += fpView(day, done);
  let idx = 0;
  for (const it of day.items) {
    if (it.kind === 'exercise') html += exerciseCard(it, idx++, done, feedback || {});
    else if (it.kind === 'check') html += checkCard(it, check, day);
    else if (it.kind === 'watch') html += watchCard(it, day);
    else if (it.kind === 'runlog') {
      for (const r of runs) html += (r.rpe ? `<div class="card done-run"><div class="row-head">${icon('run')}<div><h3>Lauf eingetragen ✓</h3><div class="sub">${esc(runSummary(r))} · Gefühl ${r.rpe}/10</div></div><a class="btn small" href="#lauf/${state.date}">Ändern</a></div></div>` : '') + analysisHtml(r);
      if (!runs.length) html += `<div class="card"><div class="row-head">${icon('run')}<div><h3>Nach dem Lauf</h3><div class="sub">Dein Lauf kommt automatisch von der Uhr. Dann fragt dich die App kurz, wie es war.</div></div></div><div class="row"><a class="btn small" href="#lauf/${state.date}">Selbst eintragen</a></div></div>`;
    } else if (it.kind === 'section') { html += `<div class="sec-label accent">${esc(it.name)}</div>`; if (it.general) html += `<details class="how general"><summary>So läuft es ab</summary><div class="how-body">${esc(it.general)}</div></details>`; idx = 0; }
  }
  if (!day.items.some((it) => it.kind === 'runlog') && runs.length) {
    html += '<div class="sec-label">Dein Lauf heute</div>';
    for (const r of runs) html += (r.rpe ? `<div class="card"><h3>${esc(r.workout || 'Lauf')}</h3><div class="sub">${esc(runSummary(r))}</div></div>` : '') + analysisHtml(r);
  }
  if (day.optional) html += `<div class="card note info small">${esc(day.optional)}</div>`;

  if (allDone) html += `<div class="card finished"><div class="big">Geschafft!</div><div class="muted" id="weekprog">Stark gemacht.</div></div>`;
  if (state.date <= today()) html += chatCard(data);
  if (day.type === 'strength' || day.type === 'run') {
    html += `<div class="row bottom-actions">${day.hasMini ? `<button class="btn" id="mini">${state.mini ? 'Ganze Einheit' : 'Mini-Version (15 min)'}</button>` : ''}${isToday ? '<button class="btn" id="move">Auf morgen verschieben</button>' : ''}</div>`;
  }
  app.innerHTML = html;
  bindToday(day, done, runs);
  if (allDone) {
    if (sessionStorage.getItem('confetti') !== state.date) { sessionStorage.setItem('confetti', state.date); confetti(); }
    api(`/week?date=${state.date}`).then((w) => {
      const tr = w.days.filter((d) => d.type === 'run' || d.type === 'strength');
      const el = document.getElementById('weekprog');
      if (el) el.textContent = `${tr.filter((d) => d.complete).length} von ${tr.length} Einheiten diese Woche`;
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
  // Check
  const cc = app.querySelector('.check-card');
  if (cc) {
    cc.querySelector('#check-open').onclick = () => { const b = cc.querySelector('.check-body'); b.hidden = !b.hidden; };
    if (location.hash.startsWith('#check')) cc.querySelector('.check-body').hidden = false;
    cc.querySelector('#save-check').onclick = async (ev) => {
      ev.target.disabled = true;
      const body = { date: state.date, squat: +cc.querySelector('#s-squat').value, shin: +cc.querySelector('#s-shin').value, hop: cc.querySelector('#s-hop') ? +cc.querySelector('#s-hop').value : null,
        bone: cc.querySelector('#c-bone').checked, limp: cc.querySelector('#c-limp').checked, sick: cc.querySelector('#c-sick').checked, rhr: cc.querySelector('#c-rhr').value };
      try { await api('/check', { method: 'POST', body }); toast('Check gespeichert'); renderToday(); } catch (e) { toast(e.message); ev.target.disabled = false; }
    };
  }
  app.querySelectorAll('.ex-card[data-id]').forEach((card) => {
    const id = card.dataset.id;
    const it = day.items.find((x) => x.id === id) || day.fp?.lessons.find((x) => x.id === id);
    if (!it) return;
    const tick = card.querySelector('.tick');
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
        toast(b.dataset.fb === 'leicht' ? 'Notiert. Zweimal „zu leicht“ → nächste Stufe.' : b.dataset.fb === 'schwer' ? 'Notiert. Nächstes Mal leichter.' : 'Gut so!');
        renderToday();
      } catch (e) { toast(e.message); }
    });
  });
  // Nachfrage
  app.querySelectorAll('.follow-card').forEach((card) => card.querySelectorAll('.ans').forEach((b) => b.onclick = async () => {
    card.querySelectorAll('.ans').forEach((x) => { x.disabled = true; x.classList.toggle('on', x === b); });
    try {
      const r = await api('/spotcheck', { method: 'POST', body: { date: state.date, area: card.dataset.area, side: card.dataset.side || null, answer: b.dataset.a } });
      card.querySelector('.follow-reply').innerHTML = `<p class="coach-text">${esc(r.text)}</p>`;
    } catch (e) { toast(e.message); card.querySelectorAll('.ans').forEach((x) => { x.disabled = false; }); }
  }));
  // Wie war dein Lauf?
  const fc = app.querySelector('.feel-card');
  if (fc) {
    const f = { rpe: null, hurt: null, where: new Set(), side: null, gone: null };
    fc.querySelectorAll('.feel').forEach((b) => b.onclick = () => { f.rpe = +b.dataset.v; fc.querySelectorAll('.feel').forEach((x) => x.classList.toggle('on', x === b)); fc.querySelector('.feel-more').hidden = false; });
    fc.querySelectorAll('#hurt .chip').forEach((c) => c.onclick = () => { f.hurt = c.dataset.k; fc.querySelectorAll('#hurt .chip').forEach((x) => x.classList.toggle('on', x === c)); fc.querySelector('#hurt-more').hidden = f.hurt !== 'ja'; });
    fc.querySelectorAll('#fwhere .chip').forEach((c) => c.onclick = () => { const k = c.dataset.k; f.where.has(k) ? f.where.delete(k) : f.where.add(k); c.classList.toggle('on'); });
    for (const [g, key] of [['fside', 'side'], ['fgone', 'gone']]) fc.querySelectorAll(`#${g} .chip`).forEach((c) => c.onclick = () => { f[key] = f[key] === c.dataset.k ? null : c.dataset.k; fc.querySelectorAll(`#${g} .chip`).forEach((x) => x.classList.toggle('on', x.dataset.k === f[key])); });
    fc.querySelector('#feel-save').onclick = async (ev) => {
      if (!f.rpe) return toast('Tipp erst an, wie sich der Lauf angefühlt hat.');
      const hurt = f.hurt === 'ja';
      ev.target.disabled = true; ev.target.textContent = 'Coach schaut sich das an …';
      try {
        const r = await api('/run/feel', { method: 'POST', body: { id: +fc.dataset.run, date: state.date, rpe: f.rpe, pain: hurt ? +fc.querySelector('#s-fpain').value : 0, pain_where: hurt ? [...f.where].join(',') || null : null, pain_side: hurt ? f.side : null, pain_gone: hurt ? f.gone : null, note: fc.querySelector('#fnote').value.trim() || null } });
        fc.querySelector('.feel-more').hidden = true; fc.querySelector('.feels').hidden = true;
        fc.querySelector('#feel-reply').innerHTML = `<p class="coach-text">${esc(r.coach || `Danke, ist gespeichert! ${nextRound()}`)}</p><button class="btn small" id="feel-ok">Okay</button>`;
        fc.querySelector('#feel-ok').onclick = () => renderToday();
      } catch (e) { toast(e.message); ev.target.disabled = false; ev.target.textContent = 'Fertig'; }
    };
  }
  // Chat
  const cn = document.getElementById('cn-send');
  if (cn) cn.onclick = async () => {
    const ta = document.getElementById('cn-text');
    const text = ta.value.trim();
    if (!text) return toast('Schreib kurz, wie es dir geht.');
    cn.disabled = true;
    const bubbles = document.getElementById('bubbles');
    bubbles.insertAdjacentHTML('beforeend', `<div class="bubble me">${esc(text)}</div><div class="bubble typing" id="typing">Coach schreibt …</div>`);
    ta.value = '';
    try {
      const r = await api('/note', { method: 'POST', body: { date: state.date, text } });
      const fallback = `${r.areas.length ? `Verstanden: ${r.areas.map((a) => AREA_NAMES[a] || a).join(', ')}. ` : 'Danke, ist angekommen. '}${r.upcoming.length ? r.upcoming.map((u) => `${u.label}: Extra-Übungen ${u.extras.join(', ')}.`).join(' ') + ' ' : ''}${nextRound()}`;
      document.getElementById('typing').outerHTML = `<div class="bubble">${esc(r.coach || fallback)}</div>`;
    } catch (e) { document.getElementById('typing')?.remove(); toast(e.message); ta.value = text; }
    cn.disabled = false;
  };
  const mini = document.getElementById('mini');
  if (mini) mini.onclick = () => { state.mini = !state.mini; renderToday(); };
  const move = document.getElementById('move');
  if (move) move.onclick = async () => {
    if (!confirm('Training auf morgen verschieben? (höchstens 1 Tag, nicht nachholen)')) return;
    try { await api('/move', { method: 'POST', body: { date: state.date } }); toast('Auf morgen verschoben'); renderToday(); } catch (e) { alert(e.message); }
  };
}

// ---------- Lauf eintragen ----------
async function renderRunForm() {
  nav('heute');
  let data = null;
  try { data = await api(`/day?date=${state.date}`); state.data = data; } catch (e) { if (e instanceof AuthError) return renderLogin(); }
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
      app.querySelector('#reply').innerHTML = `<div class="card note good" style="margin-top:14px"><div class="label">Gespeichert ✓</div>${res.coach ? `<p class="coach-text">${esc(res.coach)}</p>` : ''}
        ${(res.messages || []).map((m) => `<p>💬 ${esc(m.text)}</p>`).join('')}
        ${up.length ? `<details class="how"><summary>Was sich ändert (${up.length})</summary><div class="how-body">${up.map((u) => `<p><b>${esc(u.label)}:</b> ${esc(u.reasons.join(' '))}</p>`).join('')}</div></details>` : res.coach ? '' : '<p>Alles grün – der Plan bleibt, wie er ist.</p>'}
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
function lineChart(points, { color = 'var(--accent)', unit = '', band = null, yLabel = '' } = {}) {
  if (points.length < 2) return '<p class="small muted">Noch zu wenig Daten – nach ein paar Läufen erscheint hier ein Diagramm.</p>';
  const W = 340, H = 190, L = 34, R = 10, T = 18, B = 34;
  const vals = points.map((p) => p.v);
  let min = Math.min(...vals, band ? band[0] : Infinity) - 3, max = Math.max(...vals, band ? band[1] : -Infinity) + 3;
  min = Math.floor(min / 5) * 5; max = Math.ceil(max / 5) * 5;
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const grid = [];
  for (let g = min; g <= max; g += (max - min) / 4) grid.push(Math.round(g));
  const every = Math.ceil(points.length / 6);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" style="height:auto">
    ${band ? `<rect x="${L}" y="${y(band[1])}" width="${W - L - R}" height="${y(band[0]) - y(band[1])}" fill="var(--ok)" opacity=".13"/>
      <text x="${W - R - 4}" y="${y(band[1]) + 12}" font-size="10" fill="var(--ok)" text-anchor="end">Ziel ${band[0]}–${band[1]}</text>` : ''}
    ${grid.map((g) => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(g) + 4}" font-size="10" fill="var(--muted)" text-anchor="end">${g}</text>`).join('')}
    <text x="4" y="10" font-size="10" fill="var(--muted)">${esc(yLabel)}</text>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="4" fill="${band ? (p.v > band[1] + 2 ? 'var(--bad)' : p.v >= band[0] - 10 ? 'var(--ok)' : 'var(--muted)') : color}"/><text x="${x(i)}" y="${y(p.v) - 8}" font-size="10" font-weight="700" fill="var(--text)" text-anchor="middle">${p.v}</text>`).join('')}
    ${points.map((p, i) => (i % every === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${H - 14}" font-size="10" fill="var(--muted)" text-anchor="middle">${p.l}</text>` : '')).join('')}
    <text x="${(W + L) / 2}" y="${H - 2}" font-size="10" fill="var(--muted)" text-anchor="middle">Datum des Laufs</text>
  </svg>`;
}
function barChart(points, { color = 'var(--ok)', unit = '', highlightLast = false } = {}) {
  if (!points.length) return '<p class="small muted">Noch keine Daten.</p>';
  const W = 340, H = 190, L = 10, R = 10, T = 22, B = 34;
  const max = Math.max(...points.map((p) => p.v), 1);
  const bw = (W - L - R) / points.length;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" style="height:auto">
    ${points.map((p, i) => {
      const h = ((H - T - B) * p.v) / max;
      const cx = L + i * bw + bw / 2;
      const last = highlightLast && i === points.length - 1;
      return `<rect x="${L + i * bw + bw * 0.18}" y="${H - B - h}" width="${bw * 0.64}" height="${Math.max(h, 1)}" rx="5" fill="${color}" opacity="${last ? 0.55 : 1}"/>
        <text x="${cx}" y="${H - B - h - 6}" font-size="11" font-weight="700" fill="var(--text)" text-anchor="middle">${p.v}${unit}</text>
        <text x="${cx}" y="${H - B + 14}" font-size="10" fill="var(--muted)" text-anchor="middle">${p.l}</text>`;
    }).join('')}
    <text x="${W / 2}" y="${H - 2}" font-size="10" fill="var(--muted)" text-anchor="middle">Woche ab Montag${highlightLast ? ' (hell = diese Woche, läuft noch)' : ''}</text>
  </svg>`;
}
async function renderHistory() {
  nav('verlauf');
  app.innerHTML = '<div class="spinner">Lade …</div>';
  let h;
  try { h = await api('/history'); } catch (e) { if (e instanceof AuthError) return renderLogin(); app.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  const runs = h.runs;
  const asc = [...runs].reverse();
  const dd = (d) => `${+d.slice(8)}.${+d.slice(5, 7)}.`;
  const easy = asc.filter((r) => ['easy', 'long'].includes(PLAN.workouts[r.workout]?.kind) && r.hr_avg && (r.distance_m || 0) > 3000).slice(-10).map((r) => ({ v: r.hr_avg, l: dd(r.date) }));
  const weeks = {};
  const thisMon = addDays(today(), -((new Date(today() + 'T12:00:00Z').getUTCDay() + 6) % 7));
  for (let i = 7; i >= 0; i--) weeks[addDays(thisMon, -7 * i)] = 0;
  for (const r of asc) { const mon = addDays(r.date, -((new Date(r.date + 'T12:00:00Z').getUTCDay() + 6) % 7)); if (mon in weeks) weeks[mon] += (r.distance_m || 0) / 1000; }
  const km = Object.entries(weeks).map(([m, v]) => ({ v: Math.round(v), l: dd(m) }));
  const last5 = easy.slice(-5).map((p) => p.v);
  const prev5 = easy.slice(-10, -5).map((p) => p.v);
  const avgN = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const trend = avgN(last5) && avgN(prev5) ? avgN(last5) - avgN(prev5) : null;
  const weekKm = km[km.length - 1].v;
  const monthRuns = runs.filter((r) => r.date >= addDays(today(), -30) && (r.distance_m || 0) > 2000).length;
  const feels = asc.filter((r) => r.rpe && ['easy', 'long'].includes(PLAN.workouts[r.workout]?.kind)).slice(-5).map((r) => r.rpe);
  const feelAvg = feels.length ? (feels.reduce((a, b) => a + b, 0) / feels.length).toFixed(1) : null;
  const SA = { weg: ['Weg', 'gruen'], besser: ['Besser', 'gruen'], gleich: ['Gleich', 'gelb'], schlimmer: ['Schlimmer', 'rot'] };
  const spots = (h.spots || []).map((s) => `<div class="spot-row"><div><b>${esc(AREA_NAMES[s.area] || s.area)}${s.side ? ` (${esc(s.side)})` : ''}</b><div class="sub">zuletzt ${+s.last.slice(8)}.${+s.last.slice(5, 7)}. · ${s.count}× gemeldet</div></div><span class="pill ${s.closed ? 'gruen' : s.lastAnswer ? SA[s.lastAnswer][1] : 'gelb'}">${s.closed ? 'Weg' : s.lastAnswer ? SA[s.lastAnswer][0] : 'Wird beobachtet'}</span></div>`).join('');
  app.innerHTML = `<h2 class="sec">Verlauf</h2>
    <div class="card"><div class="grid2">
      <div><div class="label">Diese Woche</div><div class="stat">${weekKm} km</div></div>
      <div><div class="label">Läufe in 30 Tagen</div><div class="stat">${monthRuns}</div></div>
      <div><div class="label">Puls locker</div><div class="stat">${avgN(last5) ?? '–'}</div><div class="sub">Schnitt der letzten 5 · Ziel 145–162</div></div>
      <div><div class="label">Gefühl locker</div><div class="stat">${feelAvg ?? '–'}</div><div class="sub">Schnitt 1–10 · Ziel 2–4</div></div>
      <div><div class="label">Ausdauer</div><div class="stat">${trend == null ? '–' : trend <= -2 ? 'besser' : trend >= 2 ? 'Puls höher' : 'gleich'}</div><div class="sub">${trend == null ? 'zeigt sich nach 10 Läufen' : `${trend > 0 ? '+' : ''}${trend} Schläge zu den 5 Läufen davor`}</div></div>
    </div></div>
    ${spots ? `<div class="card"><div class="label">Deine Beschwerden</div><p class="sub" style="margin:0 0 4px">Der Coach fragt nach, bis alles weg ist.</p>${spots}</div>` : ''}
    <div class="card"><div class="label">Ø-Puls bei lockeren und langen Läufen</div>
      <p class="small muted" style="margin:0 0 4px">Jeder Punkt ist ein Lauf (über 3 km). Grüner Streifen = dein Ziel. Grüner Punkt: passt. Roter Punkt: zu schnell gelaufen.</p>
      ${lineChart(easy, { band: [145, 162], yLabel: 'Puls', color: 'var(--muted)' })}
      <p class="small muted">Liegen die Punkte im grünen Streifen, läufst du wirklich locker. Wird der Puls bei gleichem Tempo niedriger, wird deine Ausdauer besser.</p></div>
    <div class="card"><div class="label">Kilometer pro Woche</div>${barChart(km, { unit: '', highlightLast: true })}
      <p class="small muted">Gleichmäßig ist besser als hohe Spitzen: höchstens etwa 10 % mehr pro Woche.</p></div>
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
    ['Dein Coach', '<p>Schreib ihm unten auf „Heute“, wenn etwas zwickt, du müde bist oder eine Frage hast. Die App passt deinen Plan sofort an. Claude liest es um 7, 10, 13, 18, 20 und 22 Uhr und antwortet dir.</p><p>Nach jedem Lauf fragt dich die App kurz: <b>Wie war es?</b> und <b>Hat etwas wehgetan?</b> Hast du eine Stelle genannt, fragt er in den nächsten Tagen nach, wie es ihr geht. Die Extra-Übungen werden mit der Zeit schwerer (Stufe 1–3) und fallen weg, wenn alles gut ist.</p>'],
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
      <p class="small muted">Außerdem: 15:00 an Lauftagen „Wie geht's dir?“ · 17:30 Erinnerung, wenn noch nichts erledigt ist · 20:00 Vorschau auf morgen · 20:30 „Wie war dein Lauf?“ · Sonntag 19:00 Wochenbericht. Dazu Nachrichten von deinem Coach.</p>
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
  const isD = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x);
  if (h.startsWith('tag/') || h.startsWith('heute/')) { const d = h.split('/')[1]; state.date = isD(d) ? d : today(); state.mini = false; return renderToday(); }
  if (h.startsWith('lauf/')) { const d = h.split('/')[1]; if (isD(d)) state.date = d; state.data = null; return renderRunForm(); }
  switch (h) {
    case 'woche': return renderWeek();
    case 'plan': return renderPlan();
    case 'verlauf': return renderHistory();
    case 'hilfe': return renderHelp();
    case 'einstellungen': return renderSettings();
    case 'bericht': return renderReport();
    case 'lauf': state.data = null; return renderRunForm();
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
    if (!v.build || v.build === BUILD) return;
    const h = location.hash;
    const busy = timer || h.startsWith('#lauf') || [...document.querySelectorAll('textarea, input.in')].some((x) => x.value && x !== document.getElementById('c-rhr')) || document.querySelector('.feel.on');
    let tried = null; try { tried = sessionStorage.getItem('reloadedFor'); } catch { /* egal */ }
    if (busy || tried === v.build) return;
    try { sessionStorage.setItem('reloadedFor', v.build); } catch { /* egal */ }
    location.reload();
  } catch { /* offline */ }
}
function softRefresh() {
  const h = (location.hash || '#heute').slice(1);
  const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (typing || timer || document.querySelector('details[open]') || h.startsWith('lauf') || document.getElementById('cn-text')?.value || document.querySelector('.feel.on, .check-body:not([hidden]), .ans:disabled')) return;
  if (h === 'heute' || h.startsWith('tag/') || h.startsWith('heute/')) renderToday();
  else if (['woche', 'verlauf', 'bericht'].includes(h)) route();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { checkUpdate(); softRefresh(); } });
setInterval(() => { if (document.visibilityState === 'visible') { checkUpdate(); softRefresh(); } }, 60000);
checkUpdate();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
route();
window.__API = API;
