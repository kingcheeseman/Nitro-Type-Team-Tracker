require("dotenv").config();
const express = require("express");
const { pool } = require("./db");
const {
  escapeHtml,
  teamColor,
  textOnColor,
  avatarColor,
  accuracyClass,
  formatDate,
  roleBadge,
  membershipBadge,
  NAV_ITEMS,
  MANAGE_NAV_ITEMS,
  teamSidebar,
  comingSoonBody,
  leaderboardsBody,
  pageShell,
} = require("./theme");

// Express routes use fixed absolute paths (unlike build.js's relative,
// depth-aware ones), so the nav hrefs are the same on every page here.
const SITE_NAV = { teamsHref: "/teams", leaderboardsHref: "/leaderboards" };

const app = express();
const PORT = process.env.PORT || 3000;

// Proves the whole stack is wired correctly: app is running AND can reach
// the real database. This is the one thing v0 has to get right before
// anything else gets built on top of it.
app.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("select now() as db_time");
    res.type("html").send(
      pageShell({
        title: "TypeTrack",
        body: `
          <h1>It's alive.</h1>
          <p class="meta-row">App is running and the database connection works.</p>
          <p class="meta-row">Database time: <strong>${rows[0].db_time}</strong></p>
          <p><a href="/teams">View tracked teams →</a></p>`,
        ...SITE_NAV,
      })
    );
  } catch (err) {
    console.error("Database check failed:", err.message);
    res.status(500).send("App is running, but the database connection failed. Check DATABASE_URL.");
  }
});

