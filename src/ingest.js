// Step 3 of the build plan: pull one team's real data from Nitro Type's
// (unofficial but stable) API and upsert it into the database.
//
// Usage: node src/ingest.js <TEAM_TAG>
//
// Confirmed response shape (captured live from
// https://www.nitrotype.com/api/v2/teams/<tag> on 2026-10-22):
//
//   { "status": "OK", "results": {
//       "info": { "tag": "IMT", "name": "Immortal Legends", "teamID": ..., ... },
//       "members": [
//         { "userID": 142493, "username": "sidoh", "avgSpeed": 87,
//           "highestSpeed": 110, "racesPlayed": 20201, "typed": 494963,
//           "errs": 12385, "status": "active", ... },
//         ...
//       ],
//       "stats": [...], "season": [...], "leaderboard": null
//   } }
//
// We only use info.tag/info.name and the per-member fields above. The API
// has no "accuracy" field, so we derive it from typed/errs.
require("dotenv").config();
const { pool } = require("./db");

const API_BASE = "https://www.nitrotype.com/api/v2/teams/";

// typed/errs -> a 0-100 accuracy percentage, the same shape the schema's
// `accuracy` column expects. Null when there's nothing to divide by yet
// (brand-new racer with zero characters typed).
function computeAccuracy(typed, errs) {
  if (typeof typed !== "number" || typed <= 0) return null;
  const e = typeof errs === "number" ? errs : 0;
  return Math.round(((typed - e) / typed) * 10000) / 100;
}

async function fetchTeam(tag) {
  const url = `${API_BASE}${encodeURIComponent(tag)}`;
  const res = await fetch(url, {
    headers: {
      // Identify ourselves honestly; this is a small hobby project reading
      // the same public team-lookup data the site itself displays.
      "User-Agent": "nitro-type-team-tracker/0.1 (+https://github.com/kingcheeseman/nitro-type-team-tracker)",
    },
  });

  if (!res.ok) {
    throw new Error(`Nitro Type API returned HTTP ${res.status} for tag "${tag}"`);
  }

  const data = await res.json();
  if (data.status !== "OK" || !data.results || !data.results.info) {
    throw new Error(
      `Nitro Type API did not return a valid team for tag "${tag}" (status: ${data.status})`
    );
  }

  return data.results;
}

async function upsertTeam(tag, displayName) {
  await pool.query(
    `insert into teams (tag, display_name, last_synced_at, next_sync_due_at)
     values ($1, $2, now(), now() + interval '30 minutes')
     on conflict (tag) do update
       set display_name = excluded.display_name,
           last_synced_at = now(),
           next_sync_due_at = now() + interval '30 minutes'`,
    [tag, displayName]
  );
}

async function upsertRacer(userId, username, teamTag) {
  await pool.query(
    `insert into racers (nt_user_id, username, team_tag, updated_at)
     values ($1, $2, $3, now())
     on conflict (nt_user_id) do update
       set username = excluded.username,
           team_tag = excluded.team_tag,
           updated_at = now()`,
    [userId, username, teamTag]
  );
}

async function insertRacerStats(userId, { avgSpeed, topSpeed, races, accuracy }) {
  await pool.query(
    `insert into racer_stats (nt_user_id, avg_speed, top_speed, races, accuracy)
     values ($1, $2, $3, $4, $5)`,
    [userId, avgSpeed, topSpeed, races, accuracy]
  );
}

async function ingestTeam(tag) {
  const results = await fetchTeam(tag);
  const { info, members } = results;
  // Prefer the API's own-cased tag (e.g. "IMT") over whatever casing the
  // caller typed, so lookups stay consistent regardless of input casing.
  const normalizedTag = (info.tag || tag).toUpperCase();

  await upsertTeam(normalizedTag, info.name || null);

  let count = 0;
  for (const m of members || []) {
    await upsertRacer(m.userID, m.username, normalizedTag);
    await insertRacerStats(m.userID, {
      avgSpeed: m.avgSpeed ?? null,
      topSpeed: m.highestSpeed ?? null,
      races: m.racesPlayed ?? null,
      accuracy: computeAccuracy(m.typed, m.errs),
    });
    count++;
  }

  return { tag: normalizedTag, displayName: info.name, racerCount: count };
}

async function main() {
  const tag = process.argv[2];
  if (!tag) {
    console.error("Usage: node src/ingest.js <TEAM_TAG>");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await ingestTeam(tag);
    console.log(
      `Synced [${result.tag}] "${result.displayName}" — ${result.racerCount} racer(s).`
    );
  } catch (err) {
    console.error(`Ingestion failed for tag "${tag}": ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { ingestTeam, computeAccuracy, fetchTeam };
