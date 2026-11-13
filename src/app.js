import { h } from './dom.js';
import * as store from './store.js';
import { backendName } from './store.js';
import * as registry from './registry.js';
import { formatDate, formatDay, fromMin, mergeRanges, segmentCounts, toMin, todayISO, toggleHourRange } from './util.js';

const root = document.getElementById('app');

const ERROR_TEXT = {
  invalid_token: 'Dieser Link ist ungültig oder wurde zurückgesetzt.',
  invalid_name: 'Bitte gib einen Namen ein.',
  invalid_days: 'Bitte prüfe die Tage: Datum, Beginn und Ende sind nötig – und der Beginn muss vor dem Ende liegen.',
  invalid_range: 'Der Zeitraum muss innerhalb der Event-Zeit liegen und der Beginn vor dem Ende.',
  duplicate_name: 'Diesen Namen gibt es bei diesem Event schon.',
  expired: 'Dieses Event ist abgelaufen und wurde automatisch gelöscht (Aufbewahrung: 180 Tage).',
  schema_missing:
    'Die Datenbank ist noch nicht eingerichtet: Bitte supabase/schema.sql im Supabase SQL Editor ausführen (siehe SETUP.md).',
  config_invalid:
    'Die Supabase-Angaben in src/config.js fehlen oder sehen falsch aus (siehe SETUP.md).',
  network_error: 'Keine Verbindung zum Server. Bitte später erneut versuchen.',
  unknown: 'Da ist etwas schiefgelaufen.'
};

const errorText = (error) => ERROR_TEXT[error?.code] || error?.message || ERROR_TEXT.unknown;

/* ------------------------------------------------------------------ */
/* Kleinkram                                                           */
/* ------------------------------------------------------------------ */

function toast(message) {
  const box = document.getElementById('toast');
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove('show'), 2800);
}

async function copyText(text, label = 'Link kopiert.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    window.prompt('Link zum Kopieren:', text);
  }
}

const appUrl = (kind, token) =>
  `${location.origin}${location.pathname}#/${kind}/${token}`;

function linkBox(label, url) {
  return h(
    'div',
    { class: 'linkbox' },
    h('div', { class: 'linkbox-label' }, label),
    h('code', { class: 'linkbox-url' }, url),
    h(
      'button',
      { type: 'button', class: 'btn btn-small', onclick: () => copyText(url) },
      'Kopieren'
    )
  );
}

function renderError(error) {
  root.replaceChildren(
    h(
      'section',
      { class: 'panel narrow' },
      h('h2', {}, 'Das hat nicht geklappt'),
      h('p', { class: 'muted' }, errorText(error)),
      h('a', { class: 'btn', href: '#/' }, 'Zur Startseite')
    )
  );
}

/* ------------------------------------------------------------------ */
/* Tages-Editor (wird auf Start- und Admin-Seite verwendet)            */
/* ------------------------------------------------------------------ */

function daysEditor(rows, { onChange }) {
  const box = h('div', { class: 'days' });

  const paint = () => {
    box.replaceChildren(
      ...rows.map((row, index) =>
        h(
          'div',
          { class: 'day-row' },
          h('input', {
            type: 'date',
            value: row.date || '',
            oninput: (event) => {
              row.date = event.target.value;
            }
          }),
          h('input', {
            type: 'time',
            value: row.start || '10:00',
            'aria-label': 'Beginn',
            oninput: (event) => {
              row.start = event.target.value;
            }
          }),
          h('span', { class: 'dash' }, '–'),
          h('input', {
            type: 'time',
            value: row.end || '18:00',
            'aria-label': 'Ende',
            oninput: (event) => {
              row.end = event.target.value;
            }
          }),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              title: 'Tag entfernen',
              onclick: () => {
                if (rows.length === 1) {
                  toast('Mindestens ein Tag ist nötig.');
                  return;
                }
                rows.splice(index, 1);
                paint();
                onChange?.();
              }
            },
            '✕'
          )
        )
      )
    );
  };

  paint();

  return {
    node: box,
    repaint: paint
  };
}

/* ------------------------------------------------------------------ */
/* Startseite: Event anlegen                                           */
/* ------------------------------------------------------------------ */