// First proof that "team" is a parameter, not a hardcoded value: lists
// whatever teams exist in the database, however many there are (zero,
// until the ingestion job adds some).
app.get("/teams", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select tag, display_name, last_synced_at,
              captain_username, captain_display_name, members_count, nt_created_at,
              min_races, min_speed, tag_color
       from teams order by tag`
    );
    const body = rows.length
      ? `<div class="index-header">
           <div>
             <h1>Browse teams</h1>
             <p class="meta-row">${rows.length} team${rows.length === 1 ? "" : "s"} tracked</p>
           </div>
           <div class="search-box">
             <input id="teamSearch" type="text" placeholder="Search teams…" autocomplete="off">
           </div>
         </div>
         <div class="grid" id="teamGrid">
           ${rows
             .map((t) => {
               const initial = (t.tag || "?").slice(0, 1).toUpperCase();
               const searchKey = `${t.tag} ${t.display_name || ""} ${t.captain_username || ""}`.toLowerCase();
               const badgeBg = teamColor(t.tag, t.tag_color);
               return `
               <div class="card" data-search="${escapeHtml(searchKey)}">
                 <div class="top">
                   <div class="badge" style="background:${badgeBg};color:${textOnColor(badgeBg)}">${escapeHtml(initial)}</div>
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
                 <a class="view-btn" href="/teams/${encodeURIComponent(t.tag)}">View team →</a>
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
      : `<h1>Browse teams</h1><div class="empty">No teams yet — run the ingestion script to add some.</div>`;
    res.type("html").send(pageShell({ title: "Tracked teams", body, crumb: `<a href="/">← back</a>`, ...SITE_NAV, active: "teams" }));
  } catch (err) {
    console.error("Teams query failed:", err.message);
    res.status(500).send("Could not query teams.");
  }
});

// Generic team page — reads by tag, renders whatever is in the database
// for it. No hardcoded team anywhere in this file.
app.get("/teams/:tag", async (req, res) => {
  const tag = req.params.tag.toUpperCase();
  try {
    const team = await pool.query("select * from teams where tag = $1", [tag]);
    if (team.rows.length === 0) {
      return res.status(404).send(`No team with tag "${escapeHtml(tag)}" in the database yet.`);
    }
    const racers = await pool.query(
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
      [tag]
    );
    const t = team.rows[0];
    const rowsHtml = racers.rows
      .map((r) => {
        const initial = (r.username || "?").slice(0, 1).toUpperCase();
        const accClass = accuracyClass(r.accuracy);
        const accLabel = r.accuracy == null ? "—" : `${r.accuracy}%`;
        const isCaptain = t.captain_username && r.username === t.captain_username;
        return `
          <tr>
            <td class="racer">
              <span class="avatar" style="background:${avatarColor(r.username || tag)}">${escapeHtml(initial)}</span>
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
        <div class="req">Members <b>${t.members_count ?? racers.rows.length}</b></div>
        <div class="req">Formed <b>${formatDate(t.nt_created_at)}</b></div>
        <div class="req">Enrollment <b>${escapeHtml(t.enrollment || "—")}</b></div>
        <div class="req">Min races <b>${t.min_races ?? "—"}</b></div>
        <div class="req">Min speed <b>${t.min_speed ?? "—"} wpm</b></div>
        ${t.min_level != null ? `<div class="req">Min level <b>${t.min_level}</b></div>` : ""}
      </div>`;

    const specialReqs = t.other_requirements
      ? `<div class="special-reqs">
           <div class="label">Special requirements</div>
           <div class="text">${escapeHtml(t.other_requirements)}</div>
         </div>`
      : "";

    const heroBg = teamColor(t.tag, t.tag_color);
    const hero = `
      <div class="hero" style="background:${heroBg};color:${textOnColor(heroBg)}">
        <div class="tag">TEAM</div>
        <div class="name">[${escapeHtml(t.tag)}] ${escapeHtml(t.display_name || "")}</div>
        <div class="sub">
          ${t.captain_display_name || t.captain_username
            ? `Captain: ${escapeHtml(t.captain_display_name || t.captain_username)} · `
            : ""}${racers.rows.length} racer${racers.rows.length === 1 ? "" : "s"} tracked · last synced ${
          t.last_synced_at ? new Date(t.last_synced_at).toLocaleString() : "never"
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
            ${rowsHtml || `<tr><td colspan="6" style="color:var(--muted);">No racers synced yet.</td></tr>`}
          </tbody>
        </table>
      </div>`;

    const linkFor = (key) => (key === "roster" ? `/teams/${encodeURIComponent(tag)}` : `/teams/${encodeURIComponent(tag)}/${key}`);
    const body = `
      <div class="team-layout">
        ${teamSidebar("roster", linkFor)}
        <div class="team-content">${hero}${roster}</div>
      </div>`;

    res.type("html").send(
      pageShell({
        title: `[${t.tag}] ${t.display_name || "team"}`,
        body,
        crumb: `<a href="/teams">← all teams</a>`,
        ...SITE_NAV,
        active: "teams",
      })
    );
  } catch (err) {
    console.error("Team page query failed:", err.message);
    res.status(500).send("Could not load that team.");
  }
});

// Sidebar sections that aren't built yet (anything but Roster) — same
// "coming soon" placeholder the static site generates, so local preview
// and the deployed site behave the same way when you click around.
app.get("/teams/:tag/:section", async (req, res) => {
  const tag = req.params.tag.toUpperCase();
  const section = req.params.section;
  const item = [...NAV_ITEMS, ...MANAGE_NAV_ITEMS].find((it) => it.key === section);
  if (!item || item.built) {
    return res.status(404).send("Not found.");
  }
  try {
    const team = await pool.query("select * from teams where tag = $1", [tag]);
    if (team.rows.length === 0) {
      return res.status(404).send(`No team with tag "${escapeHtml(tag)}" in the database yet.`);
    }
    const t = team.rows[0];
    const sectionHeroBg = teamColor(t.tag, t.tag_color);
    const hero = `
      <div class="hero" style="background:${sectionHeroBg};color:${textOnColor(sectionHeroBg)}">
        <div class="tag">TEAM</div>
        <div class="name">[${escapeHtml(t.tag)}] ${escapeHtml(t.display_name || "")}</div>
      </div>`;
    const linkFor = (key) => (key === "roster" ? `/teams/${encodeURIComponent(tag)}` : `/teams/${encodeURIComponent(tag)}/${key}`);
    const body = `
      <div class="team-layout">
        ${teamSidebar(item.key, linkFor)}
        <div class="team-content">${hero}${comingSoonBody(item.label)}</div>
      </div>`;
    res.type("html").send(
      pageShell({
        title: `[${t.tag}] ${item.label}`,
        body,
        crumb: `<a href="/teams">← all teams</a>`,
        ...SITE_NAV,
        active: "teams",
      })
    );
  } catch (err) {
    console.error("Team section page query failed:", err.message);
    res.status(500).send("Could not load that team.");
  }
});

// Site-wide leaderboards: racers and teams ranked across everything this
// tracker follows (not all of Nitro Type - just the teams we ingest).
// Mirrors build.js's buildLeaderboardsPage via the shared leaderboardsBody
// helper in theme.js so local preview and the deployed static site never
// drift apart.
app.get("/leaderboards", async (req, res) => {
  try {
    // "score" is our own blended progress metric (avg speed / 2 + accuracy),
    // not anything Nitro Type itself reports - mirrors build.js's query.
    const { rows: racerRows } = await pool.query(
      `select r.username, r.team_tag, t.tag_color,
              s.avg_speed, s.top_speed, s.races, s.accuracy,
              case when s.avg_speed is not null and s.accuracy is not null
                   then round(s.avg_speed / 2 + s.accuracy, 1) end as score
       from racers r
       join teams t on t.tag = r.team_tag
       left join lateral (
         select * from racer_stats rs where rs.nt_user_id = r.nt_user_id
         order by captured_at desc limit 1
       ) s on true
       where s.avg_speed is not null
       order by score desc nulls last, s.avg_speed desc
       limit 100`
    );
    const { rows: teamRows } = await pool.query(
      `select t.tag, t.display_name, t.tag_color,
              round(avg(s.avg_speed), 1) as avg_speed,
              max(s.top_speed) as top_speed,
              sum(s.races) as total_races,
              count(s.avg_speed) as racer_count,
              round(avg(s.avg_speed) / 2 + avg(s.accuracy), 1) as score
       from teams t
       join racers r on r.team_tag = t.tag
       left join lateral (
         select * from racer_stats rs where rs.nt_user_id = r.nt_user_id
         order by captured_at desc limit 1
       ) s on true
       group by t.tag, t.display_name, t.tag_color
       order by score desc nulls last`
    );
    res.type("html").send(
      pageShell({
        title: "Leaderboards — TypeTrack",
        body: leaderboardsBody(racerRows, teamRows),
        crumb: `<a href="/teams">← all teams</a>`,
        ...SITE_NAV,
        active: "leaderboards",
      })
    );
  } catch (err) {
    console.error("Leaderboards query failed:", err.message);
    res.status(500).send("Could not load leaderboards.");
  }
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
