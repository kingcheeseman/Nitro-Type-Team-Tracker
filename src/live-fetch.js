// Runs ONLY inside .github/workflows/live-fetch.yml, dispatched on demand
// by the verify-car-swap Edge Function. See schema.sql's comment above
// live_fetch_requests for why this exists: Nitro Type's API blocks
// requests from Supabase's network, so the live read for car-swap
// verification happens here instead, on the same GitHub Actions network
// src/ingest.js's scheduled sync already uses successfully.
//
// Usage: node src/live-fetch.js <request_id> <team_tag>
//
// Writes exactly one row into live_fetch_requests (members on success,
// error on failure) and exits. Never throws past its own try/catch - a
// failed fetch is a normal outcome the Edge Function needs to see, not a
// reason to fail this workflow run.
require("dotenv").config();
const { pool } = require("./db");
const { fetchTeam } = require("./ingest");

async function main() {
  const [, , requestId, teamTag] = process.argv;
  if (!requestId || !teamTag) {
    console.error("Usage: node src/live-fetch.js <request_id> <team_tag>");
    process.exit(1);
  }

  let members = null;
  let error = null;
  try {
    const results = await fetchTeam(teamTag);
    members = results.members || [];
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }

  await pool.query(
    `insert into live_fetch_requests (request_id, team_tag, members, error, completed_at)
     values ($1, $2, $3, $4, now())
     on conflict (request_id) do update
       set members = excluded.members,
           error = excluded.error,
           completed_at = excluded.completed_at`,
    [requestId, teamTag, members ? JSON.stringify(members) : null, error]
  );

  // Opportunistic cleanup - sweep anything stale left behind by a request
  // the Edge Function already gave up waiting on.
  await pool.query(
    `delete from live_fetch_requests where requested_at < now() - interval '1 hour'`
  );

  await pool.end();

  if (error) {
    console.error(`fetchTeam(${teamTag}) failed: ${error}`);
    // Exit 0 anyway - the failure is recorded in the row, which is the
    // actual contract with the Edge Function; a nonzero exit here would
    // just make the Actions run look red for an outcome that's expected
    // and already handled.
  } else {
    console.log(`Wrote ${members.length} member(s) for ${teamTag} (request ${requestId})`);
  }
}

main().catch((err) => {
  console.error("live-fetch.js crashed:", err);
  process.exit(1);
});
