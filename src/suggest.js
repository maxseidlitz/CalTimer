// Bewertet Termine danach, wie sehr sich ein Countdown für sie lohnt.

const DAY = 24 * 60 * 60 * 1000;
const MIN_SCORE = 3;

const KEYWORDS = [
  { label: 'Reise', words: ['urlaub', 'reise', 'ferien', 'flug', 'abflug', 'trip', 'hotel', 'kurztrip', 'wochenendtrip', 'roadtrip', 'camping', 'skiurlaub'] },
  { label: 'Feier', words: ['geburtstag', 'birthday', 'bday', 'hochzeit', 'party', 'feier', 'jubiläum', 'jahrestag', 'silvester', 'weihnachten', 'heiligabend', 'ostern', 'taufe', 'polterabend', 'junggesellen'] },
  { label: 'Event', words: ['konzert', 'festival', 'theater', 'musical', 'oper', 'kino', 'show', 'tour', 'stadion', 'spiel', 'match', 'marathon', 'lauf', 'wettkampf', 'turnier', 'messe'] },
  { label: 'Wichtig', words: ['prüfung', 'klausur', 'examen', 'abschluss', 'deadline', 'abgabe', 'präsentation', 'vorstellungsgespräch', 'interview', 'umzug', 'einzug', 'release', 'launch'] },
];

const ROUTINE = new Set(['daily', 'weekly', 'monthly', 'hourly', 'minutely', 'secondly', 'yes']);

function toDate(value, allDay) {
  if (allDay) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

function keywordMatch(title) {
  const t = title.toLowerCase();
  for (const group of KEYWORDS) {
    if (group.words.some((w) => new RegExp(`(^|[^a-zäöüß])${w}`, 'i').test(t))) return group.label;
  }
  return null;
}

export function score(ev, now = new Date()) {
  const start = toDate(ev.start, ev.allDay);
  const end = toDate(ev.end, ev.allDay);
  const reasons = [];
  let points = 0;

  const keyword = keywordMatch(ev.title);
  if (keyword) {
    points += 4;
    reasons.push(keyword);
  }

  // Routine-Termine (wöchentliches Meeting …) sind keine Countdown-Kandidaten.
  if (ROUTINE.has(ev.repeat) && !keyword) return { points: 0, reasons };

  const days = (end - start) / DAY;
  if (days >= 2) {
    points += 3;
    reasons.push(`${Math.round(days)} Tage`);
  } else if (ev.allDay) {
    points += 2;
    reasons.push('Ganztägig');
  } else if (days * 24 >= 3) {
    points += 1;
  }

  const away = (start - now) / DAY;
  if (away >= 7) points += 1;
  if (away < 0.25) points -= 2; // in wenigen Stunden – Countdown kaum sinnvoll

  if (ev.repeat === 'yearly') reasons.push('Jährlich');

  return { points, reasons };
}

/**
 * Liefert die besten Vorschläge: pro Titel nur das nächste Vorkommen,
 * ohne bereits angelegte oder ausgeblendete Termine.
 */
export function suggest(events, { exclude = new Set(), limit = 6, now = new Date() } = {}) {
  const seenTitles = new Set();
  const out = [];
  for (const ev of events) {
    if (toDate(ev.start, ev.allDay) <= now) continue;
    if (exclude.has(ev.id)) continue;
    const titleKey = ev.title.trim().toLowerCase();
    if (seenTitles.has(titleKey)) continue;
    const { points, reasons } = score(ev, now);
    if (points < MIN_SCORE) continue;
    seenTitles.add(titleKey);
    out.push({ ...ev, reasons, score: points });
  }
  // Stärkste Vorschläge zuerst, bei Gleichstand der frühere Termin.
  return out
    .sort((a, b) => b.score - a.score || toDate(a.start, a.allDay) - toDate(b.start, b.allDay))
    .slice(0, limit);
}
