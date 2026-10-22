require("dotenv").config();
const express = require("express");
const { pool } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// Proves the whole stack is wired correctly: app is running AND can reach
// the real database. This is the one thing v0 has to get right before
// anything else gets built on top of it.
app.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("select now() as db_time");
    res.type("html").send(`
      <!doctype html>
      <html>
      <head><meta charset="utf-8"><title>Nitro Tracker Platform</title></head>
      <body style="font-family: system-ui; padding: 2rem;">
        <h1>It's alive.</h1>
        <p>App is running and the database connection works.</p>
        <p>Database time: <strong>${rows[0].db_time}</strong></p>
        <p>Tracked teams: <a href="/teams">/teams</a></p>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Database check failed:", err.message);
    res.status(500).send("App is running, but the database connection failed. Check DATABASE_URL.");
  }
});

// First proof that "team" is a parameter, not a hardcoded value: lists
// whatever teams exist in the database, however many there are (zero,
// for now, until Step 3's ingestion job adds some).
app.get("/teams", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "select tag, display_name, last_synced_at from teams order by tag"
    );
    if (rows.length === 0) {
      return res.type("html").send(`
        <p>No teams yet — that's expected until the ingestion job (Step 3) runs.</p>
        <p><a href="/">← back</a></p>
      `);
    }
    const items = rows
      .map((t) => `<li><a href="/teams/${encodeURIComponent(t.tag)}">${t.tag}</a> — ${t.display_name || "(unsynced)"}</li>`)
      .join("");
    res.type("html").send(`<ul>${items}</ul><p><a href="/">← back</a></p>`);
  } catch (err) {
    console.error("Teams query failed:", err.message);
    res.status(500).send("Could not query teams.");
  }
});

// Generic team page (Step 4 preview) — reads by tag, renders whatever is
// in the database for it. No hardcoded team anywhere in this file.
app.get("/teams/:tag", async (req, res) => {
  const tag = req.params.tag.toUpperCase();
  try {
    const team = await pool.query("select * from teams where tag = $1", [tag]);
    if (team.rows.length === 0) {
      return res.status(404).send(`No team with tag "${tag}" in the database yet.`);
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
    const rowsHtml = racers.rows
      .map(
        (r) =>
          `<tr><td>${r.username}</td><td>${r.avg_speed ?? "-"}</td><td>${r.top_speed ?? "-"}</td><td>${r.races ?? "-"}</td><td>${r.accuracy ?? "-"}</td></tr>`
      )
      .join("");
    res.type("html").send(`
      <h1>[${team.rows[0].tag}] ${team.rows[0].display_name || ""}</h1>
      <p>Last synced: ${team.rows[0].last_synced_at || "never"}</p>
      <table border="1" cellpadding="6">
        <tr><th>Racer</th><th>Avg speed</th><th>Top speed</th><th>Races</th><th>Accuracy</th></tr>
        ${rowsHtml || "<tr><td colspan='5'>No racers synced yet.</td></tr>"}
      </table>
      <p><a href="/teams">← all teams</a></p>
    `);
  } catch (err) {
    console.error("Team page query failed:", err.message);
    res.status(500).send("Could not load that team.");
  }
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
