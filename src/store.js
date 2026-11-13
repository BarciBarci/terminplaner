/**
 * Speicher-Abstraktion.
 *
 * Zwei Implementierungen mit identischer API:
 *   - lokal     : localStorage (Demo, kein Setup nötig)
 *   - supabase  : Postgres via RPC (siehe supabase/schema.sql)
 *
 * Die App ruft ausschließlich die unten exportierten Funktionen auf und weiß
 * nicht, welches Backend dahinter steckt.
 */

import { config } from './config.js';
import { isValidISODate, isValidTime, normTime, toMin } from './util.js';

// Testsuite kann das Backend erzwingen, damit sie nie versehentlich gegen
// eine echte Datenbank schreibt (globalThis.__TERMINPLANER_BACKEND__).
const forcedBackend =
  typeof globalThis !== 'undefined' ? globalThis.__TERMINPLANER_BACKEND__ : undefined;

const REMOTE = forcedBackend
  ? forcedBackend === 'supabase'
  : Boolean(config.supabase?.url && config.supabase?.anonKey);

export const backendName = REMOTE ? 'supabase' : 'local';

export class AppError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.code = code;
  }
}

/** Aufbewahrung: Events verschwinden 180 Tage nach dem Anlegen automatisch. */
export const RETENTION_DAYS = 180;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

function expiryOfEvent(event) {
  if (event.expires_at) {
    const parsed = Date.parse(event.expires_at);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (event.created_at) {
    const parsed = Date.parse(event.created_at);
    if (!Number.isNaN(parsed)) return parsed + RETENTION_MS;
  }
  return null;
}

function assertAlive(event) {
  const expiry = expiryOfEvent(event);
  if (expiry !== null && expiry <= Date.now()) throw new AppError('expired');
}

/** Entfernt abgelaufene Events samt Einträgen (lokales Aufräumen). */
function pruneExpired(db) {
  const now = Date.now();
  const expired = db.events.filter((event) => {
    const expiry = expiryOfEvent(event);
    return expiry !== null && expiry <= now;
  });
  if (!expired.length) return;

  const eventIds = new Set(expired.map((event) => event.id));
  const dayIds = new Set(
    db.days.filter((day) => eventIds.has(day.event_id)).map((day) => day.id)
  );
  const participantIds = new Set(
    db.participants.filter((person) => eventIds.has(person.event_id)).map((person) => person.id)
  );

  db.events = db.events.filter((event) => !eventIds.has(event.id));
  db.days = db.days.filter((day) => !eventIds.has(day.event_id));
  db.participants = db.participants.filter((person) => !eventIds.has(person.event_id));
  db.availability = db.availability.filter(
    (entry) => !participantIds.has(entry.participant_id) && !dayIds.has(entry.day_id)
  );
}

/* ------------------------------------------------------------------ */
/* Validierung (beide Backends, damit Fehler überall gleich aussehen)  */
/* ------------------------------------------------------------------ */

function validateName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new AppError('invalid_name');
  return trimmed.slice(0, 120);
}

function validateDays(days) {
  if (!Array.isArray(days) || days.length === 0) throw new AppError('invalid_days');

  return days.map((day, index) => {
    const date = String(day.date ?? '');
    const start = normTime(day.start);
    const end = normTime(day.end);

    if (
      !isValidISODate(date) ||
      !isValidTime(start) ||
      !isValidTime(end) ||
      toMin(start) >= toMin(end)
    ) {
      throw new AppError('invalid_days');
    }

    return {
      id: typeof day.id === 'string' && day.id ? day.id : null,
      date,
      start,
      end,
      position: index
    };
  });
}

/* ------------------------------------------------------------------ */
/* Lokales Backend                                                     */
/* ------------------------------------------------------------------ */

const LS_KEY = 'terminplaner.v1';

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const newToken = () => {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const emptyDb = () => ({ events: [], days: [], participants: [], availability: [] });

function readDb() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw);
    return {
      events: parsed.events || [],
      days: parsed.days || [],
      participants: parsed.participants || [],
      availability: parsed.availability || []
    };
  } catch {
    return emptyDb();
  }
}

function writeDb(db) {
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

function eventById(db, eventId) {
  const event = db.events.find((entry) => entry.id === eventId);
  if (!event) throw new AppError('invalid_token');
  assertAlive(event);
  return event;
}

function daysOfEvent(db, eventId) {
  return db.days
    .filter((day) => day.event_id === eventId)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.position ?? 0) - (b.position ?? 0))
    .map((day) => ({ id: day.id, date: day.date, start: normTime(day.start), end: normTime(day.end) }));
}

function availabilityOfEvent(db, eventId) {
  const ids = new Set(db.participants.filter((p) => p.event_id === eventId).map((p) => p.id));
  return db.availability
    .filter((entry) => ids.has(entry.participant_id))
    .map((entry) => ({
      participant_id: entry.participant_id,
      day_id: entry.day_id,
      start: normTime(entry.start),
      end: normTime(entry.end)
    }));
}

