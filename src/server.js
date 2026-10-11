import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import * as auth from './auth.js';
import { hostCheck, originCheck, securityHeaders } from './security.js';
import { suggest } from './suggest.js';

const DEMO = process.env.DEMO === '1';
const calendar = DEMO ? await import('./demo.js') : await import('./calendar.js');

const PORT = Number(process.env.PORT) || 3000;
const DAY = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 400;
const OVERVIEW_DAYS = 120;
const UPCOMING_COUNT = 5;
const MAX_FEEDS = 20;

const titleKey = (title) => title.trim().toLowerCase();

function startOf(ev) {
  if (!ev.allDay) return new Date(ev.start);
  const [y, m, d] = ev.start.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Für die App: nie den vollständigen (geheimen) Link herausgeben.
const publicFeed = ({ id, name, color, url }) => ({ id, name, color, hint: calendar.maskUrl(url) });

await store.removeLegacyCredentials();
await auth.init();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);
app.use(hostCheck);
app.use(securityHeaders);
app.use(express.json({ limit: '16kb' }));
const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
app.use(express.static(WEB_DIR, {
  index: 'index.html',
  // Gehashte Build-Dateien dürfen lange gecacht werden, alles andere wird neu geprüft.
  setHeaders: (res, file) => res.set('Cache-Control', file.includes(`${path.sep}assets${path.sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'),
}));

const api = express.Router();
api.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
api.use(originCheck);

// Öffentlich: Healthcheck und Anmeldung.
api.get('/health', (_req, res) => res.json({ ok: true }));
auth.routes(api);

// Alles Weitere nur mit gültiger Sitzung.
api.use(auth.requireAuth);

api.get('/status', async (_req, res) => {
  const feeds = await store.feeds.all();
  res.json({ connected: feeds.length > 0, calendars: feeds.map(publicFeed), demo: DEMO });
});

api.post('/calendars', async (req, res) => {
  const feeds = await store.feeds.all();
  if (feeds.length >= MAX_FEEDS) return res.status(400).json({ error: 'Maximal 20 Kalender.' });

  const info = await calendar.inspectFeed(String(req.body?.url ?? '').slice(0, 2048), feeds.length);
  if (feeds.some((f) => f.url === info.url)) {
    return res.status(409).json({ error: 'Dieser Kalender ist schon hinzugefügt.' });
  }
  const customName = String(req.body?.name ?? '').trim().slice(0, 60);
  const feed = { id: randomUUID(), ...info, name: customName || info.name, addedAt: new Date().toISOString() };
  feeds.push(feed);
  await store.feeds.save(feeds);
  calendar.resetCache();
  res.status(201).json(publicFeed(feed));
});

api.delete('/calendars/:id', async (req, res) => {
  const feeds = await store.feeds.all();
  const next = feeds.filter((f) => f.id !== req.params.id);
  if (next.length === feeds.length) return res.status(404).json({ error: 'Kalender nicht gefunden.' });
  await store.feeds.save(next);
  calendar.resetCache();
  res.status(204).end();
});

async function requireFeeds() {
  const feeds = await store.feeds.all();
  if (!feeds.length) {
    const err = new Error('Kein Kalender verbunden.');
    err.status = 409;
    throw err;
  }
  return feeds;
}

api.get('/events', async (req, res) => {
  const feeds = await requireFeeds();
  const from = req.query.from ? new Date(String(req.query.from)) : new Date();
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(from.getTime() + 60 * DAY);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    return res.status(400).json({ error: 'Ungültiger Zeitraum.' });
  }
  if (to - from > MAX_RANGE_DAYS * DAY) {
    return res.status(400).json({ error: 'Zeitraum zu groß.' });
  }
  res.json(await calendar.listEvents(feeds, from, to));
});

// Startseite: nächste Termine + Widget-Vorschläge in einem Abruf.
api.get('/overview', async (_req, res) => {
  const feeds = await store.feeds.all();
  if (!feeds.length) return res.json({ connected: false, upcoming: [], suggestions: [], errors: [] });

  const now = new Date();
  // Auf die volle Stunde abrunden, damit der Event-Cache greift.
  const from = new Date(now);
  from.setMinutes(0, 0, 0);
  const to = new Date(from.getTime() + OVERVIEW_DAYS * DAY);
  const { events, errors } = await calendar.listEvents(feeds, from, to);

  const [widgetList, dismissedList] = await Promise.all([store.widgets.all(), store.dismissed.all()]);
  const added = new Set(widgetList.map((w) => w.eventId).filter(Boolean));
  // Titel mit kommendem Widget oder ausgeblendete Titel nicht (nochmal) vorschlagen.
  const hiddenTitles = new Set([
    ...widgetList.filter((w) => startOf(w) > now).map((w) => titleKey(w.title)),
    ...dismissedList,
  ]);
  const future = events.filter((ev) => startOf(ev) > now);

  res.json({
    connected: true,
    errors,
    upcoming: future.slice(0, UPCOMING_COUNT).map((ev) => ({ ...ev, added: added.has(ev.id) })),
    suggestions: suggest(
      future.filter((ev) => !hiddenTitles.has(titleKey(ev.title))),
      { exclude: added, now },
    ),
  });
});

api.post('/suggestions/dismiss', async (req, res) => {
  const key = titleKey(String(req.body?.title ?? '').slice(0, 200));
  if (!key) return res.status(400).json({ error: 'Titel fehlt.' });
  const list = await store.dismissed.all();
  if (!list.includes(key)) list.push(key);
  await store.dismissed.save(list);
  res.status(204).end();
});

api.get('/widgets', async (_req, res) => {
  res.json(await store.widgets.all());
});

api.post('/widgets', async (req, res) => {
  const b = req.body ?? {};
  const title = String(b.title ?? '').trim().slice(0, 120);
  const allDay = Boolean(b.allDay);
  const start = String(b.start ?? '');
  const validStart = allDay ? /^\d{4}-\d{2}-\d{2}$/.test(start) : !Number.isNaN(Date.parse(start));
  if (!title || !validStart) {
    return res.status(400).json({ error: 'Titel und Startzeit werden benötigt.' });
  }
  const list = await store.widgets.all();
  if (list.length >= 200) return res.status(400).json({ error: 'Maximal 200 Widgets.' });
  const widget = {
    id: randomUUID(),
    title,
    start,
    allDay,
    location: b.location ? String(b.location).slice(0, 200) : null,
    calendar: b.calendar ? String(b.calendar).slice(0, 80) : null,
    color: /^#[0-9a-f]{6}$/i.test(b.color ?? '') ? b.color : null,
    eventId: b.eventId ? String(b.eventId).slice(0, 500) : null,
    createdAt: new Date().toISOString(),
  };
  list.push(widget);
  await store.widgets.save(list);
  res.status(201).json(widget);
});

api.delete('/widgets/:id', async (req, res) => {
  const list = await store.widgets.all();
  const next = list.filter((w) => w.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: 'Widget nicht gefunden.' });
  await store.widgets.save(next);
  res.status(204).end();
});

api.use((_req, res) => res.status(404).json({ error: 'Nicht gefunden.' }));

app.use('/api', api);

app.use((err, _req, res, _next) => {
  if (err instanceof calendar.FeedError) {
    return res.status(400).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Ungültige Anfrage.' });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Interner Fehler.' : err.message });
});

app.listen(PORT, () => {
  console.log(`CalTimer läuft auf Port ${PORT}${DEMO ? ' (Demo-Modus)' : ''}`);
});
