/**
 * Backend-Konfiguration.
 *
 * LEER LASSEN  -> Demo-Modus: alle Daten liegen nur im localStorage des
 *                 jeweiligen Browsers. Gut zum Ausprobieren, aber Teilnehmer
 *                 sehen sich gegenseitig NICHT.
 *
 * AUSFÜLLEN     -> echte Datenbank über Supabase (siehe README.md, Schritt 3).
 *                 Sobald beide Werte gesetzt sind, schaltet die App automatisch
 *                 um. Der anon key ist öffentlich und darf im Repo stehen --
 *                 der Schutz kommt aus den RLS-Regeln in supabase/schema.sql.
 */
export const config = {
  supabase: {
    url: '', // z. B. 'https://abcdefghijkl.supabase.co'
    anonKey: '' // der "anon / public" Key aus Project Settings -> API
  }
};
