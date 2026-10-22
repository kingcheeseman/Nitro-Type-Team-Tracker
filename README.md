# Nitro Tracker Platform (v0 walking skeleton)

Multi-team Nitro Type tracker. This is Step 1 of the build plan: prove the
app, the database, and the hosting all work together before building any
real features on top.

## What's here right now

- `schema.sql` — the v0 database schema (`teams`, `racers`, `racer_stats`).
- `src/server.js` — a minimal Express app: a health check that proves the
  database connection works, a `/teams` list, and a generic `/teams/:tag`
  page that reads whatever is in the database for that tag.
- No ingestion job yet (that's Step 3) — so `/teams` will legitimately be
  empty until then. That's expected, not a bug.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` with your
   Supabase connection string (Supabase dashboard → Project Settings →
   Database → Connection string → URI).
3. Run the schema against your database once:
   `psql "$DATABASE_URL" -f schema.sql`
   (or paste `schema.sql`'s contents into the Supabase SQL editor)
4. `npm start`
5. Visit `http://localhost:3000` — it should show "It's alive" with the
   current database time. If it shows a database error instead, double
   check `DATABASE_URL`.

## Deploying

Push this repo to GitHub, then connect it to your hosting provider
(Render/Railway/Fly.io) as a Node web service:
- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `DATABASE_URL` (same value as your local `.env`)
