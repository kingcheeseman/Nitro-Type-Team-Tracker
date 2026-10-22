# Nitro Tracker Platform (v0 walking skeleton)

Multi-team Nitro Type tracker. This is Step 1 of the build plan: prove the
database and the deploy pipeline work together before building any real
features on top.

## How it's hosted

No always-on server. `src/build.js` queries Supabase once and writes plain
HTML into `site/`, which a scheduled GitHub Action commits and GitHub Pages
publishes — the same free, no-card model this account's single-team tracker
already runs on. `src/server.js` still exists for local preview only; it's
not what's deployed.

## What's here right now

- `schema.sql` — the v0 database schema (`teams`, `racers`, `racer_stats`).
- `src/build.js` — the static site generator: a teams index page, plus one
  generic `teams/<tag>/` page per team, built from whatever's in the database.
- `src/server.js` — optional local-only version of the same thing, served
  live instead of pre-built, for quick iteration without waiting on a workflow run.
- `.github/workflows/build.yml` — runs `build.js` on a schedule (and on
  demand) and commits the output to `site/`.
- `.github/workflows/pages.yml` — publishes `site/` to GitHub Pages whenever
  it changes.
- No ingestion job yet (that's Step 3) — so the site will legitimately show
  "no teams yet" until then. That's expected, not a bug.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` with your
   Supabase connection string (Supabase dashboard → Project Settings →
   Database → Connection string → URI).
3. Run the schema against your database once:
   `psql "$DATABASE_URL" -f schema.sql`
   (or paste `schema.sql`'s contents into the Supabase SQL editor)
4. `npm run build` — writes static pages into `site/` you can open directly,
   or `npm start` to serve the live version at `http://localhost:3000`.

## Deploying

Nothing to configure beyond one GitHub Actions secret:

- Repo Settings → Secrets and variables → Actions → add `DATABASE_URL`
  with the same value as your local `.env`.
- Repo Settings → Pages → Build and deployment → Source: **GitHub Actions**.

From there, the `Build site` workflow regenerates `site/` on a schedule and
the `Deploy to GitHub Pages` workflow publishes it automatically.
