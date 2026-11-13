/**
 * VORLAGE – nicht von der App geladen.
 *
 * Die App liest ausschließlich `src/config.js`. Diese Datei ist nur zum
 * Kopieren da, damit du die Form der Einträge siehst.
 *
 * Vorgehen: die beiden Werte unten in `src/config.js` eintragen.
 * Ausführliche Anleitung inkl. Fehlersuche: SETUP.md
 *
 * Der öffentliche Client-Key heißt je nach Projekt-Alter unterschiedlich:
 *   neues System:  "Publishable key"  -> sb_publishable_…
 *   altes System:  "anon" / "public"  -> eyJhbGciOi…
 * Beide dürfen öffentlich sein; alles, was damit möglich ist, begrenzen die
 * Regeln in supabase/schema.sql. NIEMALS den Secret-Key (`sb_secret_…` bzw.
 * `service_role`) eintragen – der umgeht jede Zugriffsprüfung.
 */
export const config = {
  supabase: {
    // Project Settings -> Data API -> Project URL
    // z. B. 'https://abcdefghijklmnop.supabase.co'
    url: 'https://DEIN-PROJEKT.supabase.co',

    // Project Settings -> API Keys
    // neues System:     "Publishable key"     -> sb_publishable_…
    // älteres System:   "anon" / "public"     -> eyJhbGciOi…
    anonKey: 'sb_publishable_…'
  }
};
