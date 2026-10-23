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
