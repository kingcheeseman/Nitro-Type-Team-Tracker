require("dotenv").config();
const express = require("express");
const { pool } = require("./db");
const {
  escapeHtml,
  teamGradient,
  teamBadgeColor,
  accuracyClass,
  pageShell,
} = require("./theme");

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
        title: "Nitro Tracker Platform",
        body: `
          <h1>It's alive.</h1>
          <p class="meta-row">App is running and the database connection works.</p>
          <p class="meta-row">Database time: <strong>${rows[0].db_time}</strong></p>
          <p><a href="/teams">View tracked teams →</a></p>`,
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
      "select tag, display_name, last_synced_at from teams order by tag"
    );
    const body = rows.length
      ? `<h1>Tracked teams</h1>
         <p class="meta-row">${rows.length} team${rows.length === 1 ? "" : "s"} tracked</p>
         <div class="grid">
           ${rows
             .map((t) => {
               const initial = (t.tag || "?").slice(0, 1).toUpperCase();
               return `
               <a class="card" href="/teams/${encodeURIComponent(t.tag)}" style="text-decoration:none;color:inherit;">
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
      : `<h1>Tracked teams</h1><div class="empty">No teams yet — run the ingestion script to add some.</div>`;
    res.type("html").send(pageShell({ title: "Tracked teams", body, crumb: `<a href="/">← back</a>` }));
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
      `select r.username, s.avg_speed, s.top_speed, s.races, s.accuracy
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
        return `
          <tr>
            <td class="racer">
              <span class="avatar" style="background:${teamBadgeColor(r.username || tag)}">${escapeHtml(initial)}</span>
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
      <div class="hero" style="background:${teamGradient(t.tag)}">
        <div class="tag">TEAM</div>
        <div class="name">[${escapeHtml(t.tag)}] ${escapeHtml(t.display_name || "")}</div>
        <div class="sub">${racers.rows.length} racer${racers.rows.length === 1 ? "" : "s"} tracked · last synced ${
          t.last_synced_at ? new Date(t.last_synced_at).toLocaleString() : "never"
        }</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Racer</th><th>Avg speed</th><th>Top speed</th><th>Races</th><th>Accuracy</th></tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="5" style="color:var(--muted);">No racers synced yet.</td></tr>`}
          </tbody>
        </table>
      </div>`;

    res.type("html").send(
      pageShell({
        title: `[${t.tag}] ${t.display_name || "team"}`,
        body,
        crumb: `<a href="/teams">← all teams</a>`,
      })
    );
  } catch (err) {
    console.error("Team page query failed:", err.message);
    res.status(500).send("Could not load that team.");
  }
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
