-- v0 schema: just enough to prove the pipeline end to end.
-- "team" is a parameter everywhere, not a hardcoded value anywhere in this schema.

create table if not exists teams (
  tag             text primary key,
  display_name    text,
  created_at      timestamptz not null default now(),
  last_synced_at  timestamptz,
  next_sync_due_at timestamptz
);

create table if not exists racers (
  nt_user_id   bigint primary key,
  username     text not null,
  team_tag     text references teams(tag) on delete set null,
  updated_at   timestamptz not null default now()
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