function snapshot(db, event, withTokens) {
  const participants = db.participants
    .filter((p) => p.event_id === event.id)
    .map((p) => (withTokens ? { id: p.id, name: p.name, token: p.token } : { id: p.id, name: p.name }));

  return {
    event: {
      id: event.id,
      name: event.name,
      created_at: event.created_at ?? null,
      expires_at: event.expires_at ?? null
    },
    days: daysOfEvent(db, event.id),
    participants,
    availability: availabilityOfEvent(db, event.id)
  };
}

/** Schreibt die Tag-Liste eines Events neu und räumt entfernte Tage auf. */
function writeDays(db, eventId, days) {
  const keep = [];

  for (const day of days) {
    const existing =
      day.id && db.days.find((entry) => entry.id === day.id && entry.event_id === eventId);

    if (existing) {
      existing.date = day.date;
      existing.start = day.start;
      existing.end = day.end;
      existing.position = day.position;
      keep.push(existing.id);
    } else {
      const created = {
        id: newId(),
        event_id: eventId,
        date: day.date,
        start: day.start,
        end: day.end,
        position: day.position
      };
      db.days.push(created);
      keep.push(created.id);
    }
  }

  const removed = db.days.filter((entry) => entry.event_id === eventId && !keep.includes(entry.id));
  const removedIds = new Set(removed.map((entry) => entry.id));

  db.days = db.days.filter((entry) => !removedIds.has(entry.id));
  db.availability = db.availability.filter((entry) => !removedIds.has(entry.day_id));
}

const local = {
  async createEvent({ name, days }) {
    const cleanName = validateName(name);
    const cleanDays = validateDays(days);

    const db = readDb();
    pruneExpired(db);

    const now = new Date();
    const event = {
      id: newId(),
      name: cleanName,
      admin_token: newToken(),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + RETENTION_MS).toISOString()
    };
    db.events.push(event);
    writeDays(db, event.id, cleanDays);
    writeDb(db);

    return {
      event_id: event.id,
      admin_token: event.admin_token,
      expires_at: event.expires_at
    };
  },

  async adminLoad(adminToken) {
    const db = readDb();
    const event = db.events.find((entry) => entry.admin_token === adminToken);
    if (!event) throw new AppError('invalid_token');
    assertAlive(event);
    return snapshot(db, event, true);
  },

  async adminUpdateEvent(adminToken, { name, days }) {
    const cleanName = validateName(name);
    const cleanDays = validateDays(days);

    const db = readDb();
    const event = db.events.find((entry) => entry.admin_token === adminToken);
    if (!event) throw new AppError('invalid_token');
    assertAlive(event);

    event.name = cleanName;
    writeDays(db, event.id, cleanDays);
    writeDb(db);

    return snapshot(db, event, true);
  },

  async adminAddParticipant(adminToken, name) {
    const cleanName = validateName(name);

    const db = readDb();
    const event = db.events.find((entry) => entry.admin_token === adminToken);
    if (!event) throw new AppError('invalid_token');
    assertAlive(event);

    const clash = db.participants.some(
      (p) => p.event_id === event.id && p.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (clash) throw new AppError('duplicate_name');

    db.participants.push({
      id: newId(),
      event_id: event.id,
      name: cleanName,
      token: newToken(),
      created_at: new Date().toISOString()
    });
    writeDb(db);

    return snapshot(db, event, true);
  },

  async adminRemoveParticipant(adminToken, participantId) {
    const db = readDb();
    const event = db.events.find((entry) => entry.admin_token === adminToken);
    if (!event) throw new AppError('invalid_token');
    assertAlive(event);

    const gone = db.participants.find((p) => p.id === participantId && p.event_id === event.id);
    if (gone) {
      db.participants = db.participants.filter((p) => p.id !== gone.id);
      db.availability = db.availability.filter((entry) => entry.participant_id !== gone.id);
      writeDb(db);
    }

    return snapshot(db, event, true);
  },

  async adminDeleteEvent(adminToken) {
    const db = readDb();
    const event = db.events.find((entry) => entry.admin_token === adminToken);
    if (!event) throw new AppError('invalid_token');

    const dayIds = new Set(db.days.filter((day) => day.event_id === event.id).map((day) => day.id));
    const participantIds = new Set(
      db.participants.filter((person) => person.event_id === event.id).map((person) => person.id)
    );

    db.events = db.events.filter((entry) => entry.id !== event.id);
    db.days = db.days.filter((day) => day.event_id !== event.id);
    db.participants = db.participants.filter((person) => person.event_id !== event.id);
    db.availability = db.availability.filter(
      (entry) => !participantIds.has(entry.participant_id) && !dayIds.has(entry.day_id)
    );
    writeDb(db);

    return { deleted: true };
  },

  async participantLoad(participantToken) {
    const db = readDb();
    const me = db.participants.find((entry) => entry.token === participantToken);
    if (!me) throw new AppError('invalid_token');

    const event = eventById(db, me.event_id);
    return { ...snapshot(db, event, false), me: { id: me.id, name: me.name } };
  },

  async setAvailability(participantToken, dayId, ranges) {
    const db = readDb();
    const me = db.participants.find((entry) => entry.token === participantToken);
    if (!me) throw new AppError('invalid_token');

    const event = eventById(db, me.event_id);
    const day = db.days.find((entry) => entry.id === dayId && entry.event_id === me.event_id);
    if (!day) throw new AppError('invalid_token');

    if (!Array.isArray(ranges)) throw new AppError('invalid_range');

    const clean = ranges.map((range) => {
      const start = normTime(range.start);
      const end = normTime(range.end);
      if (
        !isValidTime(start) ||
        !isValidTime(end) ||
        toMin(start) >= toMin(end) ||
        toMin(start) < toMin(day.start) ||
        toMin(end) > toMin(day.end)
      ) {
        throw new AppError('invalid_range');
      }
      return { start, end };
    });

    db.availability = db.availability.filter(
      (entry) => !(entry.participant_id === me.id && entry.day_id === dayId)
    );
    for (const range of clean) {
      db.availability.push({
        id: newId(),
        participant_id: me.id,
        day_id: dayId,
        start: range.start,
        end: range.end
      });
    }
    writeDb(db);

    return { ...snapshot(db, event, false), me: { id: me.id, name: me.name } };
  }
};

