// Shared look for every generated page (build.js's static site and
// server.js's local preview) — one place to change colors/layout instead
// of two copies of the same CSS drifting apart.
//
// Visual language borrowed from ntstartrack.org (the established
// community tool for this exact kind of page): dark panels, Manrope,
// small rounded cards, colored per-team accents, a clean data table.
// Nothing here copies its code, text, or any specific image/asset - just
// the general dark-UI/card/table conventions common to this kind of
// stats dashboard.

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Deterministic tag -> hue, so every team gets a stable, distinct accent
// color across visits/builds without storing one in the database.
function hashHue(str) {
  let h = 0;
  for (const ch of String(str)) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return h % 360;
}

// Nitro Type's own API returns a team's real "tagColor" (e.g. "5b52a3") -
// the exact same color shown on the team's actual NT page and the one
// StarTrack uses too. We use that verbatim, as a flat color (not a
// gradient we invented), so there's never any mismatch or confusion with
// the real team color. Only a team we haven't captured tagColor for yet
// falls back to a deterministic hash-based color.
function teamColor(tag, tagColor) {
  if (tagColor) return `#${String(tagColor).replace(/^#/, "")}`;
  return `hsl(${hashHue(tag)} 70% 38%)`;
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace(/^#/, ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// A real team color can be light or dark, so the text on top of it (hero
// banner, card badge) has to be chosen per-color instead of hardcoded -
// otherwise a light tagColor would render near-invisible white-on-white.
function textOnColor(color) {
  if (!color.startsWith("#")) return "#ffffff"; // hash fallback is always dark enough
  return relativeLuminance(hexToRgb(color)) > 0.5 ? "#0b1220" : "#ffffff";
}

// Decorative per-racer avatar color (not a claim about team identity) -
// still hash-based since Nitro Type doesn't expose a per-racer color.
function avatarColor(seed) {
  return `hsl(${hashHue(seed)} 85% 65%)`;
}

// Bucket accuracy into a color class the same way a tier badge would -
// quick visual signal without requiring the viewer to read every number.
function accuracyClass(accuracy) {
  if (accuracy == null) return "na";
  if (accuracy >= 95) return "good";
  if (accuracy >= 90) return "ok";
  return "low";
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

// "officer"/"member"/captain -> a small colored pill, the same visual
// slot a tier badge fills on a roster table: a quick, scannable status
// signal next to each name.
function roleBadge(role, isCaptain) {
  if (isCaptain) return `<span class="role-pill captain">Captain</span>`;
  if (role === "officer") return `<span class="role-pill officer">Officer</span>`;
  return "";
}

function membershipBadge(membership) {
  if (membership === "gold") return `<span class="role-pill gold">Gold</span>`;
  return "";
}

// Single source of truth for a team page's section sidebar. "roster" is
// the only one with real content right now; everything else gets a
// generated placeholder page (see build.js) so the sidebar shows the
// shape of where this project is headed without faking functionality -
// clicking one of these is honest about not being built yet.
const NAV_ITEMS = [
  { key: "roster", label: "Roster", icon: "\u{1F465}", built: true },
  { key: "events", label: "Events", icon: "\u{1F4C5}", built: false },
  { key: "activity", label: "Activity", icon: "\u{1F4C8}", built: false },
  { key: "tournaments", label: "Tournaments", icon: "\u{1F3C6}", built: false },
  { key: "trackers", label: "Trackers", icon: "\u{1F4CC}", built: false },
  { key: "notifications", label: "Notifications", icon: "\u{1F514}", built: false },
];
const MANAGE_NAV_ITEMS = [
  { key: "admin", label: "Team Admin", icon: "⚙️", built: false },
];

// Builds the sidebar for a given team page. `linkFor(key)` supplies the
// href for each section — the static site (nested directories, relative
// links) and the local Express preview (flat /teams/:tag/:section routes)
// resolve paths completely differently, so each caller passes its own.
function teamSidebar(activeKey, linkFor) {
  const item = (it) => {
    const active = it.key === activeKey ? " active" : "";
    const soon = it.built ? "" : `<span class="soon-tag">Soon</span>`;
    return `<a class="nav-item${active}" href="${linkFor(it.key)}"><span class="nav-icon">${it.icon}</span>${escapeHtml(it.label)}${soon}</a>`;
  };
  return `
    <nav class="team-sidebar">
      ${NAV_ITEMS.map(item).join("")}
      <div class="nav-section-label">Manage</div>
      ${MANAGE_NAV_ITEMS.map(item).join("")}
    </nav>`;
}

function comingSoonBody(label) {
  return `
    <div class="empty" style="padding:48px 28px;">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">Coming soon</div>
      <div>The ${escapeHtml(label)} section isn't built yet — only Roster is live right now.</div>
    </div>`;
}

// Leaderboard time-range boards we show tabs for. Only "alltime" has real
// data right now (it's computed from each racer's latest snapshot) -
// Daily/Weekly/Monthly need enough snapshot history behind them to compute
// honestly, so they're real tabs that load a real "coming soon" panel
// instead of silently missing or faking numbers.
const LEADERBOARD_RANGES = [
  { key: "alltime", label: "All-Time", built: true },
  { key: "monthly", label: "Monthly", built: false },
  { key: "weekly", label: "Weekly", built: false },
  { key: "daily", label: "Daily", built: false },
];

function comingSoonLeaderboard(rangeLabel) {
  return `
    <div class="empty" style="padding:40px 24px;">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">Coming soon</div>
      <div>The ${escapeHtml(rangeLabel)} board needs more sync history behind it before it can
      rank anyone fairly — only All-Time (current standings) is live right now.</div>
    </div>`;
}

// data-kind/data-range panel pair, built once per (kind, range) combo so
// the segmented controls below just toggle which one is visible.
function leaderboardPanel(kind, range, innerHtml, visible) {
  return `<div class="lb-panel" data-kind="${kind}" data-range="${range}"${visible ? "" : " hidden"}>${innerHtml}</div>`;
}

function leaderboardControls() {
  const kindBtn = (key, label, active) =>
    `<button type="button" class="seg-btn${active ? " active" : ""}" data-kind="${key}">${escapeHtml(label)}</button>`;
  const rangeBtn = (it, active) =>
    `<button type="button" class="seg-btn${active ? " active" : ""}" data-range="${it.key}">${escapeHtml(it.label)}${it.built ? "" : ` <span class="soon-tag">Soon</span>`}</button>`;
  return `
    <div class="lb-controls">
      <div class="seg" data-role="kind">
        ${kindBtn("racers", "Racers", true)}
        ${kindBtn("teams", "Teams", false)}
      </div>
      <div class="seg" data-role="range">
        ${LEADERBOARD_RANGES.map((it) => rangeBtn(it, it.key === "alltime")).join("")}
      </div>
    </div>
    <script>
      (function () {
        var kindSeg = document.querySelector('.seg[data-role="kind"]');
        var rangeSeg = document.querySelector('.seg[data-role="range"]');
        // Queried fresh inside sync() rather than cached once here: this
        // inline script runs the instant the parser reaches it, before the
        // .lb-panel elements that come AFTER it in the HTML have been
        // parsed yet, so caching them up front would always find none.
        function sync() {
          var kind = kindSeg.querySelector(".seg-btn.active").getAttribute("data-kind");
          var range = rangeSeg.querySelector(".seg-btn.active").getAttribute("data-range");
          var panels = document.querySelectorAll(".lb-panel");
          panels.forEach(function (p) {
            p.hidden = !(p.getAttribute("data-kind") === kind && p.getAttribute("data-range") === range);
          });
        }
        [kindSeg, rangeSeg].forEach(function (seg) {
          seg.addEventListener("click", function (e) {
            var btn = e.target.closest(".seg-btn");
            if (!btn) return;
            Array.prototype.slice.call(seg.querySelectorAll(".seg-btn")).forEach(function (b) {
              b.classList.toggle("active", b === btn);
            });
            sync();
          });
        });
      })();
    </script>`;
}

function rankBadgeClass(rank) {
  if (rank === 1) return " top1";
  if (rank === 2) return " top2";
  if (rank === 3) return " top3";
  return "";
}

// Shared by build.js (static) and server.js (local preview) so the two
// never render the leaderboard tables differently - pure HTML rendering
// from already-queried rows, no DB access here.
function racersLeaderboardTable(rows) {
  if (!rows.length) {
    return `<div class="empty">No racer stats synced yet.</div>`;
  }
  const body = rows
    .map((r, i) => {
      const rank = i + 1;
      const tagBg = teamColor(r.team_tag, r.tag_color);
      const accClass = accuracyClass(r.accuracy);
      const accLabel = r.accuracy == null ? "—" : `${r.accuracy}%`;
      return `
        <tr>
          <td><span class="lb-rank${rankBadgeClass(rank)}">${rank}</span></td>
          <td class="racer">
            <span class="avatar" style="background:${avatarColor(r.username)}">${escapeHtml((r.username || "?").slice(0, 1).toUpperCase())}</span>
            ${escapeHtml(r.username)}
            <span class="lb-team-tag" style="background:${tagBg};color:${textOnColor(tagBg)}">${escapeHtml(r.team_tag)}</span>
          </td>
          <td>${r.avg_speed ?? "-"}</td>
          <td>${r.top_speed ?? "-"}</td>
          <td>${r.races ?? "-"}</td>
          <td><span class="pill ${accClass}">${accLabel}</span></td>
        </tr>`;
    })
    .join("");
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>#</th><th>Racer</th><th>Avg speed</th><th>Highest speed</th><th>Lifetime races</th><th>Accuracy</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function teamsLeaderboardTable(rows) {
  if (!rows.length) {
    return `<div class="empty">No team stats synced yet.</div>`;
  }
  const body = rows
    .map((t, i) => {
      const rank = i + 1;
      const bg = teamColor(t.tag, t.tag_color);
      return `
        <tr>
          <td><span class="lb-rank${rankBadgeClass(rank)}">${rank}</span></td>
          <td class="racer">
            <span class="avatar" style="background:${bg};color:${textOnColor(bg)}">${escapeHtml((t.tag || "?").slice(0, 1).toUpperCase())}</span>
            [${escapeHtml(t.tag)}] ${escapeHtml(t.display_name || "")}
          </td>
          <td>${t.avg_speed ?? "-"}</td>
          <td>${t.top_speed ?? "-"}</td>
          <td>${t.total_races ?? "-"}</td>
          <td>${t.racer_count ?? "-"}</td>
        </tr>`;
    })
    .join("");
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>#</th><th>Team</th><th>Avg speed</th><th>Top speed</th><th>Total races</th><th>Racers</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

// Builds the full leaderboards page body (controls + all 8 panels) from
// already-queried rows. Shared so build.js and server.js produce
// identical markup; only the surrounding pageShell() call differs.
function leaderboardsBody(racerRows, teamRows) {
  const panels = [
    leaderboardPanel("racers", "alltime", racersLeaderboardTable(racerRows), true),
    leaderboardPanel("teams", "alltime", teamsLeaderboardTable(teamRows), false),
  ];
  for (const range of LEADERBOARD_RANGES) {
    if (range.built) continue;
    panels.push(leaderboardPanel("racers", range.key, comingSoonLeaderboard(range.label), false));
    panels.push(leaderboardPanel("teams", range.key, comingSoonLeaderboard(range.label), false));
  }
  return `
    <h1>Leaderboards</h1>
    <p class="meta-row">Ranked across every team this tracker follows — not all of Nitro Type.</p>
    ${leaderboardControls()}
    ${panels.join("")}`;
}

const BASE_CSS = `
  :root {
    --bg: #0e1117;
    --panel: #151a23;
    --panel-2: #1b2230;
    --border: #2a3140;
    --text: #f3f5f9;
    --muted: #aab2c0;
    --accent: #3da1ff;
    --good: #3ddc84;
    --ok: #e8c547;
    --low: #ff6b6b;
    --radius: 10px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: "Manrope", -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  header.site {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  header.site .mark {
    width: 28px; height: 28px; border-radius: 8px;
    background: linear-gradient(135deg, #3da1ff, #8a5cff);
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 14px; color: #0b1220;
    flex: none;
  }
  header.site .name { font-weight: 800; font-size: 17px; letter-spacing: 0.2px; margin-right: 10px; }
  header.site .tagline { color: var(--muted); font-size: 13px; margin-left: 4px; }
  .site-nav { display: flex; gap: 4px; margin-left: 6px; }
  .site-nav-link {
    color: var(--muted);
    font-weight: 700;
    font-size: 13.5px;
    padding: 6px 11px;
    border-radius: 7px;
  }
  .site-nav-link:hover { color: var(--text); text-decoration: none; background: var(--panel-2); }
  .site-nav-link.active { color: var(--accent); background: rgba(61,161,255,0.12); }

  main { max-width: 1040px; margin: 0 auto; padding: 28px 20px 60px; }

  .crumb { color: var(--muted); font-size: 13px; margin-bottom: 18px; }

  h1 { font-size: 22px; margin: 0 0 4px; }
  h1 .tag-badge { padding: 2px 9px; border-radius: 6px; font-size: 14px; font-weight: 800; margin-right: 8px; }

  .meta-row {
    display: flex; gap: 22px; flex-wrap: wrap;
    color: var(--muted); font-size: 13px; margin: 10px 0 22px;
  }
  .meta-row strong { color: var(--text); }

  .hero {
    border-radius: var(--radius);
    padding: 22px 24px;
    margin-bottom: 22px;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
  }
  .hero .tag { font-size: 13px; opacity: 0.85; font-weight: 700; letter-spacing: 0.4px; }
  .hero .name { font-size: 26px; font-weight: 800; margin-top: 2px; }
  .hero .sub { margin-top: 10px; font-size: 13px; opacity: 0.9; }
  .hero .meta-stats {
    display: flex; gap: 28px; margin-top: 14px; flex-wrap: wrap;
  }
  .hero .meta-stats .stat { font-size: 12px; opacity: 0.85; }
  .hero .meta-stats .stat b { display: block; font-size: 15px; font-weight: 800; opacity: 1; margin-top: 2px; }

  .req-bar {
    display: flex; gap: 28px; flex-wrap: wrap; align-items: center;
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 20px;
    margin-bottom: 14px;
    font-size: 13px;
  }
  .req-bar .req { color: var(--muted); }
  .req-bar .req b { color: var(--text); font-weight: 700; }

  .special-reqs {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 20px;
    margin-bottom: 22px;
    font-size: 13px;
    color: var(--muted);
  }
  .special-reqs .label {
    text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;
    color: var(--muted); font-weight: 700; margin-bottom: 6px;
  }
  .special-reqs .text { color: var(--text); line-height: 1.5; word-break: break-word; }

  .index-header {
    display: flex; justify-content: space-between; align-items: flex-end;
    flex-wrap: wrap; gap: 12px; margin-bottom: 18px;
  }
  .search-box input {
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 8px;
    padding: 9px 12px;
    font-family: inherit;
    font-size: 13px;
    width: 220px;
  }
  .search-box input:focus { outline: 1px solid var(--accent); }
  .search-box input::placeholder { color: var(--muted); }

  .card .req-line { font-size: 12px; color: var(--muted); }
  .card .req-line b { color: var(--text); }
  .card .view-btn {
    margin-top: 4px;
    display: inline-block;
    background: var(--accent);
    color: #0b1220;
    font-weight: 700;
    font-size: 12.5px;
    padding: 7px 12px;
    border-radius: 8px;
    align-self: flex-start;
  }

  .role-pill {
    display: inline-block;
    font-size: 10.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 1px 6px;
    border-radius: 5px;
    margin-left: 7px;
    vertical-align: middle;
  }
  .role-pill.captain { background: rgba(232,197,71,0.18); color: var(--ok); }
  .role-pill.officer { background: rgba(61,161,255,0.18); color: var(--accent); }
  .role-pill.gold { background: rgba(232,197,71,0.12); color: var(--ok); }

  .team-layout {
    display: flex;
    gap: 20px;
    align-items: flex-start;
  }
  .team-sidebar {
    width: 190px;
    flex: none;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px;
    position: sticky;
    top: 20px;
    display: flex;
    flex-direction: column;
  }
  .team-sidebar .nav-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 10px;
    border-radius: 8px;
    color: var(--text);
    font-size: 13.5px;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .team-sidebar .nav-item:hover { background: var(--panel-2); text-decoration: none; }
  .team-sidebar .nav-item.active { background: rgba(61,161,255,0.15); color: var(--accent); }
  .team-sidebar .nav-icon { font-size: 14px; flex: none; opacity: 0.9; }
  .team-sidebar .soon-tag {
    margin-left: auto;
    font-size: 9px;
    background: rgba(170,178,192,0.15);
    color: var(--muted);
    padding: 2px 6px;
    border-radius: 999px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .team-sidebar .nav-section-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
    font-weight: 700;
    padding: 12px 10px 4px;
  }
  .team-content { flex: 1; min-width: 0; }

  @media (max-width: 760px) {
    .team-layout { flex-direction: column; }
    .team-sidebar {
      width: 100%;
      position: static;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 4px;
    }
    .team-sidebar .nav-section-label { display: none; }
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 14px;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 0.15s ease;
  }
  .card:hover { border-color: var(--accent); }
  .card .top { display: flex; align-items: center; gap: 10px; }
  .card .badge {
    width: 38px; height: 38px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 12px;
    flex: none;
  }
  .card .tag { font-weight: 800; font-size: 14px; }
  .card .display-name { color: var(--muted); font-size: 13px; }
  .card .footer { margin-top: auto; font-size: 11.5px; color: var(--muted); }
  .card a.cover { position: static; }
  .card a.view { align-self: flex-start; font-size: 12.5px; font-weight: 700; }

  .empty {
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    padding: 28px;
    color: var(--muted);
    text-align: center;
    font-size: 14px;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
  }
  table { width: 100%; border-collapse: collapse; min-width: 560px; }
  thead th {
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
    font-weight: 700;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--panel-2);
    position: sticky; top: 0;
  }
  tbody td {
    padding: 11px 14px;
    font-size: 13.5px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) { background: rgba(255,255,255,0.015); }
  tbody tr:hover { background: rgba(61,161,255,0.06); }
  td.racer { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
  .avatar {
    width: 26px; height: 26px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 800; color: #0b1220;
    flex: none;
  }

  .pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
  }
  .pill.good { background: rgba(61,220,132,0.15); color: var(--good); }
  .pill.ok   { background: rgba(232,197,71,0.15); color: var(--ok); }
  .pill.low  { background: rgba(255,107,107,0.15); color: var(--low); }
  .pill.na   { background: rgba(170,178,192,0.12); color: var(--muted); }

  .lb-controls {
    display: flex; justify-content: space-between; align-items: center;
    flex-wrap: wrap; gap: 10px;
    margin-bottom: 18px;
  }
  .seg {
    display: inline-flex;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 3px;
    gap: 2px;
  }
  .seg-btn {
    background: transparent;
    border: none;
    color: var(--muted);
    font-family: inherit;
    font-weight: 700;
    font-size: 12.5px;
    padding: 7px 13px;
    border-radius: 7px;
    cursor: pointer;
  }
  .seg-btn:hover { color: var(--text); }
  .seg-btn.active { background: var(--accent); color: #0b1220; }
  .seg-btn .soon-tag { vertical-align: 1px; }

  .lb-rank {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px; height: 24px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 800;
    background: var(--panel-2);
    color: var(--muted);
  }
  .lb-rank.top1 { background: rgba(232,197,71,0.18); color: var(--ok); }
  .lb-rank.top2 { background: rgba(170,178,192,0.22); color: #d8dee8; }
  .lb-rank.top3 { background: rgba(255,142,96,0.18); color: #ff8e60; }

  .lb-team-tag {
    display: inline-block;
    font-size: 11px;
    font-weight: 800;
    padding: 2px 7px;
    border-radius: 6px;
    margin-left: 8px;
  }

  footer.site {
    text-align: center;
    color: var(--muted);
    font-size: 12px;
    padding: 30px 20px 50px;
  }

  @media (max-width: 560px) {
    main { padding: 20px 14px 50px; }
    .hero .name { font-size: 21px; }
  }
`;

// teamsHref/leaderboardsHref are supplied by the caller because the two
// page builders resolve them completely differently: build.js's static
// pages need a relative path back up to each top-level section (depth
// varies per page), while server.js's Express routes just use fixed
// absolute paths. `active` highlights whichever one the current page is.
function siteHeader({ teamsHref = "./", leaderboardsHref = "leaderboards/", active = "" } = {}) {
  return `
    <header class="site">
      <div class="mark">T</div>
      <div class="name">TypeTrack</div>
      <nav class="site-nav">
        <a class="site-nav-link${active === "teams" ? " active" : ""}" href="${teamsHref}">Teams</a>
        <a class="site-nav-link${active === "leaderboards" ? " active" : ""}" href="${leaderboardsHref}">Leaderboards</a>
      </nav>
    </header>`;
}

function pageShell({ title, body, crumb, teamsHref, leaderboardsHref, active }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>${BASE_CSS}</style>
</head>
<body>
${siteHeader({ teamsHref, leaderboardsHref, active })}
<main>
${crumb ? `<div class="crumb">${crumb}</div>` : ""}
${body}
</main>
<footer class="site">Generated ${new Date().toISOString()}</footer>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  hashHue,
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
  LEADERBOARD_RANGES,
  comingSoonLeaderboard,
  leaderboardPanel,
  leaderboardControls,
  rankBadgeClass,
  leaderboardsBody,
  pageShell,
};
