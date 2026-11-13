/**
 * Smoke-Test für das lokale Backend. Läuft ohne Browser:
 *   node tests/store.test.mjs
 */

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key)
};

const store = await import('../src/store.js');
const { mergeRanges, segmentCounts } = await import('../src/util.js');

let failures = 0;
const ok = (condition, label) => {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
};

const expectCode = async (promise, code, label) => {
  try {
    await promise;
    ok(false, label);
  } catch (error) {
    ok(error.code === code, `${label} (${error.code})`);
  }
};

console.log('\nEvent + Tage');
const days = [
  { date: '2026-05-12', start: '10:00', end: '18:00' },
  { date: '2026-05-13', start: '09:30', end: '12:00' }
];
const created = await store.createEvent({ name: '  Spieleabend  ', days });
ok(created.admin_token.length === 32, 'Admin-Token hat 32 Hex-Zeichen');

let admin = await store.adminLoad(created.admin_token);
ok(admin.event.name === 'Spieleabend', 'Name wird getrimmt');
ok(admin.days.length === 2, 'beide Tage gespeichert');
ok(admin.days[0].date === '2026-05-12' && admin.days[0].start === '10:00', 'Tag 1 korrekt');

console.log('\nBenutzer');
admin = await store.adminAddParticipant(created.admin_token, 'Anna');
admin = await store.adminAddParticipant(created.admin_token, 'Ben');
ok(admin.participants.length === 2, 'zwei Benutzer angelegt');
ok(
  admin.participants.every((p) => p.token.length === 32),
  'jeder Benutzer hat einen eigenen Token'
);
await expectCode(
  store.adminAddParticipant(created.admin_token, 'anna'),
  'duplicate_name',
  'doppelter Name wird abgelehnt'
);

console.log('\nTeilnehmer-Sicht');
const anna = admin.participants.find((p) => p.name === 'Anna');
const ben = admin.participants.find((p) => p.name === 'Ben');
const day1 = admin.days.find((d) => d.date === '2026-05-12');

const view = await store.participantLoad(anna.token);
ok(view.me.name === 'Anna', 'me ist korrekt');
ok(view.participants.length === 2, 'sieht alle anderen');
ok(
  view.participants.every((p) => p.token === undefined),
  'fremde Tokens werden nicht ausgeliefert'
);
await expectCode(store.participantLoad('deadbeef'), 'invalid_token', 'falscher Link abgelehnt');

console.log('\nZeiträume');
await store.setAvailability(anna.token, day1.id, [{ start: '10:00', end: '12:00' }]);
await store.setAvailability(anna.token, day1.id, [
  { start: '10:00', end: '12:00' },
  { start: '14:00', end: '16:30' }
]);
const annaView = await store.participantLoad(anna.token);
ok(annaView.availability.length === 2, 'zwei Zeiträume gespeichert');

const overlap = mergeRanges([
  { start: '10:00', end: '12:00' },
  { start: '11:30', end: '13:00' },
  { start: '13:00', end: '14:00' }
]);
ok(
  overlap.length === 1 && overlap[0].start === '10:00' && overlap[0].end === '14:00',
  'überlappende und aneinanderliegende Zeiträume verschmelzen zu einem'
);

const distinct = mergeRanges([
  { start: '16:00', end: '18:00' },
  { start: '10:00', end: '12:00' }
]);
ok(
  distinct.length === 2 && distinct[0].start === '10:00' && distinct[1].start === '16:00',
  'getrennte Zeiträume bleiben getrennt und werden sortiert'
);

await expectCode(
  store.setAvailability(anna.token, day1.id, [{ start: '17:00', end: '19:00' }]),
  'invalid_range',
  'Zeitraum außerhalb der Event-Zeit wird abgelehnt'
);
await expectCode(
  store.setAvailability(ben.token, day1.id, [{ start: '12:00', end: '10:00' }]),
  'invalid_range',
  'invertierter Zeitraum wird abgelehnt'
);

await store.setAvailability(ben.token, day1.id, [{ start: '10:00', end: '18:00' }]);
admin = await store.adminLoad(created.admin_token);
ok(admin.availability.length === 3, 'Admin sieht Einträge aller Benutzer');
ok(
  admin.availability.every((a) => a.participant_id === anna.id || a.participant_id === ben.id),
  'Einträge sind den richtigen Benutzern zugeordnet'
);

console.log('\nAufräumen');
admin = await store.adminUpdateEvent(created.admin_token, {
  name: 'Spieleabend',
  days: [
    {
      id: admin.days[1].id,
      date: admin.days[1].date,
      start: admin.days[1].start,
      end: admin.days[1].end
    }
  ]
});
ok(admin.days.length === 1, 'Tag entfernt');
ok(admin.availability.length === 0, 'Einträge gelöschter Tage mit entfernt');

admin = await store.adminRemoveParticipant(created.admin_token, anna.id);
ok(admin.participants.length === 1, 'Benutzer entfernt');
await expectCode(
  store.participantLoad(anna.token),
  'invalid_token',
  'Link des gelöschten Benutzers ist tot'
);

