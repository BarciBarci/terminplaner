-- ============================================================
--  Terminplaner – Supabase Schema
--  Einmal komplett im Supabase "SQL Editor" ausführen.
--  Idempotent: mehrfaches Ausführen ist unschädlich.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Aufbewahrung
-- Events verschwinden NACH ABLAUF_TAGE Tagen automatisch.
-- Zum Ändern: nur die Zahl unten anpassen und das Skript erneut
-- ausführen (gilt für bestehende Events erst nach dem Update
-- ihres expires_at).
-- ------------------------------------------------------------

create or replace function public._event_ttl()
returns interval
language sql
immutable
as $$ select interval '180 days' $$;

-- ------------------------------------------------------------
-- Tabellen
-- ------------------------------------------------------------

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  admin_token text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + public._event_ttl())
);

-- Migration für bestehende Installationen
alter table public.events
  add column if not exists expires_at timestamptz not null
  default (now() + public._event_ttl());

create table if not exists public.event_days (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  day        date not null,
  start_time time not null,
  end_time   time not null,
  position   int  not null default 0,
  check (start_time < end_time)
);

create table if not exists public.participants (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  token      text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.availability (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  day_id         uuid not null references public.event_days(id) on delete cascade,
  start_time     time not null,
  end_time       time not null,
  check (start_time < end_time)
);

create index if not exists event_days_event_idx    on public.event_days(event_id);
create index if not exists participants_event_idx  on public.participants(event_id);
create index if not exists availability_member_idx on public.availability(participant_id);
create index if not exists availability_day_idx    on public.availability(day_id);
create index if not exists events_expires_idx      on public.events(expires_at);

-- ------------------------------------------------------------
-- Zugriffsschutz
-- RLS aktiv, aber ohne Policies -> direkter Tabellenzugriff ist
-- für anon/authenticated komplett gesperrt. Alles läuft über die
-- SECURITY DEFINER Funktionen weiter unten.
-- ------------------------------------------------------------

alter table public.events       enable row level security;
alter table public.event_days   enable row level security;
alter table public.participants enable row level security;
alter table public.availability enable row level security;

revoke all on public.events       from anon, authenticated;
revoke all on public.event_days   from anon, authenticated;
revoke all on public.participants from anon, authenticated;
revoke all on public.availability from anon, authenticated;

-- ------------------------------------------------------------
-- Interne Helfer (nicht von außen aufrufbar)
-- ------------------------------------------------------------

create or replace function public._new_token()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text, '-', '')
$$;

-- Räumt abgelaufene Events samt Anhang auf. Wird bei jedem
-- Anlegen eines Events mit ausgeführt, damit kein Cronjob nötig ist.
create or replace function public._prune_expired()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.events where expires_at <= now()
$$;

-- Admin-Token -> Event, mit Ablaufprüfung.
create or replace function public._event_by_admin(p_token text)
returns public.events
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where admin_token = p_token;
  if v_event.id is null then
    raise exception 'invalid_token';
  end if;
  if v_event.expires_at <= now() then
    raise exception 'expired';
  end if;
  return v_event;
end;
$$;

-- Teilnehmer-Token -> Teilnehmer, mit Ablaufprüfung des Events.
create or replace function public._participant_by_token(p_token text)
returns public.participants
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me      public.participants;
  v_expires timestamptz;
begin
  select * into v_me from public.participants where token = p_token;
  if v_me.id is null then
    raise exception 'invalid_token';
  end if;

  select expires_at into v_expires from public.events where id = v_me.event_id;
  if v_expires is null or v_expires <= now() then
    raise exception 'expired';
  end if;

  return v_me;
end;
$$;

