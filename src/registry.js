/**
 * Lokale Merkliste der Events, die in diesem Browser angelegt oder geöffnet
 * wurden. Das ist reiner Komfort – der eigentliche Zugang bleibt der Admin-Link.
 * Wer den Browser wechselt, sieht diese Liste nicht.
 */

const KEY = 'terminplaner.events.v1';

/** Aufbewahrung: Events verschwinden 180 Tage nach dem Anlegen. */
export const RETENTION_DAYS = 180;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* Speicher voll oder gesperrt – Liste ist nur Komfort. */
  }
}

/** Ablaufzeitpunkt in ms, oder null wenn unbekannt. */
export function expiryOf(entry) {
  const explicit = Date.parse(entry?.expiresAt ?? '');
  if (!Number.isNaN(explicit)) return explicit;

  const saved = Date.parse(entry?.savedAt ?? '');
  if (!Number.isNaN(saved)) return saved + RETENTION_MS;

  return null;
}

export function remember({ id, name, adminToken, expiresAt }) {
  if (!adminToken) return;

  const entry = {
    id: id ?? null,
    name: name ?? '',
    adminToken,
    expiresAt: expiresAt ?? null,
    savedAt: new Date().toISOString()
  };

  write([entry, ...read().filter((item) => item.adminToken !== adminToken)]);
}

export function list() {
  const now = Date.now();
  const entries = read().filter((entry) => {
    const expiry = expiryOf(entry);
    return expiry === null || expiry > now;
  });

  write(entries);
  return entries;
}

export function forget(adminToken) {
  write(read().filter((entry) => entry.adminToken !== adminToken));
}
