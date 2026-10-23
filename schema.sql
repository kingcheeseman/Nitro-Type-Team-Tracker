-- v0 schema: just enough to prove the pipeline end to end.
-- "team" is a parameter everywhere, not a hardcoded value anywhere in this schema.

create table if not exists teams (
  tag              text primary key,
  display_name     text,
  created_at       timestamptz not null default now(), -- when WE started tracking it
  last_synced_at   timestamptz,
  next_sync_due_at timestamptz,
  -- Team-profile fields from Nitro Type's own API (info block), used to
  -- render a roster page structured like the stats-dashboard genre this
  -- project is part of: a hero banner + requirements bar above the table.
  captain_username      text,
  captain_display_name  text,
  members_count         integer,
  nt_created_at          timestamptz, -- the team's own formation date on Nitro Type
  min_races              integer,
  min_speed              integer,
  min_level              integer,
  enrollment             text,
  other_requirements     text,
  -- The team's own color from Nitro Type's API (a hex string with no "#"),
  -- e.g. "5b52a3". Used verbatim as the team's accent everywhere on this
  -- site so there's never any mismatch with the real NT team page -
  -- deliberately not a color we compute ourselves.
  tag_color              text
);

create table if not exists racers (
  nt_user_id   bigint primary key,
  username     text not null,
  team_tag     text references teams(tag) on delete set null,
  updated_at   timestamptz not null default now(),
  -- Current-status fields (not time-series, so they live on the racer row
  -- itself rather than in racer_stats): role/membership/join date change
  -- rarely and we only need the latest value, same as team_tag.
  role         text,
  membership   text,
  joined_at_nt timestamptz,
  -- Nitro Type's API gives each member BOTH a "username" (often an opaque
  -- id-looking string NT assigns internally, e.g. "b9454b42ad92beb74...")
  -- AND a separate "displayName" - the actual name the racer currently
  -- goes by on the site. We show display_name everywhere a human reads a
  -- racer's name, falling back to username only for the rare racer this
  -- tracker hasn't re-synced since this column was added.
  display_name text
);

-- One row per sync per racer: snapshots, not overwrites, so history/charts
-- are available from day one instead of needing a later migration.
create table if not exists racer_stats (
  id          bigserial primary key,
  nt_user_id  bigint not null references racers(nt_user_id) on delete cascade,
  captured_at timestamptz not null default now(),
  avg_speed   numeric,
  top_speed   numeric,
  races       integer,
  accuracy    numeric
);

create index if not exists racer_stats_user_time
  on racer_stats (nt_user_id, captured_at desc);

create index if not exists racers_team
  on racers (team_tag);