function renderHome() {
  const rows = [{ date: todayISO(), start: '10:00', end: '18:00' }];

  const nameInput = h('input', {
    type: 'text',
    placeholder: 'z. B. Spieleabend bei Anna',
    maxlength: '120',
    autocomplete: 'off'
  });

  const editor = daysEditor(rows, { onChange: () => {} });

  const submit = h('button', { type: 'button', class: 'btn btn-primary' }, 'Event erstellen');

  submit.addEventListener('click', async () => {
    submit.disabled = true;
    submit.textContent = 'Wird erstellt …';
    try {
      const created = await store.createEvent({ name: nameInput.value, days: rows });
      registry.remember({
        id: created.event_id,
        name: nameInput.value.trim(),
        adminToken: created.admin_token,
        expiresAt: created.expires_at
      });
      location.hash = `#/a/${created.admin_token}`;
      toast('Event erstellt. Speichere den Admin-Link!');
    } catch (error) {
      toast(errorText(error));
      submit.disabled = false;
      submit.textContent = 'Event erstellen';
    }
  });

  root.replaceChildren(
    h(
      'section',
      { class: 'panel' },
      h('h1', {}, 'Wer kann wann?'),
      h(
        'p',
        { class: 'lead' },
        'Lege ein Event mit einem oder mehreren Tagen an. Danach erzeugst du für jede Person ',
        'einen eigenen Link – dort trägt sie ihre Zeiten ein und sieht, was die anderen eingetragen haben.'
      ),

      h('label', { class: 'field' }, h('span', {}, 'Event-Name'), nameInput),

      h(
        'div',
        { class: 'field' },
        h('span', {}, 'Tage & Zeiten, an denen das Event stattfindet'),
        editor.node,
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost',
            onclick: () => {
              rows.push({ date: todayISO(), start: '10:00', end: '18:00' });
              editor.repaint();
            }
          },
          '+ Tag hinzufügen'
        )
      ),

      h('div', { class: 'actions' }, submit)
    ),

    h(
      'section',
      { class: 'panel muted-panel' },
      h('h3', {}, 'So funktioniert es'),
      h(
        'ol',
        { class: 'steps' },
        h('li', {}, 'Event anlegen – du bekommst einen Admin-Link.'),
        h('li', {}, 'Im Admin-Bereich legst du für jede teilnehmende Person einen Benutzer an.'),
        h('li', {}, 'Jede Person bekommt einen persönlichen Link. Nur dieser Link darf Zeiten eintragen.'),
        h('li', {}, 'Alle sehen jederzeit die komplette Übersicht.')
      )
    )
  );
}

/* ------------------------------------------------------------------ */
/* Meine Events (nur in diesem Browser gemerkt)                        */
/* ------------------------------------------------------------------ */

function renderMine() {
  const entries = registry.list();

  const items = entries.length
    ? entries.map((entry) =>
        h(
          'li',
          { class: 'event-item' },
          h(
            'div',
            { class: 'event-main' },
            h('div', { class: 'event-name' }, entry.name || 'Ohne Namen'),
            h(
              'div',
              { class: 'muted small' },
              entry.expiresAt
                ? `Läuft am ${formatDate(entry.expiresAt)} automatisch ab`
                : `Läuft ${registry.RETENTION_DAYS} Tage nach dem Anlegen ab`
            )
          ),
          h(
            'div',
            { class: 'event-actions' },
            h('a', { class: 'btn btn-small', href: `#/a/${entry.adminToken}` }, 'Öffnen'),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-small',
                onclick: () => copyText(appUrl('a', entry.adminToken), 'Admin-Link kopiert.')
              },
              'Link kopieren'
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-small btn-danger',
                onclick: () => {
                  registry.forget(entry.adminToken);
                  renderMine();
                  toast('Aus der Liste entfernt – das Event selbst bleibt bestehen.');
                }
              },
              'Aus Liste entfernen'
            )
          )
        )
      )
    : [
        h(
          'p',
          { class: 'muted' },
          'In diesem Browser ist noch kein Event gemerkt. Lege eins an – oder öffne einen Admin-Link.'
        )
      ];

  root.replaceChildren(
    h(
      'section',
      { class: 'panel' },
      h(
        'div',
        { class: 'panel-head' },
        h('h1', {}, 'Meine Events'),
        h('a', { class: 'btn btn-primary', href: '#/' }, 'Neues Event')
      ),
      h(
        'p',
        { class: 'lead' },
        'Diese Liste liegt nur in diesem Browser. Auf einem anderen Gerät brauchst du den Admin-Link.'
      ),
      h('ul', { class: 'event-list' }, ...items)
    ),
    h(
      'section',
      { class: 'panel muted-panel' },
      h('h3', {}, 'Aufbewahrung'),
      h(
        'p',
        { class: 'muted small' },
        `Events löschen sich ${registry.RETENTION_DAYS} Tage nach dem Anlegen automatisch – samt aller Benutzer und Einträge. Vorher kannst du ein Event im Admin-Bereich auch sofort löschen.`
      )
    )
  );
}