/* ------------------------------------------------------------------ */
/* Supabase-Backend (PostgREST RPC, ohne SDK)                          */
/* ------------------------------------------------------------------ */

const KNOWN_CODES = [
  'invalid_token',
  'invalid_name',
  'invalid_days',
  'invalid_range',
  'duplicate_name',
  'expired'
];

const PLACEHOLDER = /DEIN-PROJEKT|EXAMPLE|your-project|XXXX/i;

/** Prüft und normalisiert die Supabase-Angaben aus src/config.js. */
function endpoint() {
  const url = String(config.supabase?.url ?? '').trim();
  const key = String(config.supabase?.anonKey ?? '').trim();

  if (!url || !key || PLACEHOLDER.test(url) || PLACEHOLDER.test(key)) {
    throw new AppError('config_invalid');
  }
  if (!/^https:\/\/[^\s/]+/i.test(url)) {
    throw new AppError('config_invalid');
  }

  // "…/rest/v1" oder ein abschließender Slash sind häufige Kopierfehler.
  return { base: url.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), key };
}

async function rpc(fn, args) {
  const { base, key } = endpoint();

  const headers = {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`
  };

  let response;
  try {
    response = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args)
    });
  } catch (error) {
    throw new AppError('network_error', error.message);
  }

  const text = await response.text();
  if (response.ok) return text ? JSON.parse(text) : null;

  let raw = text;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
    raw = parsed.message || parsed.hint || parsed.details || text;
  } catch {
    /* Text war kein JSON */
  }

  const known = KNOWN_CODES.find((candidate) => String(raw).includes(candidate));
  if (known) throw new AppError(known, raw);

  // Schema noch nicht eingespielt oder Ausführungsrechte fehlen.
  if (
    parsed?.code === 'PGRST202' ||
    parsed?.code === '42501' ||
    response.status === 404 ||
    /could not find the function|permission denied|does not exist/i.test(String(raw))
  ) {
    throw new AppError('schema_missing', raw);
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError('config_invalid', raw);
  }

  throw new AppError('unknown', raw);
}

const remote = {
  createEvent: ({ name, days }) => rpc('app_create_event', { p_name: name, p_days: days }),
  adminLoad: (adminToken) => rpc('app_admin_load', { p_token: adminToken }),
  adminUpdateEvent: (adminToken, { name, days }) =>
    rpc('app_admin_update_event', { p_token: adminToken, p_name: name, p_days: days }),
  adminAddParticipant: (adminToken, name) =>
    rpc('app_admin_add_participant', { p_token: adminToken, p_name: name }),
  adminRemoveParticipant: (adminToken, participantId) =>
    rpc('app_admin_remove_participant', { p_token: adminToken, p_participant_id: participantId }),
  adminDeleteEvent: (adminToken) => rpc('app_admin_delete_event', { p_token: adminToken }),
  participantLoad: (participantToken) => rpc('app_participant_load', { p_token: participantToken }),
  setAvailability: (participantToken, dayId, ranges) =>
    rpc('app_set_availability', { p_token: participantToken, p_day_id: dayId, p_ranges: ranges })
};

const impl = REMOTE ? remote : local;

/* ------------------------------------------------------------------ */
/* Öffentliche API                                                     */
/* ------------------------------------------------------------------ */

export const createEvent = (payload) => impl.createEvent(payload);
export const adminLoad = (token) => impl.adminLoad(token);
export const adminUpdateEvent = (token, payload) => impl.adminUpdateEvent(token, payload);
export const adminAddParticipant = (token, name) => impl.adminAddParticipant(token, name);
export const adminRemoveParticipant = (token, id) => impl.adminRemoveParticipant(token, id);
export const adminDeleteEvent = (token) => impl.adminDeleteEvent(token);
export const participantLoad = (token) => impl.participantLoad(token);
export const setAvailability = (token, dayId, ranges) => impl.setAvailability(token, dayId, ranges);
