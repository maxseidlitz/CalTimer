// Demo-Kalender mit Beispielterminen, aktiv mit DEMO=1 – zum Ausprobieren ohne iCloud.
export { AuthError } from './calendar.js';

const CALENDARS = [
  { url: 'demo:privat', name: 'Privat', color: '#ff6a3d' },
  { url: 'demo:arbeit', name: 'Arbeit', color: '#3d8bff' },
  { url: 'demo:familie', name: 'Familie', color: '#34c759' },
];

const TEMPLATES = [
  ['Zahnarzt', 0, 'Privat', 'Praxis Dr. Weber'],
  ['Team-Meeting', 1, 'Arbeit', 'Raum 3'],
  ['Geburtstag Oma', 0, 'Familie', null, true],
  ['Konzert', 2, 'Privat', 'Stadthalle'],
  ['Projekt-Deadline', 1, 'Arbeit', null],
  ['Flug nach Lissabon', 0, 'Privat', 'Flughafen'],
  ['Elternabend', 2, 'Familie', 'Grundschule'],
  ['Urlaub', 0, 'Privat', null, true],
];

export function resetSession() {}
export async function verify() { return CALENDARS; }
export async function listCalendars() { return CALENDARS; }

export async function listEvents(_creds, from, to) {
  const out = [];
  const pad = (n) => String(n).padStart(2, '0');
  const dateOnly = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  // Deterministisch über alle Tage verteilt, damit Liste und Monat zusammenpassen.
  for (let i = -40; i < 400; i++) {
    if ((i * 7 + 3) % 5 > 1) continue;
    const [title, hourSeed, calName, location, allDay] = TEMPLATES[((i % TEMPLATES.length) + TEMPLATES.length) % TEMPLATES.length];
    const cal = CALENDARS.find((c) => c.name === calName);
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const start = allDay ? day : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9 + hourSeed * 3 + (i % 3), (i % 2) * 30);
    const end = allDay
      ? new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
      : new Date(start.getTime() + 90 * 60 * 1000);
    if (end < from || start > to) continue;
    out.push({
      id: `demo-${i}`,
      uid: `demo-${i}`,
      title,
      location,
      allDay: Boolean(allDay),
      start: allDay ? dateOnly(start) : start.toISOString(),
      end: allDay ? dateOnly(end) : end.toISOString(),
      calendar: cal.name,
      color: cal.color,
    });
  }
  return out;
}