/* ------------------------------------------------------------------ */
/* Admin-Bereich                                                       */
/* ------------------------------------------------------------------ */

async function renderAdmin(adminToken) {
  let data = await store.adminLoad(adminToken);
  registry.remember({
    id: data.event.id,
    name: data.event.name,
    adminToken,
    expiresAt: data.event.expires_at
  });
  let draft;

  const resetDraft = () => {
    draft = {
      name: data.event.name,
      days: data.days.map((day) => ({
        id: day.id,
        date: day.date,
        start: day.start,
        end: day.end
      }))
    };
  };
  resetDraft();

  const paint = () => {
    const editor = daysEditor(draft.days, { onChange: () => {} });

    const nameInput = h('input', {
      type: 'text',
      value: draft.name,
      maxlength: '120',
      oninput: (event) => {
        draft.name = event.target.value;
      }
    });

    const saveButton = h('button', { type: 'button', class: 'btn btn-primary' }, 'Event speichern');
    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      try {
        data = await store.adminUpdateEvent(adminToken, { name: draft.name, days: draft.days });
        registry.remember({
          id: data.event.id,
          name: data.event.name,
          adminToken,
          expiresAt: data.event.expires_at
        });
        resetDraft();
        paint();
        toast('Event gespeichert.');
      } catch (error) {
        toast(errorText(error));
        saveButton.disabled = false;
      }
    });

    const newParticipant = h('input', {
      type: 'text',
      placeholder: 'Name der Person',
      maxlength: '120',
      autocomplete: 'off'
    });

    const addButton = h('button', { type: 'button', class: 'btn' }, 'Benutzer anlegen');
    addButton.addEventListener('click', async () => {
      addButton.disabled = true;
      try {
        data = await store.adminAddParticipant(adminToken, newParticipant.value);
        paint();
        toast('Benutzer angelegt.');
      } catch (error) {
        toast(errorText(error));
        addButton.disabled = false;
      }
    });
    newParticipant.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') addButton.click();
    });

    const participantList = data.participants.length
      ? h(
          'ul',
          { class: 'participant-list' },
          ...data.participants.map((participant) =>
            h(
              'li',
              { class: 'participant' },
              h('div', { class: 'participant-name' }, participant.name),
              h(
                'div',
                { class: 'participant-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn-small',
                    onclick: () => copyText(appUrl('p', participant.token), 'Link kopiert.')
                  },
                  'Link kopieren'
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn-small btn-danger',
                    onclick: async () => {
                      if (!confirm(`„${participant.name}“ wirklich entfernen? Alle Einträge gehen verloren.`)) {
                        return;
                      }
                      try {
                        data = await store.adminRemoveParticipant(adminToken, participant.id);
                        paint();
                        toast('Benutzer entfernt.');
                      } catch (error) {
                        toast(errorText(error));
                      }
                    }
                  },
                  'Entfernen'
                )
              )
            )
          )
        )
      : h('p', { class: 'muted' }, 'Noch keine Benutzer angelegt.');

    root.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' },
          h('h1', {}, data.event.name),
          h('span', { class: 'badge badge-admin' }, 'Admin')
        ),
        h(
          'p',
          { class: 'lead' },
          'Dieser Link ist dein Admin-Zugang. Wer ihn hat, kann Benutzer anlegen und das Event ändern – gib ihn nicht weiter.'
        ),
        linkBox('Dein Admin-Link', appUrl('a', adminToken)),
        h(
          'p',
          { class: 'muted small' },
          data.event.expires_at
            ? `Dieses Event und alle Einträge werden am ${formatDate(data.event.expires_at)} automatisch gelöscht.`
            : `Dieses Event wird ${store.RETENTION_DAYS} Tage nach dem Anlegen automatisch gelöscht.`
        )
      ),

      h(
        'section',
        { class: 'panel' },
        h('h2', {}, 'Event bearbeiten'),
        h('label', { class: 'field' }, h('span', {}, 'Event-Name'), nameInput),
        h(
          'div',
          { class: 'field' },
          h('span', {}, 'Tage & Zeiten'),
          editor.node,
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-ghost',
              onclick: () => {
                draft.days.push({ id: null, date: todayISO(), start: '10:00', end: '18:00' });
                editor.repaint();
              }
            },
            '+ Tag hinzufügen'
          )
        ),
        h('div', { class: 'actions' }, saveButton)
      ),

      h(
        'section',
        { class: 'panel' },
        h('h2', {}, 'Benutzer'),
        h('p', { class: 'muted' }, 'Jeder Benutzer bekommt einen eigenen Link. Schicke ihn der Person direkt weiter.'),
        h('div', { class: 'inline-form' }, newParticipant, addButton),
        participantList
      ),

      h(
        'section',
        { class: 'panel' },
        h('h2', {}, 'Übersicht'),
        overview(data)
      ),

      h(
        'section',
        { class: 'panel' },
        h('h2', {}, 'Event löschen'),
        h(
          'p',
          { class: 'muted' },
          'Entfernt das Event samt aller Benutzer und Einträge sofort. Das lässt sich nicht rückgängig machen.'
        ),
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-danger',
              onclick: async () => {
                if (!confirm('Event endgültig löschen? Alle Benutzer und Einträge gehen verloren.')) {
                  return;
                }
                try {
                  await store.adminDeleteEvent(adminToken);
                  registry.forget(adminToken);
                  location.hash = '#/mine';
                  toast('Event gelöscht.');
                } catch (error) {
                  toast(errorText(error));
                }
              }
            },
            'Event endgültig löschen'
          )
        )
      )
    );
  };

  paint();
}

