// Vom Coach verbesserte Übungs-Erklärungen: speichern (mit alter Version) und passend einsetzen.
import { PLAN } from './plan.js';

const ALL = () => [...PLAN.strength.A.exercises, ...PLAN.strength.B.exercises, ...Object.values(PLAN.extraExercises).flat()];
export const knownExId = (id) => ALL().some((e) => e.id === id);
const cut = (v, n = 400) => (v == null || v === '' ? null : String(v).slice(0, n));

/** Neue Version bauen. name = Name der Variante, für die der Text gilt (z. B. „Wandsitz“). Fehler → { error }. */
export function buildExText(old, b, now) {
  if (b.undo) return old?.prev || null;
  const steps = Array.isArray(b.steps) ? b.steps.map((x) => cut(x)).filter(Boolean).slice(0, 4) : null;
  if (steps && steps.length && steps.length < 2) return { error: 'steps: 2–4 kurze Schritte' };
  const { prev: _p, ...rest } = old || {};
  const next = { ...rest };
  for (const k of ['start', 'watch', 'mistake', 'easier']) if (b[k]) next[k] = cut(b[k]);
  if (steps?.length) next.steps = steps;
  if (b.name) next.name = cut(b.name, 80);
  next.reason = cut(b.reason, 300);
  next.updated = now;
  next.prev = Object.keys(rest).length ? rest : null;
  return next;
}

/** Texte einsetzen – nur wenn der gespeicherte Text zur heutigen Variante passt. Stopp-Zeilen bleiben immer. */
export function applyExTexts(day, exTexts = {}) {
  const fix = (it) => {
    const t = it && it.kind === 'exercise' && exTexts[it.exId];
    if (!t || (t.name && t.name !== it.name)) return it;
    const out = { ...it, coachFixed: t.updated || true };
    for (const k of ['start', 'watch', 'mistake', 'easier']) if (t[k]) out[k] = t[k];
    if (Array.isArray(t.steps) && t.steps.length) {
      const stops = (it.steps || []).filter((s) => /^Stopp|Tut .* weh|aufhören/i.test(s) && !t.steps.includes(s));
      out.steps = [...t.steps, ...stops];
    }
    return out;
  };
  return { ...day, items: day.items.map(fix) };
}

/** Alte Haken (vor dem 19.11.: Zahl der Sätze) auf die neue Zählung (Zahl der Einzelschritte) umrechnen. */
export const DONE_CUTOFF = '2026-11-18T22:00:00Z';
export function normDone(day, rows) {
  const out = {};
  for (const r of rows) {
    let v = r.value;
    const it = day.items.find((x) => x.id === r.item_id);
    const n = it?.setList?.length || 0;
    if (it && n > 1 && (r.done_at || '') < DONE_CUTOFF) v = v >= (it.sets || 1) ? n : Math.min(n, it.perSide && !it.holds ? v * 2 : v);
    out[r.item_id] = v;
  }
  return out;
}
