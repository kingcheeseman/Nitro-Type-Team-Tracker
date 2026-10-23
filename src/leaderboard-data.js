// Shared leaderboard queries, used by both build.js (static site) and
// server.js (local preview) so the two never compute rankings differently
// - only the surrounding page (pageShell call) differs between them.
//
// Every board here sums the racer_points ledger (see schema.sql), filtered
// to a rolling time window ("now() - interval"), not a calendar-aligned
// bucket (midnight-to-midnight, etc). Rolling windows sidestep timezone
// edge cases - what counts as "today" depends on whose timezone - and are
// simpler to verify: "last 24 hours" always means exactly that.
const RANGE_INTERVALS = {
  hourly: "1 hour",
  daily: "1 day",
  weekly: "7 days",
  monthly: "30 days",
  // Nitro Type does have real, dated seasons (~6 weeks each), but there's
  // no reliable public API exposing a season's start/end dates - the
  // season page is server-rendered with no backing JSON endpoint we could
  // find. Rather than hand-maintain real season dates through code
  // changes every rollover, "Seasonal" here is the same kind of rolling
  // window as the others, just longer - explicitly NOT a claim about
  // Nitro Type's own season boundary (see the extra note rendered with it
  // in theme.js).
  seasonal: "45 days",
  // Not a real "forever" - just long enough to include every row, since
  // racer_points only ever holds rows from after this feature shipped.
  alltime: "100 years",
};

const BUILT_RANGES = ["hourly", "daily", "weekly", "monthly", "seasonal", "alltime"];

async function queryRacerPoints(pool, range) {
  const { rows } = await pool.query(
    `select r.username, r.display_name, r.team_tag, t.tag_color,
            sum(rp.points) as points,
            sum(rp.races_delta) as races,
            s.avg_speed, s.top_speed, s.accuracy
     from racer_points rp
     join racers r on r.nt_user_id = rp.nt_user_id
     join teams t on t.tag = r.team_tag
     left join lateral (
       select * from racer_stats rs where rs.nt_user_id = r.nt_user_id
       order by captured_at desc limit 1
     ) s on true
     where rp.captured_at >= now() - $1::interval
     group by r.username, r.display_name, r.team_tag, t.tag_color, s.avg_speed, s.top_speed, s.accuracy
     having sum(rp.points) > 0
     order by points desc
     limit 100`,
    [RANGE_INTERVALS[range]]
  );
  return rows;
}

// Team WPM/Accuracy are races-weighted averages over the window (each
// sync's rate counted once per race it covered), computed with FILTER so
// rows written before racer_points had avg_speed/accuracy (never
// backfilled) are excluded from the average instead of nulling it out -
// while still counting fully toward races/points.
async function queryTeamPoints(pool, range) {
  const { rows } = await pool.query(
    `select t.tag, t.display_name, t.tag_color,
            sum(rp.points) as points,
            sum(rp.races_delta) as races,
            count(distinct rp.nt_user_id) as racer_count,
            round(
              sum(rp.races_delta * rp.avg_speed) filter (where rp.avg_speed is not null)
              / nullif(sum(rp.races_delta) filter (where rp.avg_speed is not null), 0)
            , 1) as avg_speed,
            round(
              sum(rp.races_delta * rp.accuracy) filter (where rp.accuracy is not null)
              / nullif(sum(rp.races_delta) filter (where rp.accuracy is not null), 0)
            , 2) as accuracy
     from racer_points rp
     join teams t on t.tag = rp.team_tag
     where rp.captured_at >= now() - $1::interval
     group by t.tag, t.display_name, t.tag_color
     having sum(rp.points) > 0
     order by points desc`,
    [RANGE_INTERVALS[range]]
  );
  return rows;
}

// { racers: { hourly: [...], daily: [...], ... }, teams: { ... } } - the
// exact shape theme.js's leaderboardsBody() expects.
async function loadLeaderboardData(pool) {
  const racers = {};
  const teams = {};
  for (const range of BUILT_RANGES) {
    racers[range] = await queryRacerPoints(pool, range);
    teams[range] = await queryTeamPoints(pool, range);
  }
  return { racers, teams };
}

module.exports = { RANGE_INTERVALS, BUILT_RANGES, queryRacerPoints, queryTeamPoints, loadLeaderboardData };
