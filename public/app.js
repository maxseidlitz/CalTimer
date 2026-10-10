const $ = (sel) => document.querySelector(sel);
const DAY = 24 * 60 * 60 * 1000;
const LIST_DAYS = 60;

const state = {
  connected: false,
  appleId: null,
  widgets: [],
  listEvents: null,
  listUntil: null,
  month: startOfMonth(new Date()),
  monthEvents: new Map(), // "YYYY-MM" -> events
  selectedDay: null,
  pending: null, // Termin, der gerade bestätigt wird
  actionWidget: null,
};

// ---------- API ----------

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Fehler ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Datum & Zeit ----------

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthKey(d) { return dayKey(d).slice(0, 7); }

// Ganztägige Termine kommen als "YYYY-MM-DD" und starten um lokale Mitternacht.
function toDate(value, allDay) {
  if (allDay) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

// Liefert alle Kalendertage, die ein Termin berührt (Ende bei Ganztägigen exklusiv).
function eventDays(ev) {
  const start = startOfDay(toDate(ev.start, ev.allDay));
  let end = toDate(ev.end, ev.allDay);
  if (ev.allDay || end.getTime() === startOfDay(end).getTime()) end = new Date(end.getTime() - 1);
  if (end < start) end = start;
  const days = [];
  for (let d = start; d <= end && days.length < 62; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    days.push(dayKey(d));
  }
  return days;
}

const fmtDayHeading = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtLong = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtMonth = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

function dayHeading(d) {
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(d) - today) / DAY);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  return fmtDayHeading.format(d);
}

function describeWhen(w) {
  const d = toDate(w.start, w.allDay);
  return w.allDay ? `${fmtLong.format(d)} · ganztägig` : `${fmtLong.format(d)} · ${fmtTime.format(d)} Uhr`;
}

const pad = (n) => String(n).padStart(2, '0');

function countdownParts(target, now = Date.now()) {
  const ms = target - now;
  if (ms <= 0) return { past: true, ms };
  const total = Math.floor(ms / 1000);
  return {
    past: false,
    days: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

function since(ms) {
  const abs = Math.abs(ms);
  const mins = Math.floor(abs / 60000);
  if (mins < 1) return 'Jetzt!';
  if (mins < 60) return `seit ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `seit ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `seit ${days} ${days === 1 ? 'Tag' : 'Tagen'}`;
}

// ---------- Rendering: Widgets ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function widgetNode(w, { interactive = true } = {}) {
  const node = el('button', {
    class: 'widget',
    type: 'button',
    style: w.color ? `--c:${w.color}` : null,
    onclick: interactive ? () => openWidgetActions(w) : null,
  },
    w.calendar ? el('span', { class: 'w-cal' }, w.calendar) : null,
    el('div', { class: 'w-head' },
      el('span', { class: 'w-title' }, w.title),
      el('span', { class: 'w-date' }, describeWhen(w)),
    ),
    el('div', { class: 'w-count' }),
  );
  node._target = toDate(w.start, w.allDay).getTime();
  updateCountdown(node);
  return node;
}

function updateCountdown(node) {
  const c = countdownParts(node._target);
  const box = node.querySelector('.w-count');
  node.classList.toggle('past', c.past);
  let html;
  if (c.past) {
    html = `<span class="w-clock">${since(c.ms)}</span>`;
  } else if (c.days > 0) {
    html = `<span class="w-days"><b>${c.days}</b><span>${c.days === 1 ? 'Tag' : 'Tage'}</span></span>`
      + `<span class="w-clock">${pad(c.h)}:${pad(c.m)}:${pad(c.s)}</span>`;
  } else {
    html = `<span class="w-clock big">${pad(c.h)}:${pad(c.m)}:${pad(c.s)}</span>`;
  }
  if (box._last !== html) { box.innerHTML = html; box._last = html; }
}

function renderWidgets() {
  const grid = $('#widgets');
  const sorted = [...state.widgets].sort((a, b) => {
    const now = Date.now();
    const ta = toDate(a.start, a.allDay).getTime();
    const tb = toDate(b.start, b.allDay).getTime();
    // Kommende zuerst (nächster oben), vergangene ans Ende.
    const pa = ta <= now, pb = tb <= now;
    if (pa !== pb) return pa ? 1 : -1;
    return pa ? tb - ta : ta - tb;
  });
  grid.replaceChildren(...sorted.map((w) => widgetNode(w)));
  $('#empty').hidden = sorted.length > 0;
}

function tick() {
  for (const node of document.querySelectorAll('.widget')) updateCountdown(node);
}

// ---------- Sheets ----------

function openSheet(id) { $(id).hidden = false; }
function closeSheet(id) { $(id).hidden = true; }

document.addEventListener('click', (e) => {
  const closer = e.target.closest('[data-close]');
  if (closer) closer.closest('.sheet, .action-sheet').hidden = true;
  if (e.target.classList?.contains('action-sheet')) e.target.hidden = true;
});

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- Ablauf: Widget erstellen ----------

$('#add-btn').addEventListener('click', async () => {
  if (!state.connected) {
    $('#connect-error').hidden = true;
    openSheet('#connect-sheet');
    return;
  }
  openPicker();
});

$('#connect-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const err = $('#connect-error');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Verbinde …';
  try {
    const res = await api('/connect', {
      method: 'POST',
      body: { appleId: form.appleId.value, password: form.password.value },
    });
    state.connected = true;
    state.appleId = res.appleId;
    form.password.value = '';
    closeSheet('#connect-sheet');
    toast(`${res.calendars.length} Kalender verbunden`);
    openPicker();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Zugriff erlauben';
  }
});

