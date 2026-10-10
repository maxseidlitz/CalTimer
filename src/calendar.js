import { createHash } from 'node:crypto';
import ICAL from 'ical.js';

const FEED_TTL = 5 * 60 * 1000;
const EVENTS_TTL = 2 * 60 * 1000;
const FETCH_TIMEOUT = 15_000;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_OCCURRENCES = 50_000;

const PALETTE = ['#ff6a3d', '#3d8bff', '#34c759', '#af52de', '#ff9f0a', '#ff375f', '#5ac8fa'];

const feedCache = new Map(); // url-hash -> { at, text }
const eventCache = new Map();

export class FeedError extends Error {}

const urlHash = (url) => createHash('sha256').update(url).digest('hex').slice(0, 16);

/**
 * Nur öffentliche iCloud-Kalenderlinks über HTTPS. Verhindert, dass der Server
 * dazu missbraucht wird, beliebige Adressen (z. B. Geräte im Heimnetz) abzufragen.
 */
export function normalizeFeedUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw new FeedError('Das ist kein gültiger Link.');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new FeedError('Nur https-/webcal-Links ohne Port oder Zugangsdaten sind erlaubt.');
  }
  if (host !== 'icloud.com' && !host.endsWith('.icloud.com')) {
    throw new FeedError('Nur öffentliche iCloud-Kalenderlinks (…icloud.com) werden unterstützt.');
  }
  return url.href;
}

/** Gekürzte Anzeige – der vollständige Link verlässt den Server nie. */
export function maskUrl(url) {
  const u = new URL(url);
  return `${u.hostname}/…${u.pathname.slice(-4)}`;
}

async function readLimited(res) {
  const declared = Number(res.headers.get('content-length'));
  if (declared > MAX_BYTES) throw new FeedError('Kalender ist zu groß.');
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new FeedError('Kalender ist zu groß.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function download(feedUrl) {
  let url = normalizeFeedUrl(feedUrl);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        headers: { Accept: 'text/calendar' },
      });
    } catch (err) {
      throw new FeedError(err.name === 'TimeoutError' ? 'iCloud antwortet nicht.' : 'iCloud ist nicht erreichbar.');
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) break;
      // Auch Weiterleitungen müssen wieder auf iCloud zeigen.
      url = normalizeFeedUrl(new URL(location, url).href);
      continue;
    }
    if ([400, 403, 404, 410].includes(res.status)) throw new FeedError('Kalender nicht gefunden – ist er noch öffentlich freigegeben?');
    if (!res.ok) throw new FeedError(`iCloud meldet Fehler ${res.status}.`);
    const text = await readLimited(res);
    if (!text.includes('BEGIN:VCALENDAR')) throw new FeedError('Der Link liefert keinen Kalender.');
    return text;
  }
  throw new FeedError('Zu viele Weiterleitungen.');
}

async function getFeedText(feed, { fresh = false } = {}) {
  const key = urlHash(feed.url);
  const cached = feedCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < FEED_TTL) return cached.text;
  const text = await download(feed.url);
  feedCache.set(key, { at: Date.now(), text });
  return text;
}

/** Prüft einen neuen Link und liest Name/Farbe aus dem Kalender. */
export async function inspectFeed(rawUrl, index = 0) {
  const url = normalizeFeedUrl(rawUrl);
  const text = await getFeedText({ url }, { fresh: true });
  let root;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new FeedError('Der Kalender konnte nicht gelesen werden.');
  }
  const name = root.getFirstPropertyValue('x-wr-calname');
  const color = normalizeColor(root.getFirstPropertyValue('x-apple-calendar-color'));
  return {
    url,
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'Kalender',
    color: color || PALETTE[index % PALETTE.length],
  };
}

function normalizeColor(color) {
  if (typeof color !== 'string') return null;
  const m = color.match(/^#([0-9a-f]{6})/i);
  return m ? `#${m[1]}` : null;
}

export function resetCache() {
  feedCache.clear();
  eventCache.clear();
}

/**
 * Termine aller Kalender im Zeitraum. Fällt ein Kalender aus, kommen die
 * übrigen trotzdem; Fehler stehen in `errors`.
 */
export async function listEvents(feeds, from, to) {
  const cacheKey = `${feeds.map((f) => f.id).join(',')}|${from.toISOString()}|${to.toISOString()}`;
  const cached = eventCache.get(cacheKey);
  if (cached && Date.now() - cached.at < EVENTS_TTL) return cached.result;

  const errors = [];
  const perFeed = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const text = await getFeedText(feed);
        return expandObject(text, from, to, feed);
      } catch (err) {
        console.warn(`Kalender „${feed.name}“ konnte nicht geladen werden: ${err.message}`);
        errors.push({ calendar: feed.name, error: err instanceof FeedError ? err.message : 'Kalender konnte nicht gelesen werden.' });
        return [];
      }
    }),
  );

  const events = perFeed
    .flat()
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ sortKey, ...rest }) => rest);
  const result = { events, errors };
  if (!errors.length) eventCache.set(cacheKey, { at: Date.now(), result });
  return result;
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
  const exceptionsByUid = new Map();
  for (const ex of vevents.filter((v) => v.hasProperty('recurrence-id'))) {
    const uid = ex.getFirstPropertyValue('uid');
    if (!exceptionsByUid.has(uid)) exceptionsByUid.set(uid, []);
    exceptionsByUid.get(uid).push(ex);
  }
  const out = [];

  for (const master of masters) {
    const event = new ICAL.Event(master);
    for (const ex of exceptionsByUid.get(event.uid) || []) event.relateException(ex);
    exceptionsByUid.delete(event.uid);

    if (!event.isRecurring()) {
      pushInstance(out, event, event.startDate, event.endDate, from, to, cal);
      continue;
    }

    const rrule = master.getFirstPropertyValue('rrule');
    const repeat = rrule?.freq ? String(rrule.freq).toLowerCase() : 'yes';
    const durationMs = event.endDate ? event.endDate.toJSDate() - event.startDate.toJSDate() : 0;
    const fromMs = from.getTime();
    const it = event.iterator();
    let next;
    let count = 0;
    while ((next = it.next()) && count++ < MAX_OCCURRENCES) {
      const startMs = next.toJSDate().getTime();
      if (startMs > to.getTime()) break;
      // Alte Vorkommen schnell überspringen (Serien, die vor Jahren begonnen haben).
      if (startMs + durationMs < fromMs && !event.exceptions[next.toString()]) continue;
      const details = event.getOccurrenceDetails(next);
      pushInstance(out, details.item, details.startDate, details.endDate, from, to, cal, repeat);
    }
  }

  // Ausnahmen ohne zugehörigen Haupttermin (kommt selten vor) einzeln behandeln.
  for (const list of exceptionsByUid.values()) {
    for (const ex of list) {
      const event = new ICAL.Event(ex);
      pushInstance(out, event, event.startDate, event.endDate, from, to, cal);
    }
  }

  return out;
}

function pushInstance(out, item, start, end, from, to, cal, repeat = null) {
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
    // null = einmalig, sonst z. B. "weekly" / "yearly" – wichtig für die Vorschläge.
    repeat,
    sortKey: startJs.getTime(),
  });
}

function dateOnly(t) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
}