console.log('\nValidierung');
await expectCode(
  store.createEvent({ name: 'x', days: [{ date: '2026-01-01', start: '18:00', end: '10:00' }] }),
  'invalid_days',
  'Ende vor Beginn wird abgelehnt'
);
await expectCode(store.createEvent({ name: '   ', days }), 'invalid_name', 'leerer Name wird abgelehnt');
await expectCode(
  store.createEvent({ name: 'x', days: [] }),
  'invalid_days',
  'leere Tagesliste wird abgelehnt'
);

console.log('\nAnzahl Personen pro Zeitraum');
const tag = { start: '10:00', end: '18:00' };

const getrennt = segmentCounts(tag, [
  { participant_id: 'anna', start: '10:00', end: '12:00' },
  { participant_id: 'ben', start: '13:00', end: '18:00' }
]);
ok(
  JSON.stringify(getrennt) ===
    JSON.stringify([
      { start: '10:00', end: '12:00', count: 1 },
      { start: '12:00', end: '13:00', count: 0 },
      { start: '13:00', end: '18:00', count: 1 }
    ]),
  'getrennte Zeiträume ergeben drei Abschnitte'
);

const ueberlappt = segmentCounts(tag, [
  { participant_id: 'anna', start: '10:00', end: '14:00' },
  { participant_id: 'ben', start: '12:00', end: '16:00' }
]);
ok(
  JSON.stringify(ueberlappt) ===
    JSON.stringify([
      { start: '10:00', end: '12:00', count: 1 },
      { start: '12:00', end: '14:00', count: 2 },
      { start: '14:00', end: '16:00', count: 1 },
      { start: '16:00', end: '18:00', count: 0 }
    ]),
  'Überschneidung ergibt einen Abschnitt mit 2 Personen'
);

const alle = segmentCounts(tag, [
  { participant_id: 'anna', start: '10:00', end: '18:00' },
  { participant_id: 'ben', start: '10:00', end: '18:00' }
]);
ok(
  alle.length === 1 && alle[0].count === 2 && alle[0].start === '10:00',
  'alle durchgehend verfügbar ergibt einen Abschnitt'
);

const aneinander = segmentCounts(tag, [
  { participant_id: 'anna', start: '10:00', end: '12:00' },
  { participant_id: 'ben', start: '12:00', end: '14:00' }
]);
ok(
  aneinander.length === 2 &&
    aneinander[0].start === '10:00' &&
    aneinander[0].end === '14:00' &&
    aneinander[0].count === 1 &&
    aneinander[1].count === 0,
  'gleiche Anzahl in Folgeabschnitten wird zusammengefasst'
);

const gleichePerson = segmentCounts(tag, [
  { participant_id: 'anna', start: '10:00', end: '12:00' },
  { participant_id: 'anna', start: '10:00', end: '12:00' }
]);
ok(
  gleichePerson[0].count === 1,
  'doppelte Zeiträume derselben Person zählen nur einmal'
);

const leer = segmentCounts(tag, []);
ok(leer.length === 1 && leer[0].count === 0, 'ohne Einträge ist die Anzahl 0');

const ausserhalb = segmentCounts(tag, [{ participant_id: 'anna', start: '08:00', end: '09:00' }]);
ok(
  ausserhalb.every((segment) => segment.count === 0),
  'Zeiträume außerhalb des Tages zählen nicht'
);

console.log('\nAblauf & Löschen');
const bald = await store.createEvent({ name: 'Alt', days });
const ttlMs = Date.parse(bald.expires_at) - Date.now();
ok(
  Math.abs(ttlMs - 180 * 24 * 60 * 60 * 1000) < 60 * 1000,
  'Ablauf liegt 180 Tage in der Zukunft'
);

let baldView = await store.adminAddParticipant(bald.admin_token, 'Zoe');
const zoe = baldView.participants[0];

// Event künstlich in die Vergangenheit setzen
const stored = JSON.parse(memory.get('terminplaner.v1'));
const target = stored.events.find((event) => event.admin_token === bald.admin_token);
target.expires_at = new Date(Date.now() - 60 * 1000).toISOString();
memory.set('terminplaner.v1', JSON.stringify(stored));

await expectCode(store.adminLoad(bald.admin_token), 'expired', 'abgelaufener Admin-Link');
await expectCode(store.participantLoad(zoe.token), 'expired', 'abgelaufener Teilnehmer-Link');

await store.createEvent({ name: 'Neu', days });
const nachAufraeumen = JSON.parse(memory.get('terminplaner.v1'));
ok(
  !nachAufraeumen.events.some((event) => event.admin_token === bald.admin_token),
  'abgelaufenes Event wird beim naechsten Anlegen aufgeraeumt'
);

const weg = await store.createEvent({ name: 'Weg damit', days });
await store.adminDeleteEvent(weg.admin_token);
await expectCode(store.adminLoad(weg.admin_token), 'invalid_token', 'geloeschtes Event ist weg');

console.log(failures === 0 ? '\nALLE TESTS BESTANDEN\n' : `\n${failures} TEST(S) FEHLGESCHLAGEN\n`);
process.exit(failures === 0 ? 0 : 1);
