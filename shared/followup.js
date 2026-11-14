// Gedächtnis für Beschwerden: Der Coach merkt sich jede Stelle, die gezwickt hat,
// fragt in den folgenden Tagen nach („Wie geht's deinem rechten Schienbein?“)
// und passt Kraft und Laufen an die Antwort an.
// Schmerz-Monitoring nach Silbernagel: bis 3/10 beim Training ok, am nächsten Morgen nicht schlechter.
import { diffDays } from './plan.js';

export const ANSWERS = {
  weg: { label: 'Weg ✅', short: 'weg' },
  besser: { label: 'Besser', short: 'besser' },
  gleich: { label: 'Gleich', short: 'gleich' },
  schlimmer: { label: 'Schlimmer', short: 'schlimmer' },
};

const LABEL = {
  knie: ['Knie', 'n'], schienbein: ['Schienbein', 'n'], innenknoechel: ['Innenknöchel', 'm'], aussenknoechel: ['Außenknöchel', 'm'],
  grosszehe: ['Großzeh', 'm'], wade: ['Wade', 'f'], huefte: ['Hüfte', 'f'], schulter: ['Schulter', 'f'],
};

/** „deinem rechten Schienbein“ / „deiner Wade“ (Dativ) */
export function spotDativ(area, side) {
  const [name, g] = LABEL[area] || [area, 'n'];
  const adj = side === 'rechte' ? 'rechten ' : side === 'linke' ? 'linken ' : '';
  return `${g === 'f' ? 'deiner' : 'deinem'} ${adj}${name}`;
}

/** „dein rechtes Schienbein“ / „deine Wade“ / „dein rechter Außenknöchel“ (Nominativ) */
export function spotNom(area, side) {
  const [name, g] = LABEL[area] || [area, 'n'];
  const end = { n: 'es', m: 'er', f: 'e' }[g];
  const adj = side === 'rechte' ? `recht${end} ` : side === 'linke' ? `link${end} ` : '';
  return `${g === 'f' ? 'deine' : 'dein'} ${adj}${name}`;
}

/**
 * Status jeder gemeldeten Stelle.
 * spots: Ergebnis von weakSpots (area, side, count, last)
 * checks: [{date, area, answer}] Antworten auf die Nachfrage
 */
export function spotStatus(date, spots, checks = []) {
  return spots.map((s) => {
    const mine = checks.filter((c) => c.area === s.area && c.date <= date).sort((a, b) => a.date.localeCompare(b.date) || (a.id || 0) - (b.id || 0));
    const after = mine.filter((c) => c.date >= s.last);
    const lastCheck = after[after.length - 1] || null;
    const since = diffDays(date, s.last);
    const closed = lastCheck?.answer === 'weg';
    const askedToday = mine.some((c) => c.date === date);
    let due = false;
    if (!closed && !askedToday && since >= 1 && since <= 21) {
      if (!lastCheck) due = true; // noch nie nachgefragt seit der Meldung
      else if (['gleich', 'schlimmer'].includes(lastCheck.answer)) due = diffDays(date, lastCheck.date) >= 1;
      else if (lastCheck.answer === 'besser') due = diffDays(date, lastCheck.date) >= 2;
    }
    return { ...s, since, lastAnswer: lastCheck?.answer || null, lastCheckDate: lastCheck?.date || null, closed, closedDays: closed ? diffDays(date, lastCheck.date) : null, due,
      worse: lastCheck?.answer === 'schlimmer' && diffDays(date, lastCheck.date) <= 2,
      question: `Wie geht's ${spotDativ(s.area, s.side)} heute?` };
  });
}
