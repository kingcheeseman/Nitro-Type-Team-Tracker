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

function teamGradient(tag) {
  const hue = hashHue(tag);
  return `linear-gradient(135deg, hsl(${hue} 70% 42%), hsl(${(hue + 40) % 360} 70% 30%))`;
}

function teamBadgeColor(tag) {
  const hue = hashHue(tag);
  return `hsl(${hue} 85% 65%)`;
}

// Bucket accuracy into a color class the same way a tier badge would -
// quick visual signal without requiring the viewer to read every number.
function accuracyClass(accuracy) {
  if (accuracy == null) return "na";
  if (accuracy >= 95) return "good";
  if (accuracy >= 90) return "ok";
  return "low";
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
  header.site .name { font-weight: 800; font-size: 17px; letter-spacing: 0.2px; }
  header.site .tagline { color: var(--muted); font-size: 13px; margin-left: 4px; }

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
    color: #fff;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
  }
  .hero .tag { font-size: 13px; opacity: 0.85; font-weight: 700; letter-spacing: 0.4px; }
  .hero .name { font-size: 26px; font-weight: 800; margin-top: 2px; }
  .hero .sub { margin-top: 10px; font-size: 13px; opacity: 0.9; }

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
    font-weight: 800; font-size: 12px; color: #0b1220;
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

function siteHeader() {
  return `
    <header class="site">
      <div class="mark">N</div>
      <div class="name">Nitro Tracker</div>
      <div class="tagline">multi-team stats</div>
    </header>`;
}

function pageShell({ title, body, crumb }) {
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
${siteHeader()}
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
  teamGradient,
  teamBadgeColor,
  accuracyClass,
  pageShell,
};
