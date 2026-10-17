#!/usr/bin/env node
/* Turns a dump of the City Docket database into the public site's data files.

     node tools/export.js <dump-dir> [--out <site-dir>] [--force]

   <dump-dir> holds events/<id>.json, sources/<id>.json and meta/status.json, which is what ArtifactData
   list/get write with out_dir. Writes data/events.json, data/sources.json, data/meta.json and calendar/picks.ics
   under <site-dir> (default: the repository root).

   Only public listings go out: events that came from member mailing lists or exist only inside a subscriber
   email are left out, private group sources are dropped, inbox and sender details never leave the database,
   and redirect or tracking links are removed. It refuses to write when the event count falls by more than half
   compared with the last export (an incomplete dump), unless --force is given. */
"use strict";
const fs = require("fs");
const path = require("path");
const L = require(path.join(__dirname, "..", "src", "logic.js"));

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const dump = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
const out = path.resolve(opt("--out") || path.join(__dirname, ".."));
const force = args.includes("--force");
if (!dump) { console.error("usage: node tools/export.js <dump-dir> [--out <site-dir>] [--force]"); process.exit(2); }

const EVENT_FIELDS = ["title", "org", "venue", "address", "borough", "neighborhood", "start", "end", "time_tba", "multi_day",
  "category", "themes", "price", "cost", "format", "rsvp", "members_only", "waitlist", "qa", "indie", "url", "desc", "note",
  "recurring", "source", "source_type", "source_url", "added"];
const SOURCE_FIELDS = ["name", "kind", "venue_type", "themes", "url", "signup", "cadence", "notes", "added"];
const META_FIELDS = ["updated", "window_start", "window_end", "last_discovery", "new_sources"];
const PRIVATE_SOURCE_TYPES = new Set(["mailing list"]);       // member lists: their events stay in the private docket
const SUBSCRIBER_ONLY_HOSTS = new Set(["nonsensenyc.com"]);   // listings that live only inside the email
const REDIRECT_HOSTS = new Set(["bit.ly", "tinyurl.com", "t.co", "ow.ly", "buff.ly", "lnkd.in", "rebrand.ly", "shorturl.at",
  "cutt.ly", "mailchi.mp", "list-manage.com", "click.convertkit-mail.com"]);
const TRACKING_PARAMS = /^(utm_|mc_|fbclid$|gclid$|_hsenc$|_hsmi$|mkt_tok$|ck_subscriber_id$|vero_|oly_|rb_clickid$|s_cid$)/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

function readDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort().map(f => {
    const body = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    return Object.assign({}, body, { id: f.slice(0, -5) });
  });
}
function host(u) { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return ""; } }
function cleanUrl(u, notes) {
  const s = String(u || "").trim();
  if (!/^https?:\/\/\S+$/i.test(s)) return "";
  let url;
  try { url = new URL(s); } catch (e) { return ""; }
  const h = url.hostname.replace(/^www\./, "").toLowerCase();
  if (REDIRECT_HOSTS.has(h) || [...REDIRECT_HOSTS].some(r => h.endsWith("." + r)) || /\/redirect\b/.test(url.pathname)) {
    if (notes) notes.push(s);
    return "";
  }
  for (const k of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) url.searchParams.delete(k);
  return url.toString();
}
function pick(o, fields) { const r = { id: o.id }; for (const k of fields) if (o[k] !== undefined) r[k] = o[k]; return r; }
function scrubNotes(s) {
  return String(s || "").split(/(?<=[.!?])\s+/).filter(x => x && !/gmail|inbox|\bpaste/i.test(x)).join(" ").trim();
}

// ---------------------------------------------------------------- read the dump
const rawEvents = readDir(path.join(dump, "events"));
const rawSources = readDir(path.join(dump, "sources"));
const metaFile = path.join(dump, "meta", "status.json");
const rawMeta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : {};
if (!rawEvents.length) { console.error(`export: no events found under ${path.join(dump, "events")}`); process.exit(1); }

// ---------------------------------------------------------------- sources
const privateSources = new Set();
const sources = [];
for (const s of rawSources) {
  if (s.tracked === false) continue;
  if (/^list:/i.test(String(s.sender || ""))) { privateSources.add(s.name); continue; } // private group lists
  const o = pick(s, SOURCE_FIELDS);
  o.url = cleanUrl(o.url); o.signup = cleanUrl(o.signup);
  o.notes = scrubNotes(o.notes);
  if (!o.name || !o.url) continue;
  sources.push(o);
}
sources.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));

// ---------------------------------------------------------------- events
const dropped = { private: 0, invalid: 0, links: [] };
const events = [];
for (const e of rawEvents) {
  if (e.status && e.status !== "active") continue;
  if (PRIVATE_SOURCE_TYPES.has(e.source_type) || privateSources.has(e.source)) { dropped.private++; continue; }
  if (SUBSCRIBER_ONLY_HOSTS.has(host(e.url))) { dropped.private++; continue; }
  if (!e.title || !DATE_RE.test(String(e.start || "")) || (e.end && !DATE_RE.test(String(e.end)))) { dropped.invalid++; continue; }
  const o = pick(e, EVENT_FIELDS);
  o.url = cleanUrl(o.url, dropped.links);
  o.source_url = cleanUrl(o.source_url, dropped.links);
  events.push(o);
}
events.sort((a, b) => (a.start === b.start ? (a.id < b.id ? -1 : 1) : a.start < b.start ? -1 : 1));