-- Liefert die komplette Sicht auf ein Event als JSON.
-- p_with_tokens = true  -> Admin (inkl. Teilnehmer-Tokens)
-- p_with_tokens = false -> Teilnehmer
create or replace function public._event_json(p_event_id uuid, p_with_tokens boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'event', jsonb_build_object(
      'id',         e.id,
      'name',       e.name,
      'created_at', e.created_at,
      'expires_at', e.expires_at
    ),

    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',    d.id,
               'date',  to_char(d.day, 'YYYY-MM-DD'),
               'start', to_char(d.start_time, 'HH24:MI'),
               'end',   to_char(d.end_time, 'HH24:MI')
             ) order by d.day, d.position)
      from public.event_days d
      where d.event_id = e.id
    ), '[]'::jsonb),

    'participants', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', p.id, 'name', p.name)
               || case when p_with_tokens
                       then jsonb_build_object('token', p.token)
                       else '{}'::jsonb
                  end
             order by p.created_at, p.name)
      from public.participants p
      where p.event_id = e.id
    ), '[]'::jsonb),

    'availability', coalesce((
      select jsonb_agg(jsonb_build_object(
               'participant_id', a.participant_id,
               'day_id',         a.day_id,
               'start',          to_char(a.start_time, 'HH24:MI'),
               'end',            to_char(a.end_time, 'HH24:MI')
             ) order by a.start_time)
      from public.availability a
      join public.participants p2 on p2.id = a.participant_id
      where p2.event_id = e.id
    ), '[]'::jsonb)
  )
  from public.events e
  where e.id = p_event_id
$$;