-- The leaderboard's real scoring ledger: one row per sync per racer, but
-- ONLY when that sync found new races completed since the previous one
-- (races_delta > 0). Each row's points = (avg_speed/2 + accuracy) at that
-- sync, times races_delta - an approximation of "points per race this
-- interval" using the racer's current cumulative speed/accuracy as the
-- per-race rate, since Nitro Type's API doesn't expose individual races.
-- A racer's first-ever sync writes no row (there's no previous races
-- count to diff against), so points start accumulating from whenever a
-- racer was first added to this tracker - never backfilled from NT's own
-- history, same as racer_stats. team_tag is captured at insert time (not
-- looked up from racers.team_tag) so a later team switch doesn't rewrite
-- history. Summing this table (optionally windowed by captured_at) is
-- what the Hourly/Daily/Weekly/Monthly/All-Time leaderboards are.
create table if not exists racer_points (
  id          bigserial primary key,
  nt_user_id  bigint not null references racers(nt_user_id) on delete cascade,
  team_tag    text references teams(tag) on delete set null,
  captured_at timestamptz not null default now(),
  races_delta integer not null,
  points      numeric not null,
  -- The avg_speed/accuracy this points award was computed from (see
  -- ingest.js's recordRacerPoints). Stored alongside points, not just
  -- baked into it, so a team leaderboard can show an honest races-weighted
  -- average WPM/accuracy for a window instead of just a points total.
  -- Nullable: rows written before this column existed have no value here
  -- (never backfilled) and are simply excluded from that weighted average.
  avg_speed   numeric,
  accuracy    numeric
);

create index if not exists racer_points_user_time
  on racer_points (nt_user_id, captured_at desc);

create index if not exists racer_points_team_time
  on racer_points (team_tag, captured_at desc);

-- Explicit ALTERs (not just CREATE TABLE IF NOT EXISTS) so re-running this
-- file against a database that already has teams/racers from before these
-- columns existed still brings it up to date, instead of silently no-op'ing.
alter table teams add column if not exists captain_username text;
alter table teams add column if not exists captain_display_name text;
alter table teams add column if not exists members_count integer;
alter table teams add column if not exists nt_created_at timestamptz;
alter table teams add column if not exists min_races integer;
alter table teams add column if not exists min_speed integer;
alter table teams add column if not exists min_level integer;
alter table teams add column if not exists enrollment text;
alter table teams add column if not exists other_requirements text;
alter table teams add column if not exists tag_color text;

alter table racers add column if not exists role text;
alter table racers add column if not exists membership text;
alter table racers add column if not exists joined_at_nt timestamptz;
alter table racers add column if not exists display_name text;

alter table racer_points add column if not exists avg_speed numeric;
alter table racer_points add column if not exists accuracy numeric;

-- How often THIS team gets re-synced, independent of every other team - a
-- quiet team that rarely races can be set to 60+ minutes instead of the
-- default 30, so it isn't pulled as often as an active one. Changed with
-- src/set-sync-interval.js, which is never exposed on the live site or any
-- workflow a visitor can trigger - the only way to change it is to ask
-- (same model as data/events.json), which is what keeps this "admin-only"
-- for now without needing to build real authentication.
alter table teams add column if not exists sync_interval_minutes integer not null default 30;

-- Nitro Type's own real season boundary (e.g. "Spirit Racers", Oct 18 -
-- Nov 29) - the exact dates shown in the banner at the top of every NT
-- page. Scraped from NT's public, unauthenticated bootstrap.js asset (see
-- src/season.js), NOT invented by us. One row per season NT has run since
-- we started tracking; the Seasonal leaderboard always uses whichever row
-- has the latest start_stamp.
create table if not exists seasons (
  season_id   bigint primary key,
  name        text not null,
  start_stamp timestamptz not null,
  end_stamp   timestamptz not null,
  synced_at   timestamptz not null default now()
);