// ---------------------------------------------------------------- sanity check against the last export
const eventsFile = path.join(out, "data", "events.json");
if (fs.existsSync(eventsFile) && !force) {
  let before = 0;
  try { before = (JSON.parse(fs.readFileSync(eventsFile, "utf8")).events || []).length; } catch (e) { before = 0; }
  if (before && events.length < before * 0.5) {
    console.error(`export: refusing to publish ${events.length} events (last export had ${before}). The dump may be incomplete; re-dump, or pass --force if the drop is real.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- write data files
const now = L.nowNY();
function writeLines(file, head, key, list) {
  const body = list.map(o => JSON.stringify(o)).join(",\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `{${JSON.stringify(head).slice(1, -1)},${JSON.stringify(key)}:[\n${body}\n]}\n`);
}
writeLines(eventsFile, { generated: now, count: events.length }, "events", events);
writeLines(path.join(out, "data", "sources.json"), { generated: now, count: sources.length }, "sources", sources);
const meta = {};
for (const k of META_FIELDS) if (rawMeta[k] !== undefined) meta[k] = rawMeta[k];
Object.assign(meta, { event_count: events.length, source_count: sources.length, published: now });
fs.writeFileSync(path.join(out, "data", "meta.json"), JSON.stringify(meta, null, 2) + "\n");

// ---------------------------------------------------------------- calendar feed: top picks + civic deadlines
const prefs = L.defaultPrefs();
const keepFrom = L.addDays(now.slice(0, 10), -14) + "T00:00";
const norm = events.map(e => L.normEvent(e.id, e));
const picks = norm.filter(e => {
  if (e.overKey < keepFrom || e.members_only) return false;
  const lvl = L.fitLevel(L.fitScore(e, prefs));
  if (e.category === "Date to know") return lvl >= 1;
  return !e.multi && lvl >= 5;
}).sort((a, b) => (a.startKey < b.startKey ? -1 : 1));

const icsText = s => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function foldLine(line) {
  const parts = []; let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (parts.length ? 74 : 75)) { parts.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const compact = k => k.replace(/-/g, "").replace(":", "") + "00";
const lines = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//City Docket//Top picks//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  "X-WR-CALNAME:City Docket: top picks",
  "X-WR-CALDESC:Strongest-fit NYC talks\\, hearings\\, readings\\, screenings and actions\\, plus civic deadlines. Updated every Sunday.",
  "X-WR-TIMEZONE:America/New_York", "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H",
  "BEGIN:VTIMEZONE", "TZID:America/New_York",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
];
for (const e of picks) {
  const allDay = e.multi || !e.st;
  const startLine = allDay ? `DTSTART;VALUE=DATE:${e.sd.replace(/-/g, "")}` : `DTSTART;TZID=America/New_York:${compact(`${e.sd}T${e.st}`)}`;
  const last = e.multi ? (e.ed || e.sd) : e.sd;
  const endKey = e.et ? `${e.ed}T${e.et}` : L.addMinutes(e.sd, e.st || "00:00", e.dur || 90);
  const endLine = allDay ? `DTEND;VALUE=DATE:${L.addDays(last, 1).replace(/-/g, "")}` : `DTEND;TZID=America/New_York:${compact(endKey)}`;
  const facts = [e.category, e.org, e.price, e.format !== "In person" ? e.format : "", e.rsvp ? "Registration or tickets needed" : "",
    e.waitlist ? "Waitlist" : "", e.qa ? "Q&A or guest in person" : ""].filter(Boolean).join(" · ");
  const desc = [e.desc, facts, e.note, e.url ? `Listing: ${e.url}` : "", e.source ? `Found via ${e.source}` : ""].filter(Boolean).join("\n\n");
  const ev = ["BEGIN:VEVENT", `UID:${e.id}@city-docket`, `DTSTAMP:${stamp}`, startLine, endLine, `SUMMARY:${icsText(e.title)}`];
  const boro = e.borough && !["Online", "Citywide"].includes(e.borough) ? e.borough + ", NY" : "";
  const where = [e.venue, e.address, boro].filter(Boolean).join(", ");
  if (where) ev.push(`LOCATION:${icsText(where)}`);
  ev.push(`DESCRIPTION:${icsText(desc)}`);
  if (e.url) ev.push(`URL:${e.url}`);
  ev.push(`CATEGORIES:${icsText(e.category)}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  lines.push(...ev);
}
lines.push("END:VCALENDAR");
fs.mkdirSync(path.join(out, "calendar"), { recursive: true });
fs.writeFileSync(path.join(out, "calendar", "picks.ics"), lines.map(foldLine).join("\r\n") + "\r\n");

// ---------------------------------------------------------------- report
const upcoming = norm.filter(e => e.overKey >= now).length;
console.log(`export: ${events.length} events (${upcoming} upcoming), ${sources.length} sources, ${picks.length} calendar picks.`);
console.log(`export: left out ${dropped.private} private-list events and ${dropped.invalid} malformed ones; skipped ${privateSources.size} private source(s).`);
if (dropped.links.length) console.log(`export: removed ${dropped.links.length} redirect link(s) from the public copy: ${dropped.links.join(" ")}`);