/* ------------------------------------------------------------------ */
/* Teilnehmer-Ansicht                                                  */
/* ------------------------------------------------------------------ */

async function renderParticipant(participantToken) {
  let data = await store.participantLoad(participantToken);

  const paint = () => {
    const axis = data.days.length ? sharedAxis(data.days) : null;
    const cards = data.days.length
      ? data.days.map((day) => availabilityCard(participantToken, data, day, axis, {
          saved: (next) => {
            data = next;
            paint();
            toast('Gespeichert.');
          },
          failed: (error) => toast(errorText(error)),
          reload: async () => {
            try {
              data = await store.participantLoad(participantToken);
              paint();
            } catch (error) {
              toast(errorText(error));
            }
          }
        }))
      : [h('p', { class: 'muted' }, 'Für dieses Event sind noch keine Tage festgelegt.')];

    root.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' },
          h('h1', {}, data.event.name),
          h('span', { class: 'badge' }, data.me.name)
        ),
        h('p', { class: 'lead' }, 'Trage ein, an welchen Tagen und in welchen Zeiträumen du kannst. Du kannst pro Tag mehrere Zeiträume angeben.')
      ),

      h('section', { class: 'panel' }, h('h2', {}, 'Deine Zeiten'), cards),

      h('section', { class: 'panel' }, h('h2', {}, 'Alle Einträge'), overview(data)),

      h(
        'section',
        { class: 'panel muted-panel' },
        h('p', { class: 'muted' }, 'Speichere diesen Link – nur damit kommst du wieder hierher.'),
        linkBox('Dein persönlicher Link', appUrl('p', participantToken))
      )
    );
  };

  paint();
}

