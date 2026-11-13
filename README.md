# Terminplaner – wer kann wann?

Minimale Web-App zum gemeinsamen Terminfinden.

- Ein **Event** hat einen Namen und einen oder mehrere **Tage** mit einer Uhrzeit-Spanne.
- Der Ersteller bekommt einen **Admin-Link** und legt dort **Benutzer** an.
- Jeder Benutzer bekommt einen **persönlichen Link**. Über diesen Link sieht er *alle* bisherigen
  Einträge und darf **nur seine eigenen** Zeiträume eintragen, ändern und löschen.
- Termine setzen: entweder exakte Zeiträume eintippen **oder ganze Stunden in der Leiste anklicken**
  (nochmal klicken wählt die Stunde wieder ab). Das ✕ am Balken löscht den ganzen Zeitraum.
- **Gemeinsame Zeitachse über alle Tage**: die Skala reicht vom frühesten Beginn bis zum spätesten
  Ende, damit z. B. 09:00 in jeder Tageszeile untereinander steht. Der aktive Bereich eines Tages
  ist hervorgehoben, der Rest bleibt blass.
- Die Übersicht zeigt **alle Einträge als Gantt-Balken**: pro Tag eine Zeile je Person auf
  derselben Zeitachse (die eigene Zeile ist markiert), darunter die Anzahl der Personen pro
  Zeitabschnitt (z. B. `10:00 – 12:00 · 2/3`) – grün, wo alle verfügbar sind.
- Keine Logins, keine Passwörter, keine Cookies: Der Link **ist** der Zugangsschlüssel.
- **Meine Events** (`#/mine`) listet alle Events, die in diesem Browser angelegt oder geöffnet
  wurden – zum Wiederfinden, Link kopieren und Aufräumen.
- **Aufbewahrung: 180 Tage.** Danach löscht sich ein Event samt Benutzern und Einträgen
  automatisch. Der Ersteller kann es im Admin-Bereich auch jederzeit sofort löschen.

Läuft als reine Static-Site auf GitHub Pages – ohne Build-Schritt, ohne Framework.

---

## 1. Lokal ausprobieren

Ein ES-Modul-Setup braucht einen HTTP-Server; ein Doppelklick auf `index.html` funktioniert nicht.

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Solange in `src/config.js` kein Supabase-Zugang steht, läuft die App im **Demo-Modus**:
Alle Daten liegen im `localStorage` deines Browsers. Gut zum Klicken und Testen – aber
verschiedene Personen sehen sich gegenseitig **nicht**. Oben erscheint ein entsprechender Hinweis.

---

## 2. Auf GitHub Pages veröffentlichen

```bash
git init
git add .
git commit -m "Terminplaner"
git branch -M main
git remote add origin https://github.com/<dein-name>/<repo>.git
git push -u origin main
```

Dann im Repo: **Settings → Pages → Source: „Deploy from a branch“**, Branch `main`, Ordner `/ (root)`.

Nach ein bis zwei Minuten ist die Seite unter
`https://<dein-name>.github.io/<repo>/` erreichbar.

> Die Tokens stehen im URL-Fragment (`#/p/...`). Fragmente werden **nicht** an den Server
> geschickt und landen daher nicht in Server-Logs.

---

## 3. Echte Datenbank: Supabase (kostenlos, ~5 Minuten)

Ohne diesen Schritt funktioniert nur der Demo-Modus.

