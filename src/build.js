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
  formatDate,
  roleBadge,
  membershipBadge,
  NAV_ITEMS,
  MANAGE_NAV_ITEMS,
  teamSidebar,
  comingSoonBody,
  pageShell,
} = require("./theme");

const OUT_DIR = path.join(__dirname, "..", "site");

function buildTeamsIndex(teams) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const body = teams.length
    ? `<div class="index-header">
         <div>
           <h1>Browse teams</h1>
           <p class="meta-row">${teams.length} team${teams.length === 1 ? "" : "s"} tracked</p>
         </div>
         <div class="search-box">
           <input id="teamSearch" type="text" placeholder="Search teams…" autocomplete="off">
         </div>
       </div>
       <div class="grid" id="teamGrid">
         ${teams
           .map((t) => {
             const initial = (t.tag || "?").slice(0, 1).toUpperCase();
             const searchKey = `${t.tag} ${t.display_name || ""} ${t.captain_username || ""}`.toLowerCase();
             return `
             <div class="card" data-search="${escapeHtml(searchKey)}">
               <div class="top">
                 <div class="badge" style="background:${teamGradient(t.tag)}">${escapeHtml(initial)}</div>
                 <div>
                   <div class="tag">[${escapeHtml(t.tag)}]</div>
                   <div class="display-name">${escapeHtml(t.display_name || "(unsynced)")}</div>
                 </div>
               </div>
               ${t.captain_username ? `<div class="req-line">Captain: <b>${escapeHtml(t.captain_display_name || t.captain_username)}</b></div>` : ""}
               <div class="req-line">Members: <b>${t.members_count ?? "—"}</b> &nbsp;·&nbsp; Formed: <b>${formatDate(t.nt_created_at)}</b></div>
               ${t.min_races != null || t.min_speed != null
                 ? `<div class="req-line">Min: <b>${t.min_races ?? "—"} races</b> / <b>${t.min_speed ?? "—"} wpm</b></div>`
                 : ""}
               <a class="view-btn" href="teams/${encodeURIComponent(t.tag.toLowerCase())}/">View team →</a>
               <div class="footer">${t.last_synced_at ? `Synced ${new Date(t.last_synced_at).toLocaleString()}` : "Not synced yet"}</div>
             </div>`;
           })
           .join("")}
       </div>
       <script>
         (function () {
           var input = document.getElementById("teamSearch");
           var cards = Array.prototype.slice.call(document.querySelectorAll("#teamGrid .card"));
           input.addEventListener("input", function () {
             var q = input.value.trim().toLowerCase();
             cards.forEach(function (card) {
               var match = !q || card.getAttribute("data-search").indexOf(q) !== -1;
               card.style.display = match ? "" : "none";
             });
           });
         })();
       </script>`
    : `<h1>Browse teams</h1>
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
      const isCaptain = team.captain_username && r.username === team.captain_username;
      return `
        <tr>
          <td class="racer">
            <span class="avatar" style="background:${teamBadgeColor(r.username || team.tag)}">${escapeHtml(initial)}</span>
            ${escapeHtml(r.username)}${roleBadge(r.role, isCaptain)}${membershipBadge(r.membership)}
          </td>
          <td>${formatDate(r.joined_at_nt)}</td>
          <td>${r.avg_speed ?? "-"}</td>
          <td>${r.top_speed ?? "-"}</td>
          <td>${r.races ?? "-"}</td>
          <td><span class="pill ${accClass}">${accLabel}</span></td>
        </tr>`;
    })
    .join("");

  const reqBar = `
    <div class="req-bar">
      <div class="req">Members <b>${team.members_count ?? racers.length}</b></div>
      <div class="req">Formed <b>${formatDate(team.nt_created_at)}</b></div>
      <div class="req">Enrollment <b>${escapeHtml(team.enrollment || "—")}</b></div>
      <div class="req">Min races <b>${team.min_races ?? "—"}</b></div>
      <div class="req">Min speed <b>${team.min_speed ?? "—"} wpm</b></div>
      ${team.min_level != null ? `<div class="req">Min level <b>${team.min_level}</b></div>` : ""}
    </div>`;

  const specialReqs = team.other_requirements
    ? `<div class="special-reqs">
         <div class="label">Special requirements</div>
         <div class="text">${escapeHtml(team.other_requirements)}</div>
       </div>`
    : "";

  const hero = `
    <div class="hero" style="background:${teamGradient(team.tag)}">
      <div class="tag">TEAM</div>
      <div class="name">[${escapeHtml(team.tag)}] ${escapeHtml(team.display_name || "")}</div>
      <div class="sub">
        ${team.captain_display_name || team.captain_username
          ? `Captain: ${escapeHtml(team.captain_display_name || team.captain_username)} · `
          : ""}${racers.length} racer${racers.length === 1 ? "" : "s"} tracked · last synced ${
        team.last_synced_at ? new Date(team.last_synced_at).toLocaleString() : "never"
      }</div>
    </div>`;

  const roster = `
    ${reqBar}
    ${specialReqs}
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Racer</th><th>Joined</th><th>Avg speed</th><th>Highest speed</th><th>Lifetime races</th><th>Accuracy</th></tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="6" style="color:var(--muted);">No racers synced yet.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  writeTeamSectionPage({
    dir,
    depth: 0,
    activeKey: "roster",
    content: hero + roster,
    crumb: `<a href="../../">← all teams</a>`,
    title: `[${team.tag}] ${team.display_name || "team"}`,
  });

  // Everything in the sidebar besides Roster is a placeholder for now -
  // generate a real (if thin) page for each one so the nav is honest
  // about what it links to instead of pointing at a 404.
  const heroForSections = hero; // same hero banner on every section page
  for (const item of [...NAV_ITEMS, ...MANAGE_NAV_ITEMS]) {
    if (item.built) continue;
    const sectionDir = path.join(dir, item.key);
    fs.mkdirSync(sectionDir, { recursive: true });
    writeTeamSectionPage({
      dir: sectionDir,
      depth: 1,
      activeKey: item.key,
      content: heroForSections + comingSoonBody(item.label),
      crumb: `<a href="../../../">← all teams</a>`,
      title: `[${team.tag}] ${item.label}`,
    });
  }
}

function writeTeamSectionPage({ dir, depth, activeKey, content, crumb, title }) {
  // depth 0 = this page is teams/<tag>/index.html, so "events" lives at
  // ./events/; depth 1 = teams/<tag>/<section>/index.html, so a sibling
  // section lives at ../<key>/ and roster is one level up.
  const prefix = depth === 0 ? "" : "../";
  const linkFor = (key) => (key === "roster" ? (depth === 0 ? "./" : "../") : `${prefix}${key}/`);
  const body = `
    <div class="team-layout">
      ${teamSidebar(activeKey, linkFor)}
      <div class="team-content">${content}</div>
    </div>`;
  fs.writeFileSync(path.join(dir, "index.html"), pageShell({ title, body, crumb }));
}

async function main() {
  const { rows: teams } = await pool.query(
    `select tag, display_name, last_synced_at,
            captain_username, captain_display_name, members_count, nt_created_at,
            min_races, min_speed, min_level, enrollment, other_requirements
     from teams order by tag`
  );
  buildTeamsIndex(teams);

  for (const team of teams) {
    const { rows: racers } = await pool.query(
      `select r.username, r.role, r.membership, r.joined_at_nt,
              s.avg_speed, s.top_speed, s.races, s.accuracy
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