function availabilityCard(participantToken, data, day, axis, callbacks) {
  // Eigener, veränderlicher Stand dieser Karte. Wird bei jedem Klick sofort
  // aktualisiert, damit schnelle Klicks auf mehrere Stunden nicht verloren gehen.
  let mine = data.availability
    .filter((entry) => entry.participant_id === data.me.id && entry.day_id === day.id)
    .sort((a, b) => toMin(a.start) - toMin(b.start));

  // Schreibvorgänge hintereinander ausführen: jede Anfrage schickt den kompletten
  // Tag, parallele Anfragen würden sich sonst gegenseitig überschreiben.
  let queue = Promise.resolve();

  const badgeBox = h('span', { class: 'badge-box' });
  const timelineBox = h('div', { class: 'timeline' });
  const timesBox = h('p', { class: 'tl-times' });

  function paintLocal() {
    if (mine.length) {
      badgeBox.replaceChildren(
        h('span', { class: 'badge badge-ok' }, mine.length === 1 ? '1 Zeitraum' : `${mine.length} Zeiträume`)
      );
    } else {
      badgeBox.replaceChildren();
    }

    timelineBox.replaceChildren(
      timelineTrack(day, mine, { axis, onRemove: removeRange, onToggleHour: toggleHour }),
      timeAxis(axis)
    );

    timesBox.replaceChildren(
      ...(mine.length
        ? mine.map((range) => h('span', { class: 'tl-time' }, `${range.start} – ${range.end}`))
        : [h('span', { class: 'muted' }, 'Noch keine Angabe')])
    );
  }

  async function flush() {
    try {
      const next = await store.setAvailability(participantToken, day.id, mine);
      callbacks.saved(next);
    } catch (error) {
      callbacks.failed(error);
      if (callbacks.reload) callbacks.reload();
    }
  }

  function commit(nextRanges) {
    mine = mergeRanges(nextRanges);
    paintLocal();
    queue = queue.then(flush, flush);
  }

  const startInput = h('input', {
    type: 'time',
    value: day.start,
    min: day.start,
    max: day.end,
    'aria-label': 'Beginn'
  });
  const endInput = h('input', {
    type: 'time',
    value: day.end,
    min: day.start,
    max: day.end,
    'aria-label': 'Ende'
  });

  const addButton = h('button', { type: 'button', class: 'btn btn-small' }, 'Hinzufügen');
  addButton.addEventListener('click', async () => {
    const start = startInput.value.slice(0, 5);
    const end = endInput.value.slice(0, 5);

    if (!start || !end) {
      toast('Bitte Beginn und Ende wählen.');
      return;
    }
    if (toMin(start) >= toMin(end)) {
      toast('Der Beginn muss vor dem Ende liegen.');
      return;
    }
    if (toMin(start) < toMin(day.start) || toMin(end) > toMin(day.end)) {
      toast(`Das Event läuft an diesem Tag von ${day.start} bis ${day.end}.`);
      return;
    }

    commit([...mine, { start, end }]);
  });

  function removeRange(range) {
    commit(mine.filter((entry) => entry !== range));
  }

  // Ganze Stunde zusagen bzw. wieder abwählen.
  function toggleHour(from, to) {
    commit(toggleHourRange(mine, from, to));
  };

  paintLocal();

  return h(
    'article',
    { class: 'day-card' },
    h(
      'div',
      { class: 'day-card-head' },
      h(
        'div',
        {},
        h('div', { class: 'day-title' }, formatDay(day.date)),
        h('div', { class: 'muted small' }, `Event-Zeit: ${day.start} – ${day.end}`)
      ),
      badgeBox
    ),
    timelineBox,
    timesBox,
    h('div', { class: 'add-row' }, startInput, h('span', { class: 'dash' }, '–'), endInput, addButton),
    h(
      'p',
      { class: 'tl-hint' },
      'Tipp: In der Leiste eine Stunde anklicken, um sie zuzusagen – nochmal klicken wählt sie wieder ab.'
    )
  );
}