function openPicker() {
  state.listEvents = null;
  state.monthEvents.clear();
  state.month = startOfMonth(new Date());
  state.selectedDay = dayKey(new Date());
  setMode('list');
  openSheet('#picker-sheet');
  loadList();
}

for (const tab of document.querySelectorAll('.segmented [data-mode]')) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
}

function setMode(mode) {
  for (const tab of document.querySelectorAll('.segmented [data-mode]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
  }
  $('#picker-list').hidden = mode !== 'list';
  $('#picker-month').hidden = mode !== 'month';
  if (mode === 'month') renderMonth();
}

function loadingNode(text = 'Lade Termine …') {
  return el('div', { class: 'loading' }, el('div', { class: 'spinner' }), text);
}

function handleCalendarError(err, container) {
  if (err.status === 401 || err.status === 409) {
    state.connected = false;
    closeSheet('#picker-sheet');
    $('#connect-error').textContent = err.status === 401
      ? 'Die Anmeldung bei iCloud ist fehlgeschlagen. Bitte neu verbinden.'
      : 'Bitte verbinde zuerst deinen Kalender.';
    $('#connect-error').hidden = false;
    openSheet('#connect-sheet');
    return;
  }
  container.replaceChildren(el('div', { class: 'loading' }, err.message));
}

async function loadList(extraDays = 0) {
  const box = $('#picker-list');
  const now = new Date();
  const from = state.listUntil && extraDays ? state.listUntil : now;
  const to = new Date((extraDays ? from : now).getTime() + (extraDays || LIST_DAYS) * DAY);
  if (!extraDays) box.replaceChildren(loadingNode());
  try {
    const events = await api(`/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    const seen = new Set((state.listEvents || []).map((e) => e.id));
    // Bereits laufende Termine (Start in der Vergangenheit) sind kein sinnvolles Countdown-Ziel.
    const upcoming = events.filter((ev) => toDate(ev.start, ev.allDay) > now && !seen.has(ev.id));
    state.listEvents = [...(state.listEvents || []), ...upcoming];
    state.listUntil = to;
    renderList();
  } catch (err) {
    handleCalendarError(err, box);
  }
}

function renderList() {
  const box = $('#picker-list');
  const groups = new Map();
  for (const ev of state.listEvents) {
    const key = dayKey(toDate(ev.start, ev.allDay));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  const nodes = [...groups.entries()].map(([key, evs]) =>
    el('div', { class: 'day-group' },
      el('h3', {}, dayHeading(toDate(key, true))),
      evs.map((ev) => eventNode(ev)),
    ),
  );
  if (!nodes.length) {
    nodes.push(el('div', { class: 'loading' }, `Keine Termine in den nächsten ${Math.round((state.listUntil - Date.now()) / DAY)} Tagen.`));
  }
  const more = el('button', { class: 'more', type: 'button' }, 'Weitere Termine laden');
  more.addEventListener('click', async () => {
    more.disabled = true;
    more.textContent = 'Lade …';
    await loadList(LIST_DAYS);
  });
  box.replaceChildren(...nodes, more);
}

function eventNode(ev) {
  const start = toDate(ev.start, ev.allDay);
  const isPast = start <= new Date();
  return el('button', {
    class: 'event',
    type: 'button',
    disabled: isPast,
    style: ev.color ? `--c:${ev.color}` : null,
    onclick: () => openConfirm(ev),
  },
    el('span', { class: 'bar' }),
    el('span', { class: 'time' },
      ev.allDay ? 'Ganzt.' : fmtTime.format(start),
      !ev.allDay ? el('small', {}, fmtTime.format(new Date(ev.end))) : null,
    ),
    el('span', { class: 'info' },
      el('div', { class: 'title' }, ev.title),
      el('div', { class: 'meta' }, [ev.calendar, ev.location].filter(Boolean).join(' · ')),
    ),
  );
}

// ---------- Monatsansicht ----------

$('#month-prev').addEventListener('click', () => shiftMonth(-1));
$('#month-next').addEventListener('click', () => shiftMonth(1));

function shiftMonth(delta) {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
  const today = new Date();
  state.selectedDay = monthKey(state.month) === monthKey(today) ? dayKey(today) : dayKey(state.month);
  renderMonth();
}

function monthGridRange(month) {
  // Woche beginnt am Montag.
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42);
  return { start, end };
}

async function renderMonth() {
  const month = state.month;
  const key = monthKey(month);
  $('#month-label').textContent = fmtMonth.format(month);
  const { start, end } = monthGridRange(month);

  if (!state.monthEvents.has(key)) {
    drawMonthGrid(start, new Map());
    $('#day-events').replaceChildren(loadingNode());
    try {
      const events = await api(`/events?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`);
      state.monthEvents.set(key, events);
    } catch (err) {
      handleCalendarError(err, $('#day-events'));
      return;
    }
    if (monthKey(state.month) !== key) return; // inzwischen weitergeblättert
  }

  const byDay = new Map();
  for (const ev of state.monthEvents.get(key)) {
    for (const d of eventDays(ev)) {
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(ev);
    }
  }
  drawMonthGrid(start, byDay);
  renderDayEvents(byDay.get(state.selectedDay) || []);
}

function drawMonthGrid(start, byDay) {
  const grid = $('#month-grid');
  const todayKey = dayKey(new Date());
  const cells = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => el('div', { class: 'dow' }, d));
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = dayKey(d);
    const evs = byDay.get(key) || [];
    const classes = ['day'];
    if (d.getMonth() !== state.month.getMonth()) classes.push('other');
    if (key === todayKey) classes.push('today');
    if (key === state.selectedDay) classes.push('selected');
    cells.push(el('button', {
      class: classes.join(' '),
      type: 'button',
      'aria-label': `${fmtDayHeading.format(d)}, ${evs.length} Termine`,
      onclick: () => {
        state.selectedDay = key;
        if (d.getMonth() !== state.month.getMonth()) state.month = startOfMonth(d);
        renderMonth();
      },
    },
      el('span', {}, d.getDate()),
      el('span', { class: 'dots' }, evs.slice(0, 3).map((ev) => el('i', { style: ev.color ? `--c:${ev.color}` : null }))),
    ));
  }
  grid.replaceChildren(...cells);
}

function renderDayEvents(evs) {
  const box = $('#day-events');
  const [y, m, d] = state.selectedDay.split('-').map(Number);
  const heading = el('h3', {}, dayHeading(new Date(y, m - 1, d)));
  box.replaceChildren(el('div', { class: 'day-group' },
    heading,
    evs.length ? evs.map((ev) => eventNode(ev)) : el('p', { class: 'muted small' }, 'Keine Termine an diesem Tag.'),
  ));
}

// ---------- Bestätigen ----------

function openConfirm(ev) {
  state.pending = ev;
  const form = $('#confirm-form');
  form.label.value = ev.title;
  $('#confirm-error').hidden = true;
  updatePreview();
  openSheet('#confirm-sheet');
}

function updatePreview() {
  const ev = state.pending;
  if (!ev) return;
  const title = $("#confirm-form").label.value.trim() || ev.title;
  const preview = $('#confirm-preview');
  preview.replaceChildren(widgetNode({ ...ev, title }, { interactive: false }));
}

$("#confirm-form").label.addEventListener('input', updatePreview);

$('#confirm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ev = state.pending;
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const widget = await api('/widgets', {
      method: 'POST',
      body: {
        title: form.label.value.trim(),
        start: ev.start,
        allDay: ev.allDay,
        location: ev.location,
        calendar: ev.calendar,
        color: ev.color,
        eventId: ev.id,
      },
    });
    state.widgets.push(widget);
    renderWidgets();
    closeSheet('#confirm-sheet');
    closeSheet('#picker-sheet');
    toast('Widget erstellt');
  } catch (err) {
    $('#confirm-error').textContent = err.message;
    $('#confirm-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// ---------- Widget-Aktionen ----------

function openWidgetActions(w) {
  state.actionWidget = w;
  $('#widget-actions-title').textContent = w.title;
  $('#widget-actions').hidden = false;
}

$('#widget-delete').addEventListener('click', async () => {
  const w = state.actionWidget;
  $('#widget-actions').hidden = true;
  if (!w) return;
  try {
    await api(`/widgets/${encodeURIComponent(w.id)}`, { method: 'DELETE' });
    state.widgets = state.widgets.filter((x) => x.id !== w.id);
    renderWidgets();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- Einstellungen ----------

$('#settings-btn').addEventListener('click', () => {
  const status = $('#settings-status');
  status.replaceChildren(
    state.connected
      ? el('div', {}, el('strong', {}, 'iCloud verbunden'), el('div', { class: 'muted small' }, state.appleId))
      : el('div', {}, el('strong', {}, 'Kein Kalender verbunden'), el('div', { class: 'muted small' }, 'Wird beim Erstellen des ersten Widgets eingerichtet.')),
  );
  $('#disconnect-btn').hidden = !state.connected;
  openSheet('#settings-sheet');
});

$('#disconnect-btn').addEventListener('click', async () => {
  if (!confirm('Kalender wirklich trennen? Deine Widgets bleiben erhalten.')) return;
  await api('/connect', { method: 'DELETE' });
  state.connected = false;
  state.appleId = null;
  closeSheet('#settings-sheet');
  toast('Kalender getrennt');
});

// ---------- Start ----------

async function init() {
  try {
    const [status, widgets] = await Promise.all([api('/status'), api('/widgets')]);
    state.connected = status.connected;
    state.appleId = status.appleId;
    state.widgets = widgets;
  } catch (err) {
    toast('Server nicht erreichbar');
  }
  renderWidgets();
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

init();
