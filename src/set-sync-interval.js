// Sets how often ONE team gets re-synced (src/sync-due.js reads this back
// every run). Deliberately not wired into any workflow a visitor can
// trigger, any route on the live site, or anything editable without repo/DB
// access - same "ask and it'll be changed" model as data/events.json. That's
// what makes this admin-only for now without building real authentication;
// a real "only my account" control (e.g. gated behind the site's own login)
// is future work for the Team Admin page, not this script.
//
// Usage: node src/set-sync-interval.js <TEAM_TAG> <MINUTES>
require("dotenv").config();
const { pool } = require("./db");

async function setSyncInterval(tag, minutes) {
  const { rowCount } = await pool.query(
    `update teams
       set sync_interval_minutes = $2::integer,
           next_sync_due_at = now() + ($2::text || ' minutes')::interval
     where tag = $1`,
    [tag.toUpperCase(), minutes]
  );
  return rowCount > 0;
}

async function main() {
  const tag = process.argv[2];
  const minutes = parseInt(process.argv[3], 10);

  if (!tag || !Number.isFinite(minutes) || minutes <= 0) {
    console.error("Usage: node src/set-sync-interval.js <TEAM_TAG> <MINUTES>");
    process.exitCode = 1;
    return;
  }

  try {
    const found = await setSyncInterval(tag, minutes);
    if (!found) {
      console.error(`No team found with tag "${tag.toUpperCase()}"`);
      process.exitCode = 1;
    } else {
      console.log(`[${tag.toUpperCase()}] now syncs every ${minutes} minute(s).`);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { setSyncInterval };
