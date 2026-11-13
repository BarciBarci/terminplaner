# Supabase einrichten — Checkliste

Ziel: Die App speichert Events in einer echten Datenbank, damit **Teilnehmer sich gegenseitig
sehen**. Ohne diesen Schritt läuft alles nur im Browser des jeweiligen Geräts.

Dauer: ~5 Minuten. Kosten: kostenloser Supabase-Tarif reicht.

---

## 0. Voraussetzungen

- [ ] Ein [Supabase](https://supabase.com)-Account (GitHub-Login genügt)
- [ ] Das Repo lokal geklont und Schreibrechte darauf

```bash
git clone https://github.com/BarciBarci/terminplaner.git
cd terminplaner
```

---

## 1. Projekt anlegen

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Name z. B. `terminplaner`, Region **Frankfurt (eu-central-1)** (näher = schneller)
3. Datenbank-Passwort setzen und **notieren** (brauchst du nur für direkten DB-Zugriff)
4. **Create new project** und warten, bis das Projekt „Active" ist (~2 Minuten)

---

## 2. Schema einspielen

1. Im Projekt links auf **SQL Editor** → **New query**
2. Die komplette Datei [`supabase/schema.sql`](supabase/schema.sql) hineinkopieren
3. **Run** (Strg/Cmd + Enter)

Das Skript ist idempotent — du kannst es jederzeit erneut ausführen, z. B. nach einem Update.

**Kontrolle** (im gleichen SQL Editor):

```sql
select public._event_ttl()            as aufbewahrung;  -- 180 days
select count(*)                        as events       from public.events;
select column_name from information_schema.columns
 where table_name = 'events' and column_name = 'expires_at';  -- 1 Zeile
```

Erwartet: `180 days`, `0`, eine Zeile `expires_at`. Keine Fehlermeldung.

---

## 3. Werte kopieren

**Project Settings → Data API** (bei älteren Dashboards: *Project Settings → API*):

| Feld | Wohin | Aussehen |
| --- | --- | --- |
| **Project URL** | `url` | `https://abcdefghijklmnop.supabase.co` |
| **Publishable key** (neues System) bzw. **anon / public** (älteres System) | `anonKey` | `sb_publishable_…` bzw. `eyJhbGciOi…` |

> ⚠️ **Nicht** den Secret-Key nehmen — weder `sb_secret_…` (neues System) noch `service_role`
> (älteres System). Der umgeht jede Zugriffsprüfung und darf niemals in den Browser.
> Wenn du ihn versehentlich veröffentlicht hast: im Dashboard **rotieren**.

---

## 4. In `src/config.js` eintragen

Datei öffnen und beide Werte einsetzen (Vorlage: [`supabase/config.example.js`](supabase/config.example.js)):

```js
export const config = {
  supabase: {
    url: 'https://abcdefghijklmnop.supabase.co',
    anonKey: 'sb_publishable_…'   // oder 'eyJhbGciOi…' beim älteren Key-System
  }
};
```

Es reicht, genau diese zwei Zeilen zu ändern. Ein abschließender `/` oder ein versehentlich
mitkopiertes `/rest/v1` wird von der App automatisch entfernt.

---

## 5. Veröffentlichen

```bash
git add src/config.js
git commit -m "Supabase aktivieren"
git push
```

GitHub Pages baut automatisch neu, das dauert meist **30–90 Sekunden**.

---

## 6. Prüfen, ob es wirklich verbunden ist

- [ ] **https://barcibarci.github.io/terminplaner/** öffnen und **hart neu laden**
      (Strg+Shift+R bzw. Cmd+Shift+R) — sonst hängt die alte Version im Cache.
- [ ] Das graue **Demo-Banner oben ist verschwunden**.
- [ ] Ein Event anlegen, im Admin-Bereich eine Person namens `Test` hinzufügen.
- [ ] Den Teilnehmer-Link **in einem anderen Browser** (oder einem Inkognito-Fenster) öffnen.
      → Das Event und `Test` müssen dort erscheinen. Das ist der eigentliche Beweis.
- [ ] In der Teilnehmer-Ansicht ein paar Stunden anklicken.
- [ ] Zurück im Admin-Browser: F5 → die Balken stehen in der Übersicht.
- [ ] Test-Event danach im Admin-Bereich unter „Event löschen" entfernen.

Wenn all das klappt: fertig.

---

## Fehlersuche

| Symptom | Wahrscheinliche Ursache | Lösung |
| --- | --- | --- |
| Banner „Demo-Modus" bleibt sichtbar | `url` oder `anonKey` leer | Schritt 4, beide Werte ausfüllen |
| „Die Datenbank ist noch nicht eingerichtet …" | `schema.sql` nicht (vollständig) ausgeführt | Schritt 2 wiederholen, komplette Datei einfügen |
| „Die Supabase-Angaben … sehen falsch aus" | Platzhalter aus der Vorlage stehen noch drin, oder `url` ohne `https://` | echte Werte eintragen |
| „Keine Verbindung zum Server" | falsche Project URL, Tippfehler | URL aus dem Dashboard erneut kopieren |
| Änderungen unsichtbar | Browser-Cache | Strg+Shift+R / Inkognito |
| Teilnehmer-Link „ungültig" | Link aus einem anderen Event, oder Event gelöscht/abgelaufen | Admin-Link kopieren und neu versenden |
| „Dieses Event ist abgelaufen" | älter als 180 Tage | neues Event anlegen |
| Alles leer nach Schema-Update | altes Event vor dem Update angelegt | einmal neu anlegen und prüfen |

Wenn eine Fehlermeldung im Browser auftaucht: Konsole öffnen (F12) — die App zeigt die
Server-Antwort dort im Klartext, wenn sie unbekannt ist.

---

## Was die Datenbank schützt

- **RLS an, keine Policies** → direkter Tabellenzugriff mit dem `anon` Key ist komplett gesperrt.
  Ohne die Funktionen aus `schema.sql` kommt niemand an Daten.
- Alle Zugriffe laufen über `SECURITY DEFINER`-Funktionen, die einen gültigen **Token** verlangen.
  Ein Teilnehmer-Token kann nur die eigenen Zeiträume schreiben.
- Der Admin-Token ist der einzige Schlüssel zu seinem Event. Wer ihn hat, hat die Rechte dazu.
- Abgelaufene Events werden von der Datenbank selbst entfernt (`expires_at`).

---

## Frist ändern

Standard sind 180 Tage. Zum Ändern beide Stellen anpassen und das Schema erneut ausführen:

1. `supabase/schema.sql` → `public._event_ttl()` → `interval '180 days'`
2. `src/registry.js` → `export const RETENTION_DAYS = 180`

Bereits angelegte Events behalten ihr altes `expires_at`; für die gilt die neue Frist erst nach
einem Update, z. B.:

```sql
update public.events set expires_at = created_at + public._event_ttl();
```

---

## Optional: Key nicht ins Repo schreiben

Der `anon` Key ist öffentlich gedacht, deshalb ist das Commit oben unproblematisch. Wenn du ihn
trotzdem nicht im Repo haben willst, kannst du den Pages-Build auf **GitHub Actions** umstellen
und den Key als Repository-Secret einsetzen, das beim Deploy in `src/config.js` geschrieben wird.
Das ist mehr bewegliche Teile im Build — nur machen, wenn du es wirklich brauchst.

---

## Backup

Die Daten sind jederzeit exportierbar: Supabase → **Table Editor** → Tabelle wählen →
**Export → CSV**. Für ein privates Planungstool selten nötig, weil Events ohnehin nach
180 Tagen verschwinden.
