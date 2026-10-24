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
//           "errs": 12385, "status": "active", "carID": 344,
//           "carHueAngle": 0, ... },
//         ...
//       ],
//       "stats": [...], "season": [...], "leaderboard": null
//   } }
//
// We only use info.tag/info.name and the per-member fields above. The API
// has no "accuracy" field, so we derive it from typed/errs. carID/carHueAngle
// identify the racer's currently-equipped car (see car-catalog.js/theme.js's
// carImageUrl for how these become an actual thumbnail image).
require("dotenv").config();
const { pool } = require("./db");
const { fetchPreviousTeamTag, recordNotifications } = require("./notifications");

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

// unix seconds (as the API gives createdStamp/joinStamp) -> a timestamptz
// pg is happy with, or null if there's nothing to convert.
function fromUnixSeconds(stamp) {
  if (typeof stamp !== "number" || stamp <= 0) return null;
  return new Date(stamp * 1000).toISOString();
}

async function upsertTeam(tag, info) {
  // next_sync_due_at uses THIS team's own sync_interval_minutes, not a fixed
  // 30 minutes - a brand-new team gets the column's default (30) since it's
  // omitted from the insert list below; an existing team's admin-set value
  // (never touched by this upsert) is read back via `teams.sync_interval_minutes`,
  // which in an ON CONFLICT DO UPDATE refers to the row as it stood BEFORE
  // this update - so a sync can never reset an interval someone configured.
  await pool.query(
    `insert into teams (
       tag, display_name, last_synced_at, next_sync_due_at,
       captain_username, captain_display_name, captain_nt_user_id, members_count, nt_created_at,
       min_races, min_speed, min_level, enrollment, other_requirements, tag_color
     )
     values ($1, $2, now(), now() + interval '30 minutes', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (tag) do update
       set display_name = excluded.display_name,
           last_synced_at = now(),
           next_sync_due_at = now() + (teams.sync_interval_minutes || ' minutes')::interval,
           captain_username = excluded.captain_username,
           captain_display_name = excluded.captain_display_name,
           captain_nt_user_id = excluded.captain_nt_user_id,
           members_count = excluded.members_count,
           nt_created_at = excluded.nt_created_at,
           min_races = excluded.min_races,
           min_speed = excluded.min_speed,
           min_level = excluded.min_level,
           enrollment = excluded.enrollment,
           other_requirements = excluded.other_requirements,
           tag_color = excluded.tag_color`,
    [
      tag,
      info.name || null,
      info.username || null,
      info.displayName || null,
      // NT's team-info block identifies the captain by their userID
      // directly (the same id that shows up in results.members) - this is
      // the authoritative "who is captain" check everything else (event
      // permissions) is built on, not the display name above.
      info.userID ?? null,
      info.members ?? null,
      fromUnixSeconds(info.createdStamp),
      info.minRaces ?? null,
      info.minSpeed ?? null,
      info.minLevel ?? null,
      info.enrollment || null,
      info.otherRequirements || null,
      info.tagColor || null,
    ]
  );
}

async function upsertRacer(member, teamTag) {
  await pool.query(
    `insert into racers (nt_user_id, username, team_tag, updated_at, role, membership, joined_at_nt, display_name, car_id, car_hue_angle)
     values ($1, $2, $3, now(), $4, $5, $6, $7, $8, $9)
     on conflict (nt_user_id) do update
       set username = excluded.username,
           team_tag = excluded.team_tag,
           updated_at = now(),
           role = excluded.role,
           membership = excluded.membership,
           joined_at_nt = excluded.joined_at_nt,
           display_name = excluded.display_name,
           car_id = excluded.car_id,
           car_hue_angle = excluded.car_hue_angle`,
    [
      member.userID,
      member.username,
      teamTag,
      member.role || null,
      member.membership || null,
      fromUnixSeconds(member.joinStamp),
      // The API's "username" is often an opaque id-looking string, not
      // what the racer actually goes by - "displayName" is their real
      // current name. Fall back to username only if displayName is ever
      // missing, so the column is never left null outright.
      member.displayName || member.username || null,
      member.carID ?? null,
      member.carHueAngle ?? null,
    ]
  );
}

