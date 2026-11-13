/** Zeit- und Datums-Helfer. Alle Zeiten intern als "HH:MM". */

const pad2 = (n) => String(n).padStart(2, '0');

export { pad2 };

/** "HH:MM:SS" -> "HH:MM" (Postgres liefert time als HH:MM:SS). */
export function normTime(value) {
  return String(value ?? '').slice(0, 5);
}

/** "HH:MM" -> Minuten seit Mitternacht. */
export function toMin(value) {
  const [hours, minutes] = normTime(value).split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

/** Minuten -> "HH:MM". */
export function fromMin(total) {
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** Lokales Datum als "YYYY-MM-DD". */
export function isoDate(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayISO(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return isoDate(date);
}

/** "2026-05-12" -> "Dienstag, 12.05.2026" */
export function formatDay(isoDay) {
  const date = new Date(`${isoDay}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDay;
  return date.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

/** ISO-Zeitstempel -> "12.05.2026" */
export function formatDate(value) {
  const date = new Date(value ?? '');
  if (Number.isNaN(date.getTime())) return String(value ?? '');
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

export function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

export function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normTime(value));
}

/**
 * Sortiert Zeiträume und fasst überlappende / direkt aneinanderliegende
 * Bereiche zusammen. Ergebnis ist immer disjunkt und aufsteigend.
 */
export function mergeRanges(ranges) {
  const spans = ranges
    .map((range) => [toMin(range.start), toMin(range.end)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [start, end] of spans) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  return merged.map(([start, end]) => ({ start: fromMin(start), end: fromMin(end) }));
}

export const secondsOfDay = (value) => toMin(value) * 60;

/**
 * Schaltet eine ganze Stunde in einer Zeitraumliste um: ist sie vollständig
 * abgedeckt, wird sie herausgeschnitten, sonst ergänzt. Ergebnis ist immer
 * zusammengefasst und sortiert.
 */
export function toggleHourRange(ranges, from, to) {
  const startMin = toMin(from);
  const endMin = toMin(to);
  const covered = ranges.some(
    (range) => toMin(range.start) <= startMin && toMin(range.end) >= endMin
  );

  if (!covered) return mergeRanges([...ranges, { start: from, end: to }]);

  const next = [];
  for (const range of ranges) {
    const rangeStart = toMin(range.start);
    const rangeEnd = toMin(range.end);

    if (rangeEnd <= startMin || rangeStart >= endMin) {
      next.push(range);
      continue;
    }
    if (rangeStart < startMin) next.push({ start: range.start, end: from });
    if (rangeEnd > endMin) next.push({ start: to, end: range.end });
  }

  return mergeRanges(next);
}

/**
 * Zerlegt das Zeitfenster eines Tages an allen Grenzen der eingetragenen
 * Zeiträume und zählt für jeden Abschnitt, wie viele Personen ihn komplett
 * abdecken. Benachbarte Abschnitte mit gleicher Anzahl werden verschmolzen.
 *
 * @param {{start: string, end: string}} day  Zeitfenster des Tages
 * @param {Array<{start: string, end: string, participant_id?: string}>} ranges
 * @returns {Array<{start: string, end: string, count: number}>}
 */
export function segmentCounts(day, ranges) {
  const dayStart = toMin(day.start);
  const dayEnd = toMin(day.end);
  if (dayEnd <= dayStart) return [];

  const spans = [];
  const points = new Set([dayStart, dayEnd]);

  ranges.forEach((range, index) => {
    const start = Math.max(toMin(range.start), dayStart);
    const end = Math.min(toMin(range.end), dayEnd);
    if (end <= start) return;

    spans.push({ start, end, key: range.participant_id ?? `range-${index}` });
    points.add(start);
    points.add(end);
  });

  const borders = [...points].sort((a, b) => a - b);
  const segments = [];

  for (let i = 0; i < borders.length - 1; i += 1) {
    const start = borders[i];
    const end = borders[i + 1];
    if (end <= start) continue;

    // Ein Abschnitt zählt nur, wenn ein Zeitraum ihn vollständig abdeckt.
    const covering = spans.filter((span) => span.start <= start && span.end >= end);
    const count = new Set(covering.map((span) => span.key)).size;

    const last = segments[segments.length - 1];
    if (last && last.count === count && toMin(last.end) === start) {
      last.end = fromMin(end);
    } else {
      segments.push({ start: fromMin(start), end: fromMin(end), count });
    }
  }

  return segments;
}