/**
 * Gemeinsame Zeitachse über alle Tage (kleinster Beginn, größtes Ende).
 * Dadurch steht z. B. 09:00 in jeder Tageszeile an derselben Stelle.
 */
function sharedAxis(days) {
  const startMin = Math.min(...days.map((day) => toMin(day.start)));
  const endMin = Math.max(...days.map((day) => toMin(day.end)));
  return { start: fromMin(startMin), end: fromMin(endMin) };
}

function axisLabel(minute, startMin, span) {
  const left = ((minute - startMin) / span) * 100;
  const align = left < 6 ? ' tl-label-start' : left > 94 ? ' tl-label-end' : '';
  return h('span', { class: `tl-label${align}`, style: `left: ${left}%` }, fromMin(minute));
}

/** Stundenbeschriftung unter einer Zeitachse. */
function timeAxis(axis) {
  const startMin = toMin(axis.start);
  const endMin = toMin(axis.end);
  const span = endMin - startMin || 1;
  const stepHours = Math.max(1, Math.ceil(span / 60 / 8));

  const labels = [];
  for (let minute = startMin; minute < endMin; minute += stepHours * 60) {
    labels.push(axisLabel(minute, startMin, span));
  }
  labels.push(axisLabel(endMin, startMin, span));

  return h('div', { class: 'tl-axis' }, ...labels);
}

/**
 * Eine Zeitachse: gemeinsame Skala, das Tagesfenster als heller Bereich,
 * Zeiträume als Balken. Mit `onToggleHour` werden ganze Stunden klickbar,
 * mit `onRemove` bekommt jeder Balken ein ✕ zum Löschen.
 */
function timelineTrack(day, ranges, options = {}) {
  const { axis = day, onRemove = null, onToggleHour = null, compact = false } = options;

  const axisStart = toMin(axis.start);
  const axisEnd = toMin(axis.end);
  const axisSpan = axisEnd - axisStart || 1;
  const percent = (minute) => ((minute - axisStart) / axisSpan) * 100;

  const dayStart = toMin(day.start);
  const dayEnd = toMin(day.end);

  const children = [
    h('span', {
      class: 'tl-window',
      style: `left: ${percent(dayStart)}%; width: ${percent(dayEnd) - percent(dayStart)}%`
    })
  ];

  for (let minute = Math.ceil(axisStart / 60) * 60; minute < axisEnd; minute += 60) {
    if (minute === axisStart) continue;
    children.push(h('span', { class: 'tl-tick', style: `left: ${percent(minute)}%` }));
  }

  if (onToggleHour) {
    for (let minute = Math.ceil(dayStart / 60) * 60; minute + 60 <= dayEnd; minute += 60) {
      const covered = ranges.some(
        (range) => toMin(range.start) <= minute && toMin(range.end) >= minute + 60
      );
      const from = fromMin(minute);
      const to = fromMin(minute + 60);

      children.push(
        h('button', {
          type: 'button',
          class: 'tl-slot',
          style: `left: ${percent(minute)}%; width: ${(60 / axisSpan) * 100}%`,
          title: `${from} – ${to} ${covered ? 'abwählen' : 'zusagen'}`,
          'aria-pressed': covered ? 'true' : 'false',
          'aria-label': `${from} bis ${to}${covered ? ' abwählen' : ' zusagen'}`,
          onclick: () => onToggleHour(from, to)
        })
      );
    }
  }

  for (const range of ranges) {
    const from = percent(Math.max(toMin(range.start), axisStart));
    const to = percent(Math.min(toMin(range.end), axisEnd));
    const style = `left: ${from}%; width: ${Math.max(to - from, 0)}%`;
    const label = `${range.start} – ${range.end}`;

    if (!onRemove) {
      children.push(h('span', { class: 'tl-bar tl-bar-static', style, title: label }));
      continue;
    }

    children.push(
      h(
        'span',
        { class: 'tl-bar', style, title: label },
        h(
          'button',
          {
            type: 'button',
            class: 'tl-bar-x',
            title: `${label} entfernen`,
            'aria-label': `Zeitraum ${range.start} bis ${range.end} entfernen`,
            onclick: (event) => {
              event.stopPropagation();
              onRemove(range);
            }
          },
          '✕'
        )
      )
    );
  }

  return h('div', { class: `tl-track${compact ? ' tl-compact' : ''}` }, ...children);
}

