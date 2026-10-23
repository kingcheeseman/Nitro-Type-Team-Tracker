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
  joined_at_nt timestamptz
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