1. Auf [supabase.com](https://supabase.com) ein kostenloses Projekt anlegen.
2. Im Projekt **SQL Editor** öffnen und den kompletten Inhalt von
   [`supabase/schema.sql`](supabase/schema.sql) einfügen und ausführen.
3. Unter **Project Settings → API** zwei Werte kopieren:
   - `Project URL` → z. B. `https://abcdefghijkl.supabase.co`
   - `anon` / `public` Key

4. In [`src/config.js`](src/config.js) eintragen:

```js
export const config = {
  supabase: {
    url: 'https://abcdefghijkl.supabase.co',
    anonKey: 'eyJhbGciOi...'
  }
};
```

Commit, push – fertig. Die App schaltet automatisch um.

> Der `anon` Key darf öffentlich im Repo stehen. Der eigentliche Schutz kommt aus dem Schema:
> RLS ist auf allen Tabellen aktiv und es gibt **keine** Policies, also ist direkter Tabellen-
> zugriff für `anon` komplett gesperrt. Gelesen und geschrieben wird ausschließlich über
> `SECURITY DEFINER`-Funktionen, die einen gültigen Token verlangen.

---

## 4. Die Links

| Link | Wer | Was möglich |
| --- | --- | --- |
| `#/` | – | Neues Event anlegen |
| `#/mine` | Ersteller (pro Browser) | Eigene Events wiederfinden, Admin-Link kopieren, Event öffnen |
| `#/a/<admin_token>` | Ersteller | Event umbenennen, Tage ändern, Benutzer anlegen/löschen, Gesamtübersicht, Event löschen |
| `#/p/<participant_token>` | Benutzer | Alle Einträge sehen, eigene Zeiträume pro Tag setzen/entfernen, persönlichen Link erneut kopieren |

**Wichtig:** Wer einen Link hat, hat die Rechte dazu. Links sind also wie Passwörter zu behandeln.
Ein Admin-Link lässt sich nicht rotieren – im Zweifel ein neues Event anlegen.

`#/mine` ist nur eine Merkliste im `localStorage` **dieses** Browsers. Sie ersetzt keinen Login:
Auf einem anderen Gerät brauchst du den Admin-Link. Dafür braucht die App kein Konto und keine
E-Mail-Adresse.

---

## 5. Aufbewahrung: 180 Tage

Jedes Event bekommt beim Anlegen ein `expires_at` (Standard: `now() + 180 Tage`). Danach ist es weg –
inklusive Tage, Benutzer und Einträge.

- **Client:** Links zu abgelaufenen Events liefern „Dieses Event ist abgelaufen …“. Eine neue
  Event-Anlage räumt abgelaufene Datensätze beim Lesen/Schreiben mit auf.
- **Datenbank:** Alle RPCs prüfen `expires_at > now()` und werfen `expired`. Zusätzlich räumt
  `app_create_event()` bei jedem Aufruf abgelaufene Events per `DELETE` weg – damit braucht es
  keinen Cronjob und kein `pg_cron`.
- **Sofort löschen:** Im Admin-Bereich unter „Event löschen“ (löscht via `ON DELETE CASCADE`).

Die Frist steht an einer Stelle: `public._event_ttl()` in [`supabase/schema.sql`](supabase/schema.sql)
und `RETENTION_DAYS` in [`src/registry.js`](src/registry.js).

> Bewusste Entscheidung: **kein Superadmin**. Ein globales Backend-Passwort wäre ein einzelnes
> Ziel für Angriffe und würde bedeuten, dass jemand alle Einträge aller Gruppen lesen kann. Die
> automatische Löschung löst das Aufräum-Problem ohne dieses Risiko.

---

## 6. Datenmodell

```
events         id, name, admin_token, created_at, expires_at
event_days     id, event_id, day, start_time, end_time, position
participants   id, event_id, name, token, created_at
availability   id, participant_id, day_id, start_time, end_time
```

Ein Teilnehmer kann pro Tag **mehrere** Zeiträume haben. Beim Speichern werden überlappende und
direkt aneinanderliegende Bereiche automatisch zusammengefasst. Zeiträume müssen innerhalb der
Event-Zeit des jeweiligen Tages liegen – das prüfen Client **und** Datenbank.

Die Zählzeile unter jedem Tag berechnet sich aus den Einträgen selbst: Das Tagesfenster wird an
allen Grenzen der Zeiträume zerlegt, und jeder Abschnitt zählt die Personen, deren Zeitraum ihn
**vollständig** abdeckt (`segmentCounts()` in `src/util.js`). Benachbarte Abschnitte mit gleicher
Anzahl werden zusammengefasst; Abschnitte mit 0 bleiben sichtbar, damit Lücken auffallen.

---

## 7. Projektstruktur

```
index.html              App-Shell
src/app.js              Router, Views (Start / Meine Events / Admin / Teilnehmer)
src/store.js            Speicher-Abstraktion: localStorage <-> Supabase-RPC
src/registry.js         Merkliste der eigenen Events im Browser (180-Tage-Frist)
src/config.js           Backend-Konfiguration (hier Supabase eintragen)
src/util.js             Zeit-/Datums-Helfer, Zeitraum-Merging, Abschnittszählung
src/dom.js              Mini-DOM-Helfer (h())
src/styles.css          Styles (hell + dunkel via prefers-color-scheme)
supabase/schema.sql     Tabellen, RLS, RPC-Funktionen
tests/store.test.mjs    Smoke-Test ohne Browser: node tests/store.test.mjs
```

Es gibt zwei Backends mit identischer API:

```js
createEvent({ name, days })
adminLoad(adminToken)
adminUpdateEvent(adminToken, { name, days })
adminAddParticipant(adminToken, name)
adminRemoveParticipant(adminToken, participantId)
adminDeleteEvent(adminToken)
participantLoad(participantToken)
setAvailability(participantToken, dayId, ranges)
```

Ein weiteres Backend (eigener Server, Firebase, …) braucht nur diese acht Funktionen.

---

## 8. Grenzen & Ideen

- **Kein Login** – nur Token. Wer einen Link weitergibt, gibt Zugriff weiter. Das ist bewusst
  einfach gehalten; für mehr Sicherheit wäre ein echtes Auth-System nötig.
- `#/mine` ist pro Browser, nicht pro Person.
- Keine E-Mail-Versendung – Links manuell kopieren und weitergeben.
- Sinnvolle Erweiterungen: „Alle Links als Text kopieren“, Kommentarfeld pro Tag,
  iCal-Export, „besten gemeinsamen Termin vorschlagen“.