/* ------------------------------------------------------------------ */
/* Gemeinsame Übersicht: eine Zeitachse pro Person und Tag             */
/* ------------------------------------------------------------------ */

function overview(data) {
  const days = [...data.days].sort((a, b) => a.date.localeCompare(b.date));
  const participants = data.participants;

  if (!days.length) return h('p', { class: 'muted' }, 'Keine Tage festgelegt.');
  if (!participants.length) return h('p', { class: 'muted' }, 'Noch keine Benutzer angelegt.');

  const myId = data.me ? data.me.id : null;
  const axis = sharedAxis(days);

  return h(
    'div',
    { class: 'overview' },
    ...days.map((day) => {
      const dayEntries = data.availability.filter((entry) => entry.day_id === day.id);
      const filled = new Set(dayEntries.map((entry) => entry.participant_id)).size;

      return h(
        'section',
        { class: 'ov-day' },
        h(
          'div',
          { class: 'ov-head' },
          h('div', { class: 'ov-title' }, formatDay(day.date)),
          h(
            'span',
            { class: `badge${filled ? ' badge-ok' : ''}` },
            filled === 0 ? 'keine Einträge' : `${filled}/${participants.length} dabei`
          )
        ),
        h(
          'div',
          { class: 'ov-grid' },
          h(
            'div',
            { class: 'ov-row ov-axis-row' },
            h('div', { class: 'ov-name' }),
            timeAxis(axis)
          ),
          ...participants.map((participant) => {
            const ranges = dayEntries
              .filter((entry) => entry.participant_id === participant.id)
              .sort((a, b) => toMin(a.start) - toMin(b.start));
            const isMe = participant.id === myId;

            return h(
              'div',
              { class: `ov-row${isMe ? ' is-me' : ''}` },
              h(
                'div',
                { class: 'ov-name' },
                h('span', { class: 'ov-person' }, participant.name),
                isMe ? h('span', { class: 'ov-you' }, 'du') : null
              ),
              timelineTrack(day, ranges, { axis, compact: true })
            );
          }),
          h(
            'div',
            { class: 'ov-row ov-sum' },
            h('div', { class: 'ov-name' }, h('div', { class: 'sum-title' }, 'Anzahl')),
            filled === 0
              ? h('div', { class: 'ov-none muted small' }, 'Niemand hat für diesen Tag etwas eingetragen.')
              : h(
                  'div',
                  { class: 'ov-segments' },
                  segmentChips(segmentCounts(day, dayEntries), participants.length)
                )
          )
        )
      );
    })
  );
}

/** Ein Chip pro Abschnitt: Zeitraum + "wie viele von wie vielen". */
function segmentChips(segments, total) {
  if (!segments.length) return h('span', { class: 'muted' }, '–');

  return segments.map((segment) => {
    const level =
      segment.count === 0 ? 'seg-none' : segment.count === total ? 'seg-all' : 'seg-part';

    return h(
      'span',
      { class: `seg ${level}` },
      h('span', { class: 'seg-time' }, `${segment.start} – ${segment.end}`),
      h('span', { class: 'seg-count' }, `${segment.count}/${total}`)
    );
  });
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!raw) return { kind: 'home' };
  const [kind, token] = raw.split('/');
  return { kind, token: token ? decodeURIComponent(token) : '' };
}

async function route() {
  const { kind, token } = parseRoute();

  try {
    if (kind === 'a' && token) await renderAdmin(token);
    else if (kind === 'p' && token) await renderParticipant(token);
    else if (kind === 'mine') renderMine();
    else renderHome();
  } catch (error) {
    renderError(error);
  }
}

window.addEventListener('hashchange', route);

const banner = document.getElementById('backend-hint');
if (banner) {
  if (backendName === 'local') {
    banner.hidden = false;
    banner.textContent =
      'Demo-Modus: Daten werden nur in diesem Browser gespeichert. Für echtes Teilen Supabase in src/config.js eintragen – Anleitung in SETUP.md.';
  }
}

route();