-- Schreibt die Tagesliste neu. Übergebene "id" bleibt erhalten, damit
-- bestehende Einträge der Teilnehmer nicht verloren gehen.
create or replace function public._write_days(p_event_id uuid, p_days jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day   jsonb;
  v_idx   int := 0;
  v_id    uuid;
  v_keep  uuid[] := array[]::uuid[];
  v_date  date;
  v_start time;
  v_end   time;
begin
  if p_days is null
     or jsonb_typeof(p_days) <> 'array'
     or jsonb_array_length(p_days) = 0 then
    raise exception 'invalid_days';
  end if;

  for v_day in select value from jsonb_array_elements(p_days) loop
    v_date  := (v_day->>'date')::date;
    v_start := (v_day->>'start')::time;
    v_end   := (v_day->>'end')::time;

    if v_date is null or v_start is null or v_end is null or v_start >= v_end then
      raise exception 'invalid_days';
    end if;

    v_id := null;
    if v_day ? 'id' then
      begin
        select id into v_id
          from public.event_days
         where id = (v_day->>'id')::uuid
           and event_id = p_event_id;
      exception when others then
        v_id := null;
      end;
    end if;

    if v_id is null then
      insert into public.event_days(event_id, day, start_time, end_time, position)
      values (p_event_id, v_date, v_start, v_end, v_idx)
      returning id into v_id;
    else
      update public.event_days
         set day        = v_date,
             start_time = v_start,
             end_time   = v_end,
             position   = v_idx
       where id = v_id;
    end if;

    v_keep := v_keep || v_id;
    v_idx  := v_idx + 1;
  end loop;

  delete from public.event_days
   where event_id = p_event_id
     and not (id = any (v_keep));
end;
$$;

-- ------------------------------------------------------------
-- Öffentliche RPCs
-- ------------------------------------------------------------

-- Event anlegen. Gibt { event_id, admin_token, expires_at } zurück.
create or replace function public.app_create_event(p_name text, p_days jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_admin    text := public._new_token();
  v_expires  timestamptz;
begin
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'invalid_name';
  end if;

  -- Nebenbei abgelaufene Events entsorgen.
  perform public._prune_expired();

  insert into public.events(name, admin_token, expires_at)
  values (btrim(p_name), v_admin, now() + public._event_ttl())
  returning id, expires_at into v_event_id, v_expires;

  perform public._write_days(v_event_id, p_days);

  return jsonb_build_object(
    'event_id',    v_event_id,
    'admin_token', v_admin,
    'expires_at',  v_expires
  );
end;
$$;

-- Admin: alles laden.
create or replace function public.app_admin_load(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.events;
begin
  v_event := public._event_by_admin(p_token);
  return public._event_json(v_event.id, true);
end;
$$;

-- Admin: Name und Tage ändern.
create or replace function public.app_admin_update_event(p_token text, p_name text, p_days jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
begin
  v_event := public._event_by_admin(p_token);

  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'invalid_name';
  end if;

  update public.events set name = btrim(p_name) where id = v_event.id;
  perform public._write_days(v_event.id, p_days);

  return public._event_json(v_event.id, true);
end;
$$;

-- Admin: Benutzer anlegen.
create or replace function public.app_admin_add_participant(p_token text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_name  text := btrim(coalesce(p_name, ''));
begin
  v_event := public._event_by_admin(p_token);

  if char_length(v_name) = 0 then
    raise exception 'invalid_name';
  end if;
  if exists (
    select 1 from public.participants
     where event_id = v_event.id
       and lower(name) = lower(v_name)
  ) then
    raise exception 'duplicate_name';
  end if;

  insert into public.participants(event_id, name, token)
  values (v_event.id, v_name, public._new_token());

  return public._event_json(v_event.id, true);
end;
$$;

-- Admin: Benutzer entfernen (inkl. seiner Einträge via ON DELETE CASCADE).
create or replace function public.app_admin_remove_participant(p_token text, p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
begin
  v_event := public._event_by_admin(p_token);

  delete from public.participants
   where id = p_participant_id
     and event_id = v_event.id;

  return public._event_json(v_event.id, true);
end;
$$;

-- Admin: Event sofort löschen (Tage, Benutzer und Einträge via CASCADE).
create or replace function public.app_admin_delete_event(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
begin
  v_event := public._event_by_admin(p_token);

  delete from public.events where id = v_event.id;

  return jsonb_build_object('deleted', true);
end;
$$;

-- Teilnehmer: alles laden (ohne fremde Tokens).
create or replace function public.app_participant_load(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me public.participants;
begin
  v_me := public._participant_by_token(p_token);

  return public._event_json(v_me.event_id, false)
         || jsonb_build_object('me', jsonb_build_object('id', v_me.id, 'name', v_me.name));
end;
$$;

-- Teilnehmer: eigene Zeiträume für EINEN Tag ersetzen.
-- p_ranges = [{"start":"10:00","end":"12:00"}, ...]
create or replace function public.app_set_availability(p_token text, p_day_id uuid, p_ranges jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    public.participants;
  v_day   public.event_days;
  v_item  jsonb;
  v_start time;
  v_end   time;
  v_clean jsonb := '[]'::jsonb;
begin
  v_me := public._participant_by_token(p_token);

  select * into v_day
    from public.event_days
   where id = p_day_id
     and event_id = v_me.event_id;
  if v_day.id is null then
    raise exception 'invalid_token';
  end if;

  if p_ranges is null or jsonb_typeof(p_ranges) <> 'array' then
    raise exception 'invalid_range';
  end if;

  -- Erst vollständig prüfen, dann schreiben.
  for v_item in select value from jsonb_array_elements(p_ranges) loop
    v_start := (v_item->>'start')::time;
    v_end   := (v_item->>'end')::time;

    if v_start is null or v_end is null
       or v_start >= v_end
       or v_start < v_day.start_time
       or v_end   > v_day.end_time then
      raise exception 'invalid_range';
    end if;

    v_clean := v_clean || jsonb_build_object('start', v_start, 'end', v_end);
  end loop;

  delete from public.availability
   where participant_id = v_me.id
     and day_id = p_day_id;

  insert into public.availability(participant_id, day_id, start_time, end_time)
  select v_me.id, p_day_id, (item->>'start')::time, (item->>'end')::time
    from jsonb_array_elements(v_clean) as item;

  return public._event_json(v_me.event_id, false)
         || jsonb_build_object('me', jsonb_build_object('id', v_me.id, 'name', v_me.name));
end;
$$;

-- ------------------------------------------------------------
-- Rechte
-- ------------------------------------------------------------

revoke all on function public._new_token() from public, anon, authenticated;
revoke all on function public._prune_expired() from public, anon, authenticated;
revoke all on function public._event_by_admin(text) from public, anon, authenticated;
revoke all on function public._participant_by_token(text) from public, anon, authenticated;
revoke all on function public._event_json(uuid, boolean) from public, anon, authenticated;
revoke all on function public._write_days(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.app_create_event(text, jsonb) to anon, authenticated;
grant execute on function public.app_admin_load(text) to anon, authenticated;
grant execute on function public.app_admin_update_event(text, text, jsonb) to anon, authenticated;
grant execute on function public.app_admin_add_participant(text, text) to anon, authenticated;
grant execute on function public.app_admin_remove_participant(text, uuid) to anon, authenticated;
grant execute on function public.app_admin_delete_event(text) to anon, authenticated;
grant execute on function public.app_participant_load(text) to anon, authenticated;
grant execute on function public.app_set_availability(text, uuid, jsonb) to anon, authenticated;
