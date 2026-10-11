import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import * as store from './store.js';

const scryptAsync = promisify(scrypt);

const COOKIE = 'caltimer_session';
const SESSION_DAYS = 90;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const MIN_PASSPHRASE = 10;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };

// Einmaliger Einrichtungscode – nur im Container-Log sichtbar, nur im Speicher.
let setupCode = null;

export async function init() {
  if (await store.auth.get()) return;
  // Ohne Verwechslungsgefahr (kein 0/O, 1/I/l), 10 Zeichen ≈ 50 Bit.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  setupCode = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  console.log('');
  console.log('==================================================');
  console.log('  CalTimer ist noch nicht eingerichtet.');
  console.log(`  Einrichtungscode: ${setupCode.slice(0, 5)}-${setupCode.slice(5)}`);
  console.log('  Öffne die App und gib diesen Code ein.');
  console.log('==================================================');
  console.log('');
}

async function hashPassphrase(passphrase, saltB64) {
  const salt = saltB64 ? Buffer.from(saltB64, 'base64') : randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scryptAsync(passphrase.normalize('NFC'), salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 });
  return { salt: salt.toString('base64'), hash: hash.toString('base64'), N, r, p, keylen };
}

async function verifyPassphrase(passphrase, record) {
  const { N, r, p, keylen } = record;
  const hash = await scryptAsync(passphrase.normalize('NFC'), Buffer.from(record.salt, 'base64'), keylen, {
    N, r, p, maxmem: 128 * N * r * 2,
  });
  const expected = Buffer.from(record.hash, 'base64');
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}

// ---------- Fehlversuche begrenzen ----------

const attempts = new Map(); // ip -> { fails, until }
let globalFails = [];

function lockedFor(ip) {
  const a = attempts.get(ip);
  const now = Date.now();
  globalFails = globalFails.filter((t) => now - t < 60_000);
  if (globalFails.length >= 30) return 60; // Schutz gegen verteilte Versuche
  if (a && a.until > now) return Math.ceil((a.until - now) / 1000);
  return 0;
}

function recordFail(ip) {
  const a = attempts.get(ip) || { fails: 0, until: 0 };
  a.fails += 1;
  // Ab dem 5. Fehlversuch: 1, 2, 4, 8 … Minuten Sperre (max. 60).
  if (a.fails >= 5) a.until = Date.now() + Math.min(2 ** (a.fails - 5), 60) * 60_000;
  attempts.set(ip, a);
  globalFails.push(Date.now());
}

function tooMany(res, seconds) {
  res.set('Retry-After', String(seconds));
  res.status(429).json({ error: `Zu viele Fehlversuche. Bitte in ${Math.ceil(seconds / 60)} Min. erneut versuchen.` });
}

// ---------- Sessions ----------

const tokenHash = (token) => createHash('sha256').update(token).digest('base64');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function createSession(req, res) {
  const token = randomBytes(32).toString('base64url');
  const sessions = (await store.sessions.all()).filter((s) => s.expires > Date.now());
  sessions.push({ hash: tokenHash(token), expires: Date.now() + SESSION_MS, createdAt: new Date().toISOString() });
  await store.sessions.save(sessions);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    // Lax statt Strict: iOS wertet den Start der Home-Bildschirm-App (bzw. „Fortsetzen“
    // nach der HTTP-Warnung) teils als fremde Navigation und schickt Strict-Cookies dann
    // nicht mit. CSRF bleibt abgewehrt: Änderungen nur per POST/DELETE + Origin-Prüfung.
    sameSite: 'lax',
    // Über HTTPS (direkt oder via Tailscale-Proxy) nur verschlüsselt senden.
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    path: '/',
    maxAge: SESSION_MS,
  });
}

async function findSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const hash = tokenHash(token);
  const sessions = await store.sessions.all();
  return sessions.find((s) => s.hash === hash && s.expires > Date.now()) || null;
}

export async function requireAuth(req, res, next) {
  if (await findSession(req)) return next();
  res.status(401).json({ error: 'Bitte anmelden.', code: 'auth' });
}

// ---------- Routen ----------

export function routes(router) {
  router.get('/auth/status', async (req, res) => {
    const configured = Boolean(await store.auth.get());
    res.json({ setupRequired: !configured, authenticated: configured && Boolean(await findSession(req)) });
  });

  router.post('/auth/setup', async (req, res) => {
    if (await store.auth.get()) return res.status(409).json({ error: 'Bereits eingerichtet.' });
    const wait = lockedFor(req.ip);
    if (wait) return tooMany(res, wait);

    const code = String(req.body?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const passphrase = String(req.body?.passphrase ?? '');
    const ok = setupCode && code.length === setupCode.length
      && timingSafeEqual(Buffer.from(code), Buffer.from(setupCode));
    if (!ok) {
      recordFail(req.ip);
      return res.status(403).json({ error: 'Einrichtungscode ist falsch. Er steht im Container-Log.' });
    }
    if (passphrase.length < MIN_PASSPHRASE) {
      return res.status(400).json({ error: `Die Passphrase muss mindestens ${MIN_PASSPHRASE} Zeichen lang sein.` });
    }
    await store.auth.set(await hashPassphrase(passphrase));
    setupCode = null;
    attempts.delete(req.ip);
    await createSession(req, res);
    res.json({ ok: true });
  });

  router.post('/auth/login', async (req, res) => {
    const record = await store.auth.get();
    if (!record) return res.status(409).json({ error: 'Noch nicht eingerichtet.' });
    const wait = lockedFor(req.ip);
    if (wait) return tooMany(res, wait);

    const passphrase = String(req.body?.passphrase ?? '').slice(0, 1024);
    if (!(await verifyPassphrase(passphrase, record))) {
      recordFail(req.ip);
      return res.status(403).json({ error: 'Passphrase ist falsch.' });
    }
    attempts.delete(req.ip);
    await createSession(req, res);
    res.json({ ok: true });
  });

  router.post('/auth/logout', async (req, res) => {
    const session = await findSession(req);
    if (session) {
      const sessions = await store.sessions.all();
      await store.sessions.save(sessions.filter((s) => s.hash !== session.hash));
    }
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // Meldet alle Geräte ab, z. B. wenn ein Handy verloren ging.
  router.post('/auth/logout-all', requireAuth, async (_req, res) => {
    await store.sessions.save([]);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });
}