async function insertRacerStats(userId, { avgSpeed, topSpeed, races, accuracy }) {
  await pool.query(
    `insert into racer_stats (nt_user_id, avg_speed, top_speed, races, accuracy)
     values ($1, $2, $3, $4, $5)`,
    [userId, avgSpeed, topSpeed, races, accuracy]
  );
}

// The racesPlayed figure from the racer's PREVIOUS sync (null if this is
// their first-ever sync) - the baseline recordRacerPoints diffs against.
async function fetchPreviousRaces(userId) {
  const { rows } = await pool.query(
    `select races from racer_stats where nt_user_id = $1 order by captured_at desc limit 1`,
    [userId]
  );
  return rows[0] ? rows[0].races : null;
}

// Awards points for races completed since the racer's last sync: races
// completed * (avg_speed/2 + accuracy), using this sync's cumulative
// avg_speed/accuracy as an approximation of the per-race rate over that
// interval (NT's API doesn't expose individual races to compute this
// exactly). Writes nothing on a racer's first sync (no baseline yet) or
// when no new races were found - so a racer only starts earning points
// from the sync after they're first added to this tracker.
async function recordRacerPoints(userId, teamTag, { avgSpeed, accuracy, racesPlayed, previousRaces }) {
  if (previousRaces == null || racesPlayed == null) return;
  const racesDelta = racesPlayed - previousRaces;
  if (!(racesDelta > 0) || avgSpeed == null || accuracy == null) return;
  const points = Math.round((avgSpeed / 2 + accuracy) * racesDelta * 100) / 100;
  // avg_speed/accuracy are stored alongside points (not just baked into
  // it) so a team leaderboard can later compute a races-weighted average
  // WPM/accuracy for a time window, not just a points total.
  await pool.query(
    `insert into racer_points (nt_user_id, team_tag, races_delta, points, avg_speed, accuracy) values ($1, $2, $3, $4, $5, $6)`,
    [userId, teamTag, racesDelta, points, avgSpeed, accuracy]
  );
}

async function ingestTeam(tag) {
  const results = await fetchTeam(tag);
  const { info, members } = results;
  // Prefer the API's own-cased tag (e.g. "IMT") over whatever casing the
  // caller typed, so lookups stay consistent regardless of input casing.
  const normalizedTag = (info.tag || tag).toUpperCase();

  await upsertTeam(normalizedTag, info);

  let count = 0;
  for (const m of members || []) {
    // Must read these BEFORE upsertRacer/insertRacerStats overwrite them,
    // or "previous" would just be this sync's own new values.
    const previousTeamTag = await fetchPreviousTeamTag(m.userID);
    const previousRaces = await fetchPreviousRaces(m.userID);

    await upsertRacer(m, normalizedTag);
    const accuracy = computeAccuracy(m.typed, m.errs);
    await insertRacerStats(m.userID, {
      avgSpeed: m.avgSpeed ?? null,
      topSpeed: m.highestSpeed ?? null,
      races: m.racesPlayed ?? null,
      accuracy,
    });
    await recordRacerPoints(m.userID, normalizedTag, {
      avgSpeed: m.avgSpeed ?? null,
      accuracy,
      racesPlayed: m.racesPlayed ?? null,
      previousRaces,
    });
    const racesDelta =
      previousRaces != null && m.racesPlayed != null ? m.racesPlayed - previousRaces : null;
    await recordNotifications(normalizedTag, m, {
      displayName: m.displayName || m.username,
      racesPlayed: m.racesPlayed ?? null,
      previousRaces,
      previousTeamTag,
      racesDelta: racesDelta != null && racesDelta > 0 ? racesDelta : 0,
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
