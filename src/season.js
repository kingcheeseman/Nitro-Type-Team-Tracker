// Scrapes Nitro Type's own real, currently-active season (name + exact
// start/end dates) - the same "Oct 18 - Nov 29" banner shown at the top of
// every nitrotype.com page. Not from a documented API: NT renders that
// banner client-side from `window.NTGLOBALS.ACTIVE_SEASONS`, which is
// baked as literal JSON into a `bootstrap.js` asset referenced from the
// page's own <script> tag. Confirmed live (2026-10-23) that both the
// homepage HTML and that script are public and unauthenticated - no
// session/cookie needed for either fetch.
//
// This is why "Seasonal" can be a real, honest boundary instead of a
// rolling window we invented: it's the literal date range Nitro Type
// itself is showing every player right now.
require("dotenv").config();
const { pool } = require("./db");

const HOMEPAGE = "https://www.nitrotype.com/";
const USER_AGENT = "nitro-type-team-tracker/0.1 (+https://github.com/kingcheeseman/nitro-type-team-tracker)";

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`GET ${url} returned HTTP ${res.status}`);
  }
  return res.text();
}

// Reads the current active season straight off nitrotype.com. Returns
// null if NT is reporting no active season right now (ACTIVE_SEASONS: []),
// which does happen between seasons.
async function fetchActiveSeason() {
  const html = await fetchText(HOMEPAGE);
  // The bootstrap script's path includes a content hash that changes on
  // every NT frontend deploy, so it has to be read fresh from the page
  // each time rather than hardcoded.
  const scriptMatch = html.match(/src="(\/index\/[a-f0-9]+-\d+\/bootstrap\.js)"/);
  if (!scriptMatch) {
    throw new Error("Could not find a bootstrap.js reference on the Nitro Type homepage - page structure may have changed.");
  }

  const bootstrapJs = await fetchText(`https://www.nitrotype.com${scriptMatch[1]}`);
  const seasonsMatch = bootstrapJs.match(/\["ACTIVE_SEASONS",(\[.*?\])\],\["ACTIVE_EVENTS"/);
  if (!seasonsMatch) {
    throw new Error("Could not find ACTIVE_SEASONS in Nitro Type's bootstrap.js - its data format may have changed.");
  }

  const seasons = JSON.parse(seasonsMatch[1]);
  if (!seasons.length) return null;
  // NT has only ever shown one concurrent season in practice; if that
  // ever changes, treat whichever one started most recently as current.
  return seasons.reduce((latest, s) => (s.startStamp > latest.startStamp ? s : latest));
}

async function syncActiveSeason() {
  const season = await fetchActiveSeason();
  if (!season) {
    console.log("Nitro Type is reporting no active season right now - leaving the seasons table as-is.");
    return null;
  }
  await pool.query(
    `insert into seasons (season_id, name, start_stamp, end_stamp)
     values ($1, $2, to_timestamp($3), to_timestamp($4))
     on conflict (season_id) do update
       set name = excluded.name,
           start_stamp = excluded.start_stamp,
           end_stamp = excluded.end_stamp,
           synced_at = now()`,
    [season.seasonID, season.name, season.startStamp, season.endStamp]
  );
  return season;
}

async function main() {
  try {
    const season = await syncActiveSeason();
    if (season) {
      console.log(
        `Synced season #${season.seasonID} "${season.name}" ` +
          `(${new Date(season.startStamp * 1000).toISOString()} - ${new Date(season.endStamp * 1000).toISOString()})`
      );
    }
  } catch (err) {
    console.error(`Season sync failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { fetchActiveSeason, syncActiveSeason };
