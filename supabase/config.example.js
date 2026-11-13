/**
 * VORLAGE – nicht von der App geladen.
 *
 * Die App liest ausschließlich `src/config.js`. Diese Datei ist nur zum
 * Kopieren da, damit du die Form der Einträge siehst.
 *
 * Vorgehen: die beiden Werte unten in `src/config.js` eintragen.
 * Ausführliche Anleitung inkl. Fehlersuche: SETUP.md
 *
 * Der `anon` / `public` Key ist absichtlich öffentlich: alles, was die App
 * damit tun kann, ist durch die Regeln in supabase/schema.sql begrenzt.
 * NIEMALS den `service_role` Key hier eintragen – der umgeht den Schutz.
 */
export const config = {
  supabase: {
    // z. B. 'https://abcdefghijklmnop.supabase.co'
    url: 'https://DEIN-PROJEKT.supabase.co',

    // Project Settings -> API -> Project API keys -> "anon" / "public"
    // beginnt üblicherweise mit "eyJhbGciOi..."
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…'
  }
};
