// Static site generator: queries Supabase once, writes plain HTML into
// site/, which the "Deploy to GitHub Pages" workflow then publishes.
// No server stays running — this script runs on a GitHub Actions schedule
// instead, the same model as the single-team tracker's sync.js + Pages setup.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");
const {
  escapeHtml,
  teamGradient,
  teamBadgeColor,
  accuracyClass,
  pageShell,
} = require("./theme");

const OUT_DIR = path.join(__dirname, "..", "site");

function buildTeamsIndex(teams) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const body = teams.length
    ? `<h1>Tracked teams</h1>
       <p class="meta-row">${teams.length} team${teams.length === 1 ? "" : "s"} tracked</p>
       <div class="grid">
         ${teams
           .map((t) => {
             const initial = (t.tag || "?").slice(0, 1).toUpperCase();
             return `
             <a class="card" href="teams/${encodeURIComponent(t.tag.toLowerCase())}/" style="text-decoration:none;color:inherit;">
               <div class="top">
                 <div class="badge" style="background:${teamGradient(t.tag)}">${escapeHtml(initial)}</div>
                 <div>
                   <div class="tag">[${escapeHtml(t.tag)}]</div>
                   <div class="display-name">${escapeHtml(t.display_name || "(unsynced)")}</div>
                 </div>
               </div>
               <div class="footer">${t.last_synced_at ? `Synced ${new Date(t.last_synced_at).toLocaleString()}` : "Not synced yet"}</div>
             </a>`;
           })
           .join("")}
       </div>`
    : `<h1>Tracked teams</h1>
       <div class="empty">No teams yet — that's expected until the ingestion job adds some.</div>`;

  fs.writeFileSync(
    path.join(OUT_DIR, "index.html"),
    pageShell({ title: "Nitro Tracker Platform", body })
  );
}

function buildTeamPage(team, racers) {
  const dir = path.join(OUT_DIR, "teams", team.tag.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });

  const rows = racers
    .map((r) => {
      const initial = (r.username || "?").slice(0, 1).toUpperCase();
      const accClass = accuracyClass(r.accuracy);
      const accLabel = r.accuracy == null ? "—" : `${r.accuracy}%`;
      return `
        <tr>
          <td class="racer">
            <span class="avatar" style="background:${teamBadgeColor(r.username || team.tag)}">${escapeHtml(initial)}</span>
            ${escapeHtml(r.username)}
          </td>
          <td>${r.avg_speed ?? "-"}</td>
          <td>${r.top_speed ?? "-"}</td>
          <td>${r.races ?? "-"}</td>
          <td><span class="pill ${accClass}">${accLabel}</span></td>
        </tr>`;
    })
    .join("");

  const body = `
    <div class="hero" style="background:${teamGradient(team.tag)}">
      <div class="tag">TEAM</div>
      <div class="name">[${escapeHtml(team.tag)}] ${escapeHtml(team.display_name || "")}</div>
      <div class="sub">${racers.length} racer${racers.length === 1 ? "" : "s"} tracked · last synced ${
        team.last_synced_at ? new Date(team.last_synced_at).toLocaleString() : "never"
      }</div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Racer</th><th>Avg speed</th><th>Top speed</th><th>Races</th><th>Accuracy</th></tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="5" style="color:var(--muted);">No racers synced yet.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  fs.writeFileSync(
    path.join(dir, "index.html"),
    pageShell({
      title: `[${team.tag}] ${team.display_name || "team"}`,
      body,
      crumb: `<a href="../../">← all teams</a>`,
    })
  );
}

async function main() {
  const { rows: teams } = await pool.query(
    "select tag, display_name, last_synced_at from teams order by tag"
  );
  buildTeamsIndex(teams);

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
    buildTeamPage(team, racers);
  }

  console.log(`Built ${teams.length} team page(s) into ${OUT_DIR}`);
  await pool.end();
}

main().catch((err) => {
  console.error("Build failed:", err.message);
  process.exit(1);
});
