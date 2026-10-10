import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import { suggest } from './suggest.js';

const DEMO = process.env.DEMO === '1';
const calendar = DEMO ? await import('./demo.js') : await import('./calendar.js');

const PORT = Number(process.env.PORT) || 3000;
const DAY = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 400;
const OVERVIEW_DAYS = 120;
const UPCOMING_COUNT = 5;

const titleKey = (title) => title.trim().toLowerCase();

function startOf(ev) {
  if (!ev.allDay) return new Date(ev.start);
  const [y, m, d] = ev.start.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')));

const api = express.Router();

async function requireCreds() {
  const creds = await store.credentials.get();
  if (!creds) {
    const err = new Error('Kein Kalender verbunden.');
    err.status = 409;
    throw err;
  }
  return creds;
}

api.get('/status', async (_req, res) => {
  const creds = await store.credentials.get();
  res.json({ connected: Boolean(creds), appleId: creds?.appleId ?? null });
});

api.post('/connect', async (req, res) => {
  const appleId = String(req.body?.appleId ?? '').trim();
  // App-spezifische Passwörter werden oft mit Bindestrichen/Leerzeichen kopiert.
  const password = String(req.body?.password ?? '').replace(/\s+/g, '');
  if (!appleId || !password) {
    return res.status(400).json({ error: 'Apple-ID und Passwort angeben.' });
  }
  const creds = { appleId, password };
  const calendars = await calendar.verify(creds);
  await store.credentials.set(creds);
  res.json({ connected: true, appleId, calendars });
});

api.delete('/connect', async (_req, res) => {
  await store.credentials.clear();
  calendar.resetSession();
  res.json({ connected: false });
});

api.get('/calendars', async (_req, res) => {
  res.json(await calendar.listCalendars(await requireCreds()));
});

api.get('/events', async (req, res) => {
  const creds = await requireCreds();
  const from = req.query.from ? new Date(req.query.from) : new Date();
  const to = req.query.to ? new Date(req.query.to) : new Date(from.getTime() + 60 * DAY);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    return res.status(400).json({ error: 'Ungültiger Zeitraum.' });
  }
  if (to - from > MAX_RANGE_DAYS * DAY) {
    return res.status(400).json({ error: 'Zeitraum zu groß.' });
  }
  res.json(await calendar.listEvents(creds, from, to));
});

// Startseite: nächste Termine + Widget-Vorschläge in einem Abruf.
api.get('/overview', async (_req, res) => {
  const creds = await store.credentials.get();
  if (!creds) return res.json({ connected: false, upcoming: [], suggestions: [] });

  const now = new Date();
  // Auf die volle Stunde abrunden, damit der Event-Cache greift.
  const from = new Date(now);
  from.setMinutes(0, 0, 0);
  const to = new Date(from.getTime() + OVERVIEW_DAYS * DAY);
  const events = await calendar.listEvents(creds, from, to);

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
  const list = await store.widgets.all();
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

app.use('/api', api);

app.use((err, _req, res, _next) => {
  if (err instanceof calendar.AuthError) {
    return res.status(401).json({ error: err.message });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Fehler beim Abrufen des Kalenders.' : err.message });
});

app.listen(PORT, () => {
  console.log(`CalTimer läuft auf http://0.0.0.0:${PORT}${DEMO ? ' (Demo-Modus)' : ''}`);
});
