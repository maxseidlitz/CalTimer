import { mkdir, readFile, writeFile, rename, chmod, rm } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const SECRET = 0o600;

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// Atomar schreiben, damit ein Absturz nie eine halbe Datei hinterlässt.
async function writeJson(name, value, mode = SECRET) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode });
  await rename(tmp, file);
  await chmod(file, mode);
}

// Frühere Versionen speicherten ein iCloud-Passwort – das wird nicht mehr gebraucht.
export async function removeLegacyCredentials() {
  try {
    await rm(path.join(DATA_DIR, 'credentials.json'));
    console.warn('Alte iCloud-Zugangsdaten (credentials.json) wurden gelöscht. Bitte das app-spezifische Passwort bei Apple widerrufen.');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Kalender-Links sind geheim: Wer sie kennt, kann den Kalender lesen.
export const feeds = {
  all: () => readJson('feeds.json', []),
  save: (list) => writeJson('feeds.json', list),
};

export const auth = {
  get: () => readJson('auth.json', null),
  set: (value) => writeJson('auth.json', value),
};

export const sessions = {
  all: () => readJson('sessions.json', []),
  save: (list) => writeJson('sessions.json', list),
};

export const widgets = {
  all: () => readJson('widgets.json', []),
  save: (list) => writeJson('widgets.json', list),
};

// Ausgeblendete Vorschläge (normalisierte Termin-Titel).
export const dismissed = {
  all: () => readJson('dismissed.json', []),
  save: (list) => writeJson('dismissed.json', list.slice(-500)),
};
