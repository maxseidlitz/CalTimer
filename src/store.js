import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// Atomar schreiben, damit ein Absturz nie eine halbe Datei hinterlässt.
async function writeJson(name, value, mode = 0o644) {
  await mkdir(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode });
  await rename(tmp, file);
  await chmod(file, mode);
}

export const credentials = {
  get: () => readJson('credentials.json', null),
  set: (value) => writeJson('credentials.json', value, 0o600),
  clear: () => writeJson('credentials.json', null, 0o600),
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
