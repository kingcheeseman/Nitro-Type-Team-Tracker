// Static site generator: queries Supabase once, writes plain HTML into
// site/, which the "Deploy to GitHub Pages" workflow then publishes.
// No server stays running — this script runs on a GitHub Actions schedule
// instead, the same model as the single-team tracker's sync.js + Pages setup.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

const OUT_DIR = path.join(__dirname, "..", "site");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function page(title, body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 840px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #ddd; }
    th { background: #f4f4f4; }
    a { color: #2563eb; }
    .meta { color: #666; font-size: 0.9rem; }
  </style>
</head>
<body>
${body}
<p class="meta">Generated ${new Date().toISOString()}</p>
</body>
</html>`;
}

async function buildTeamsIndex(teams) {
  const dir = OUT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const body = teams.length
    ? `<h1>Tracked teams</h1><ul>${teams
        .map(
          (t) =>
            `<li><a href="teams/${encodeURIComponent(t.tag.toLowerCase())}/">${escapeHtml(t.tag)}</a> — ${escapeHtml(t.display_name || "(unsynced)")}</li>`
        )
        .join("")}</ul>`
    : `<h1>Tracked teams</h1><p>No teams yet — that's expected until the ingestion job (Step 3) adds some.</p>`;
  fs.writeFileSync(path.join(dir, "index.html"), page("Nitro Tracker Platform", body));
}

async function buildTeamPage(team, racers) {
  const dir = path.join(OUT_DIR, "teams", team.tag.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  const rows = racers
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.username)}</td><td>${r.avg_speed ?? "-"}</td><td>${r.top_speed ?? "-"}</td><td>${r.races ?? "-"}</td><td>${r.accuracy ?? "-"}</td></tr>`
    )
    .join("");
  const body = `
    <p><a href="../../">← all teams</a></p>
    <h1>[${escapeHtml(team.tag)}] ${escapeHtml(team.display_name || "")}</h1>
    <p class="meta">Last synced: ${team.last_synced_at || "never"}</p>
    <table>
      <tr><th>Racer</th><th>Avg speed</th><th>Top speed</th><th>Races</th><th>Accuracy</th></tr>
      ${rows || "<tr><td colspan='5'>No racers synced yet.</td></tr>"}
    </table>`;
  fs.writeFileSync(path.join(dir, "index.html"), page(`[${team.tag}] team`, body));
}

async function main() {
  const { rows: teams } = await pool.query(
    "select tag, display_name, last_synced_at from teams order by tag"
  );
  await buildTeamsIndex(teams);

  for (const team of teams) {
    const { rows: racers } = await pool.query(
      `select r.username, s.avg_speed, s.top_speed, s.races, s.accuracy
       from racers r
       left join lateral (
         select * from racer_stats rs
         where rs.nt_user_id = r.nt_user_id
         order by captured_at desc limit 1
       ) s on true
       where r.team_tag = $1
       order by r.username`,
      [team.tag]
    );
    await buildTeamPage(team, racers);
  }

  console.log(`Built ${teams.length} team page(s) into ${OUT_DIR}`);
  await pool.end();
}

main().catch((err) => {
  console.error("Build failed:", err.message);
  process.exit(1);
});
