// Team event calendar - see data/events.json for why this is a curated
// file instead of something synced from Nitro Type: NT doesn't publish a
// per-team event/tournament schedule the way its season dates are public,
// so (unlike everything else on this site) these are entered by hand.
// Read fresh every call rather than cached, since it's a small file and
// both build.js (one process per build) and server.js (long-running, so a
// git pull updating this file should show up without a restart) read it.
const fs = require("fs");
const path = require("path");

const EVENTS_FILE = path.join(__dirname, "..", "data", "events.json");

function loadAllEvents() {
  let raw;
  try {
    raw = fs.readFileSync(EVENTS_FILE, "utf8");
  } catch (err) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch (err) {
    console.error(`Could not parse ${EVENTS_FILE}: ${err.message}`);
    return [];
  }
}

// Pending (hasn't started), Active (happening now), or Ended - computed
// fresh against the current time rather than stored, so it's always
// accurate as of whenever the page was generated/requested.
function eventStatus(ev, now = new Date()) {
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  if (now < start) return "pending";
  if (now > end) return "ended";
  return "active";
}

// Events that apply to a given team tag, newest-starting first - matches
// the order Startrack's own Events table uses.
function eventsForTeam(tag) {
  const now = new Date();
  return loadAllEvents()
    .filter((ev) => Array.isArray(ev.teams) && ev.teams.includes(tag))
    .map((ev) => ({ ...ev, status: eventStatus(ev, now) }))
    .sort((a, b) => new Date(b.start) - new Date(a.start));
}

module.exports = { loadAllEvents, eventsForTeam, eventStatus };
