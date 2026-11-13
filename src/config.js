/**
 * Backend-Konfiguration – die einzige Datei, die du für den Online-Betrieb
 * anpassen musst.
 *
 * LEER LASSEN  -> Demo-Modus: alle Daten liegen nur im localStorage dieses
 *                 Browsers. Gut zum Ausprobieren, aber Teilnehmer sehen sich
 *                 gegenseitig NICHT.
 *
 * AUSFÜLLEN     -> echte Datenbank über Supabase. Sobald beide Werte gesetzt
 *                 sind, schaltet die App automatisch um.
 *
 * Schritt-für-Schritt-Anleitung inkl. Fehlersuche: ../SETUP.md
 * Vorlage mit Beispielwerten: ../supabase/config.example.js
 *
 * Der `anon` / `public` Key ist öffentlich und darf im Repo stehen – der
 * Schutz kommt aus den RLS-Regeln in supabase/schema.sql. Den `service_role`
 * Key niemals hier eintragen.
 */
export const config = {
  supabase: {
    // z. B. 'https://abcdefghijklmnop.supabase.co'
    url: '',

    // Project Settings -> API -> Project API keys -> "anon" / "public"
    anonKey: ''
  }
};
