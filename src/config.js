/**
 * Backend-Konfiguration.
 *
 * Hier ist Supabase aktiv – die App speichert in der echten Datenbank,
 * Teilnehmer sehen sich also gegenseitig.
 *
 * Der Publishable Key ist öffentlich gedacht und darf im Repo stehen:
 * alles, was damit möglich ist, begrenzen die Regeln in supabase/schema.sql.
 * NIEMALS den Secret-Key (`sb_secret_…` / `service_role`) hier eintragen.
 *
 * Anleitung inkl. Fehlersuche: ../SETUP.md
 * Vorlage: ../supabase/config.example.js
 */
export const config = {
  supabase: {
    url: 'https://leprhzdisuycbrwonxkg.supabase.co',
    anonKey: 'sb_publishable_WZ6mfAR7CIZeUqqC68kVpQ_fs_SIBor'
  }
};
