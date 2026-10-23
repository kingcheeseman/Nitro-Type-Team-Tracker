// Step N: the scheduled entry point. Instead of a fixed list of teams on a
// fixed cadence, this asks the database which teams are actually due (per
// their own teams.sync_interval_minutes, see schema.sql) and only syncs
// those - so a quiet team set to sync every 60 minutes doesn't get pulled
// every 10 just because an active one needs it. Meant to be run frequently
// (see .github/workflows/sync.yml) and be a no-op most of the time for any
// given team.
require("dotenv").config();
const { pool } = require("./db");
const { ingestTeam } = require("./ingest");

async function dueTeams() {
  const { rows } = await pool.query(
    `select tag from teams where next_sync_due_at is null or next_sync_due_at <= now() order by tag`
  );
  return rows.map((r) => r.tag);
}

async function main() {
  const tags = await dueTeams();
  if (tags.length === 0) {
    console.log("No teams due for sync.");
    await pool.end();
    return;
  }

  let status = 0;
  for (const tag of tags) {
    try {
      const result = await ingestTeam(tag);
      console.log(
        `Synced [${result.tag}] "${result.displayName}" — ${result.racerCount} racer(s).`
      );
    } catch (err) {
      console.error(`Ingestion failed for tag "${tag}": ${err.message}`);
      status = 1;
    }
  }

  await pool.end();
  process.exitCode = status;
}

if (require.main === module) {
  main();
}

module.exports = { dueTeams };
