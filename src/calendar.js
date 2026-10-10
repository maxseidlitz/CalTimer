import { createDAVClient } from 'tsdav';
import ICAL from 'ical.js';

const ICLOUD_URL = 'https://caldav.icloud.com';
const CLIENT_TTL = 30 * 60 * 1000;
const EVENTS_TTL = 2 * 60 * 1000;
const MAX_OCCURRENCES = 2000;

let session = null; // { key, client, calendars, createdAt }
const eventCache = new Map();

export class AuthError extends Error {}

async function connect(creds) {
  const key = `${creds.appleId}:${creds.password}`;
  if (session && session.key === key && Date.now() - session.createdAt < CLIENT_TTL) {
    return session;
  }
  let client;
  try {
    client = await createDAVClient({
      serverUrl: ICLOUD_URL,
      credentials: { username: creds.appleId, password: creds.password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
  } catch (err) {
    session = null;
    if (/401|unauthori[sz]ed|invalid credentials/i.test(String(err?.message))) {
      throw new AuthError('Apple-ID oder app-spezifisches Passwort ist falsch.');
    }
    throw err;
  }
  const calendars = (await client.fetchCalendars()).filter(
    (c) => !c.components || c.components.includes('VEVENT'),
  );
  session = { key, client, calendars, createdAt: Date.now() };
  eventCache.clear();
  return session;
}

export function resetSession() {
  session = null;
  eventCache.clear();
}

export async function verify(creds) {
  resetSession();
  const { calendars } = await connect(creds);
  return calendars.map(describeCalendar);
}

function describeCalendar(cal) {
  return {
    url: cal.url,
    name: typeof cal.displayName === 'string' ? cal.displayName : 'Kalender',
    color: normalizeColor(cal.calendarColor),
  };
}

// iCloud liefert Farben als #RRGGBBAA – fürs Frontend reicht #RRGGBB.
function normalizeColor(color) {
  if (typeof color !== 'string') return null;
  const m = color.match(/^#([0-9a-f]{6})/i);
  return m ? `#${m[1]}` : null;
}

export async function listCalendars(creds) {
  const { calendars } = await connect(creds);
  return calendars.map(describeCalendar);
}

export async function listEvents(creds, from, to) {
  const cacheKey = `${from.toISOString()}|${to.toISOString()}`;
  const cached = eventCache.get(cacheKey);
  if (cached && Date.now() - cached.at < EVENTS_TTL) return cached.events;

  const { client, calendars } = await connect(creds);
  const perCalendar = await Promise.all(
    calendars.map(async (cal) => {
      const objects = await client.fetchCalendarObjects({
        calendar: cal,
        timeRange: { start: from.toISOString(), end: to.toISOString() },
      });
      const meta = describeCalendar(cal);
      return objects.flatMap((obj) => {
        try {
          return expandObject(obj.data, from, to, meta);
        } catch (err) {
          console.warn(`Termin konnte nicht gelesen werden (${obj.url}):`, err.message);
          return [];
        }
      });
    }),
  );

  const events = perCalendar
    .flat()
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ sortKey, ...rest }) => rest);
  eventCache.set(cacheKey, { at: Date.now(), events });
  return events;
}

function registerTimezones(root) {
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    const zone = new ICAL.Timezone(tz);
    if (!ICAL.TimezoneService.has(zone.tzid)) ICAL.TimezoneService.register(zone);
  }
}

export function expandObject(data, from, to, cal) {
  if (!data) return [];
  const root = new ICAL.Component(ICAL.parse(data));
  registerTimezones(root);

  const vevents = root.getAllSubcomponents('vevent');
  const masters = vevents.filter((v) => !v.hasProperty('recurrence-id'));
  const exceptions = vevents.filter((v) => v.hasProperty('recurrence-id'));
  const out = [];

  for (const master of masters) {
    const event = new ICAL.Event(master);
    for (const ex of exceptions) {
      if (ex.getFirstPropertyValue('uid') === event.uid) event.relateException(ex);
    }

    if (!event.isRecurring()) {
      pushInstance(out, event, event.startDate, event.endDate, from, to, cal);
      continue;
    }

    const it = event.iterator();
    let next;
    let count = 0;
    while ((next = it.next()) && count++ < MAX_OCCURRENCES) {
      if (next.toJSDate() > to) break;
      const details = event.getOccurrenceDetails(next);
      pushInstance(out, details.item, details.startDate, details.endDate, from, to, cal);
    }
  }

  // Ausnahmen ohne zugehörigen Haupttermin (kommt selten vor) einzeln behandeln.
  const masterUids = new Set(masters.map((m) => m.getFirstPropertyValue('uid')));
  for (const ex of exceptions) {
    if (masterUids.has(ex.getFirstPropertyValue('uid'))) continue;
    const event = new ICAL.Event(ex);
    pushInstance(out, event, event.startDate, event.endDate, from, to, cal);
  }

  return out;
}

function pushInstance(out, item, start, end, from, to, cal) {
  if (!start) return;
  const status = item.component.getFirstPropertyValue('status');
  if (typeof status === 'string' && status.toUpperCase() === 'CANCELLED') return;

  const allDay = start.isDate;
  const startJs = start.toJSDate();
  const endJs = end ? end.toJSDate() : startJs;
  if (endJs < from || startJs > to) return;

  out.push({
    id: `${item.uid}|${start.toString()}`,
    uid: item.uid,
    title: item.summary || '(Ohne Titel)',
    location: item.location || null,
    allDay,
    // Ganztägige Termine als reines Datum, damit die Zeitzone keine Rolle spielt.
    start: allDay ? dateOnly(start) : startJs.toISOString(),
    end: allDay ? dateOnly(end || start) : endJs.toISOString(),
    calendar: cal.name,
    color: cal.color,
    sortKey: startJs.getTime(),
  });
}

function dateOnly(t) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
}