-- Auto-detected team events: new members, and lifetime/team race
-- milestones, written by src/ingest.js (see src/notifications.js) by
-- diffing each sync's fresh numbers against the racer's previous sync -
-- never user-entered, never backfilled from before a racer/team was first
-- tracked. `dedup_key` + the unique constraint below is what makes an
-- event fire exactly once (e.g. "this racer crossed 5,000 races for this
-- team") even though ingest re-runs every sync.
create table if not exists notifications (
  id          bigserial primary key,
  team_tag    text not null references teams(tag) on delete cascade,
  kind        text not null, -- 'new_member' | 'lifetime_milestone' | 'team_milestone'
  nt_user_id  bigint references racers(nt_user_id) on delete set null,
  dedup_key   text not null,
  headline    text not null,
  created_at  timestamptz not null default now(),
  unique (team_tag, dedup_key)
);

create index if not exists notifications_team_time
  on notifications (team_tag, created_at desc);

-- Racer accounts: lets a visitor connect their TypeTrack login (Supabase
-- Auth - email/password, never their real Nitro Type password) to a real
-- Nitro Type identity they've PROVEN they own, so the site can tell real
-- captains apart from anyone claiming to be one. Everything below this
-- point is written/read by the browser directly via Supabase's client
-- libraries (using the public anon key) rather than through our own
-- service-role scripts, so Row Level Security is what keeps a signed-in
-- racer from touching another team's events - see the policies at the
-- bottom of this file.

-- NT's own authoritative captain, by userID (not the display-name text
-- already on this row) - this is what a captain's permission check is
-- actually anchored to. Populated straight from the team API's
-- info.userID (src/ingest.js's upsertTeam), never guessed from a name.
alter table teams add column if not exists captain_nt_user_id bigint;

-- One-to-one link between a Supabase Auth user and the Nitro Type racer
-- they've verified ownership of (see verification_challenges below). A
-- racer can only ever be linked to one TypeTrack account and vice versa.
create table if not exists account_links (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  nt_user_id   bigint not null unique references racers(nt_user_id) on delete cascade,
  verified_at  timestamptz not null default now()
);

-- An in-progress "change your car to prove you own this account" check.
-- One row per signed-in user (starting a new check replaces any old one).
-- baseline_car_id is read live from Nitro Type at the moment the check
-- starts; the Edge Function that confirms it re-reads live too, so this
-- never trusts our own batch-synced (and possibly stale) racer_stats.
create table if not exists verification_challenges (
  auth_user_id    uuid primary key references auth.users(id) on delete cascade,
  nt_user_id      bigint not null,
  nt_username     text not null,
  baseline_car_id integer not null,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
);

-- Team events - same purpose as the old data/events.json, but writable by
-- a verified team captain directly from their team's Events page instead
-- of being a file only changed by hand. Deliberately one team per event
-- (not the old file's array-of-teams), since the RLS policy below checks
-- a captain against exactly one team_tag; an event spanning several
-- allied teams would need one row per team.
create table if not exists events (
  id          bigserial primary key,
  team_tag    text not null references teams(tag) on delete cascade,
  title       text not null,
  description text,
  start_stamp timestamptz not null,
  end_stamp   timestamptz not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists events_team_time on events (team_tag, start_stamp desc);

alter table account_links enable row level security;
alter table verification_challenges enable row level security;
alter table events enable row level security;

-- account_links: a racer's verified-or-not status is harmless to show
-- publicly (just "this racer owns this TypeTrack account"), so reads are
-- open. Deliberately NO insert/update/delete policy for any client role:
-- letting a signed-in user write their own auth_user_id here would still
-- let them pair it with ANY nt_user_id and falsely claim to be a racer
-- they never actually verified - the whole point of the car-swap check.
-- The only thing allowed to write this table is the verify-car-swap Edge
-- Function, using Supabase's service-role key (which bypasses RLS
-- entirely, by design - it's the trusted server-side half of this flow).
-- With RLS on and no write policy, every client-side write is denied.
drop policy if exists "account_links are publicly readable" on account_links;
create policy "account_links are publicly readable" on account_links
  for select using (true);

-- verification_challenges: not even publicly readable, and - like
-- account_links above - never written by the client directly. The
-- verify-car-swap Edge Function owns this table completely (via the
-- service-role key): it creates the challenge when a check starts and
-- deletes it once confirmed, and returns the challenge's state straight
-- in its own response rather than making the browser query this table.
-- With RLS on and no policies at all, this table is fully inaccessible
-- to the client - exactly what we want for in-progress verification state.

-- events: anyone can read (it's a public site); writes are restricted to
-- a signed-in user who is BOTH verified as a specific racer (via
-- account_links) AND that racer is the captain NT itself recognizes for
-- the team_tag being written - so a captain can only ever manage events
-- for their own team, never someone else's.
drop policy if exists "events are publicly readable" on events;
create policy "events are publicly readable" on events
  for select using (true);

drop policy if exists "only a team's own verified captain manages its events" on events;
create policy "only a team's own verified captain manages its events" on events
  for all
  using (
    exists (
      select 1
      from account_links al
      join teams t on t.tag = events.team_tag
      where al.auth_user_id = auth.uid()
        and al.nt_user_id = t.captain_nt_user_id
    )
  )
  with check (
    exists (
      select 1
      from account_links al
      join teams t on t.tag = events.team_tag
      where al.auth_user_id = auth.uid()
        and al.nt_user_id = t.captain_nt_user_id
    )
  );
