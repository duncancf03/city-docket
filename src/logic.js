/* City Docket: pure logic (no DOM). Inlined into the page at build time; also loaded by the Node tests. */
"use strict";

const TZ = "America/New_York";

const THEMES = [
  ["urban", "Urbanism & public space"],
  ["housing", "Housing & tenants"],
  ["policy", "Policy & government"],
  ["civic", "Elections & civic life"],
  ["left", "Left politics & organizing"],
  ["labor", "Labor & work"],
  ["solidarity", "International solidarity"],
  ["rights", "Justice & rights"],
  ["academic", "Academic & ideas"],
  ["history", "NYC history"],
  ["architecture", "Architecture & design"],
  ["transit", "Transit & streets"],
  ["environment", "Climate & environment"],
  ["art", "Art & museums"],
  ["literature", "Books & poetry"],
  ["film", "Film"],
  ["performance", "Music & performance"],
];
const THEME_LABEL = Object.fromEntries(THEMES);
const THEME_SHORT = {
  urban: "Urbanism", housing: "Housing", policy: "Policy", civic: "Civic", left: "Left", labor: "Labor",
  solidarity: "Solidarity", rights: "Rights", academic: "Ideas", history: "NYC history", architecture: "Architecture",
  transit: "Transit", environment: "Climate", art: "Art", literature: "Books", film: "Film", performance: "Music & stage",
};
const CATEGORIES = ["Talk", "Panel", "Reading", "Book talk", "Workshop", "Screening", "Film series", "Exhibition", "Performance",
  "Tour", "Public meeting", "Organizing", "Festival", "Social", "Conference", "Date to know"];
const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island", "Online", "Citywide"];
const SOURCE_TYPES = [["website", "Websites"], ["newsletter", "Newsletters"], ["mailing list", "Mailing lists"],
  ["listings", "Listings"], ["government", "Government"], ["you", "Added by you"]];
const FORMATS = ["In person", "Online", "Hybrid"];
// Yes/no features an event can carry. qa: a screening or show with a Q&A, talkback, intro or guest in person.
// indie: an independent venue or organizer (indie bookstore, arthouse cinema, artist-run or community space).
const EXTRAS = [["qa", "Q&A or talkback"], ["indie", "Independent venue"]];

const DEFAULT_WEIGHTS = {
  urban: 3, housing: 3, policy: 3, left: 3, civic: 2, labor: 2, solidarity: 2, rights: 2, academic: 2, history: 2,
  architecture: 2, transit: 2, art: 2, literature: 2, film: 2, performance: 1, environment: 1,
};
function defaultPrefs() {
  return { v: 1, weights: Object.assign({}, DEFAULT_WEIGHTS), cats: {}, home: "Manhattan", preferFree: true,
    hideMuted: true, hideMembers: false, favorQA: true, favorIndie: true, saved: {}, hidden: [] };
}
function mergePrefs(raw) {
  const p = defaultPrefs();
  if (!raw || typeof raw !== "object") return p;
  if (raw.weights && typeof raw.weights === "object") {
    for (const [k] of THEMES) {
      const w = Number(raw.weights[k]);
      if (w >= 0 && w <= 3) p.weights[k] = Math.round(w);
    }
  }
  if (raw.cats && typeof raw.cats === "object") {
    for (const c of CATEGORIES) { const v = Number(raw.cats[c]); if (v === 1 || v === -1) p.cats[c] = v; }
  }
  if (typeof raw.home === "string" && (raw.home === "" || BOROUGHS.includes(raw.home))) p.home = raw.home;
  for (const k of ["preferFree", "hideMuted", "hideMembers", "favorQA", "favorIndie"]) if (typeof raw[k] === "boolean") p[k] = raw[k];
  if (raw.saved && typeof raw.saved === "object" && !Array.isArray(raw.saved)) p.saved = Object.assign({}, raw.saved);
  if (Array.isArray(raw.hidden)) p.hidden = raw.hidden.filter(x => typeof x === "string").slice(-500);
  return p;
}

// Typical length in minutes when a listing gives no end time; 0 = not meaningful.
const EST_MIN = { Talk: 90, Panel: 90, Reading: 90, "Book talk": 75, Workshop: 150, Screening: 120, Performance: 120, Tour: 120,
  "Public meeting": 180, Organizing: 120, Social: 180, Conference: 360, "Date to know": 0, Exhibition: 0,
  Festival: 0, "Film series": 0 };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];

function pad(n) { return String(n).padStart(2, "0"); }

/** Current New York wall-clock time as "YYYY-MM-DDTHH:MM". */
function nowNY(date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date || new Date());
  const g = t => (parts.find(p => p.type === t) || {}).value;
  let h = g("hour"); if (h === "24") h = "00";
  return `${g("year")}-${g("month")}-${g("day")}T${h}:${g("minute")}`;
}
function toUTC(d) { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)); }
function addDays(d, n) { const t = toUTC(d); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function dow(d) { return toUTC(d).getUTCDay(); }
function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
function toMin(hm) { const [h, m] = hm.split(":").map(Number); return h * 60 + m; }
function addMinutes(date, hm, mins) {
  let total = toMin(hm) + mins, d = date;
  while (total >= 1440) { total -= 1440; d = addDays(d, 1); }
  return `${d}T${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
function fmtDate(d, withDow) {
  const [, m, dd] = d.split("-").map(Number);
  return `${withDow === false ? "" : DOW[dow(d)] + " "}${MON[m - 1]} ${dd}`;
}
function fmtTime(hm) {
  if (!hm) return "";
  let [h, m] = hm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return m ? `${h}:${pad(m)} ${ap}` : `${h} ${ap}`;
}
function nowPhrase(now) {
  const d = now.slice(0, 10), [y, m, dd] = d.split("-").map(Number);
  return `${DOW_LONG[dow(d)]}, ${MON_LONG[m - 1]} ${dd}, ${y}, ${fmtTime(now.slice(11, 16))}`;
}
function fold(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function clean(s, n) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n || 200); }
function slugify(s, n) {
  return fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, n || 48).replace(/-+$/, "");
}

/** Adds derived fields used for filtering and display. Never mutates the stored body. */
function normEvent(id, raw) {
  const e = Object.assign({}, raw, { id });
  e.title = clean(e.title, 200) || "Untitled event";
  e.themes = Array.isArray(e.themes) ? e.themes.filter(t => THEME_LABEL[t]) : [];
  if (!CATEGORIES.includes(e.category)) e.category = "Talk";
  if (!FORMATS.includes(e.format)) e.format = "In person";
  const start = String(e.start || ""), end = String(e.end || "");
  e.sd = /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : "1970-01-01";
  e.multi = !!e.multi_day;
  e.st = /T\d\d:\d\d/.test(start) && !e.time_tba ? start.slice(11, 16) : "";
  e.ed = /^\d{4}-\d{2}-\d{2}/.test(end) ? end.slice(0, 10) : (e.multi ? "" : e.sd);
  e.et = /T\d\d:\d\d/.test(end) ? end.slice(11, 16) : "";
  if (e.multi) { e.dur = null; e.durEst = false; }
  else if (e.st && e.et) { e.dur = daysBetween(e.sd, e.ed) * 1440 + toMin(e.et) - toMin(e.st); e.durEst = false; }
  else { e.dur = EST_MIN[e.category] || null; e.durEst = !!e.dur; }
  if (e.multi) e.overKey = e.ed ? e.ed + "T23:59" : "9999-12-31T23:59";
  else if (e.st && e.et) e.overKey = `${e.ed}T${e.et}`;
  else if (e.st) e.overKey = addMinutes(e.sd, e.st, e.dur || 90);
  else e.overKey = e.sd + "T23:59";
  e.startKey = e.st ? `${e.sd}T${e.st}` : `${e.sd}T99:99`;
  e.cost = (typeof e.cost === "number" && isFinite(e.cost)) ? e.cost : null;
  e.qa = e.qa === true; e.indie = e.indie === true;
  e.hay = fold([e.title, e.org, e.venue, e.address, e.neighborhood, e.borough, e.desc, e.category, e.source, e.note,
    e.price, e.qa ? "q&a qa talkback" : "", e.indie ? "indie independent" : ""]
    .concat(e.themes.map(t => THEME_LABEL[t])).join(" "));
  return e;
}

/** Date window for a quick range. Returns {from, to, minTime?, friEvening?}. */
function rangeFor(key, now, from, to) {
  const today = now.slice(0, 10), d = dow(today);
  switch (key) {
    case "today": return { from: today, to: today };
    case "tonight": return { from: today, to: today, minTime: "17:00" };
    case "tomorrow": { const t = addDays(today, 1); return { from: t, to: t }; }
    case "weekend": {
      if (d === 6) return { from: today, to: addDays(today, 1) };
      if (d === 0) return { from: today, to: today };
      const fri = addDays(today, (5 - d + 7) % 7);
      return { from: fri, to: addDays(fri, 2), friEvening: fri };
    }
    case "next7": return { from: today, to: addDays(today, 6) };
    case "next30": return { from: today, to: addDays(today, 29) };
    case "all": return { from: today, to: "9999-12-31" };
    case "custom": {
      const f = /^\d{4}-\d{2}-\d{2}$/.test(from || "") ? from : today;
      const t = /^\d{4}-\d{2}-\d{2}$/.test(to || "") && to >= f ? to : addDays(f, 13);
      return { from: f, to: t };
    }
    default: return { from: today, to: addDays(today, 13) };
  }
}
function inRange(e, r, now) {
  if (e.overKey < now) return false;
  if (e.multi) return e.sd <= r.to && (e.ed === "" || e.ed >= r.from);
  if (e.sd < r.from || e.sd > r.to) return false;
  if (r.minTime && (!e.st || e.st < r.minTime)) return false;
  if (r.friEvening && e.sd === r.friEvening && (!e.st || e.st < "17:00")) return false;
  return true;
}
function todBucket(st) {
  if (!st) return "";
  const h = +st.slice(0, 2);
  return h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "late";
}
function durBucket(e) {
  if (e.multi) return "multi";
  const m = e.dur;
  if (m == null || m <= 0) return "";
  return m <= 90 ? "short" : m <= 180 ? "mid" : "long";
}
function defaultFilters() {
  return { q: "", range: "next14", from: "", to: "", cats: [], themes: [], boroughs: [], tod: [], dur: [],
    price: "any", format: [], org: "", stype: [], extras: [], includeRunning: true, showHidden: false, sort: "soonest" };
}
function facetCount(f) {
  return f.cats.length + f.themes.length + f.boroughs.length + f.tod.length + f.dur.length + f.format.length +
    f.stype.length + f.extras.length + (f.price !== "any" ? 1 : 0) + (f.org ? 1 : 0) + (f.includeRunning ? 0 : 1) + (f.showHidden ? 1 : 0);
}
function isMuted(e, prefs, f) {
  const w = prefs.weights || DEFAULT_WEIGHTS;
  if ((prefs.cats || {})[e.category] === -1 && !(f && f.cats.includes(e.category))) return true;
  if (f && f.themes.length) return false;
  const ws = e.themes.map(t => (t in w ? w[t] : 1));
  return ws.length > 0 && Math.max.apply(null, ws) === 0;
}
function matches(e, f, prefs, now, r) {
  if (!inRange(e, r, now)) return false;
  if (!f.includeRunning && e.multi) return false;
  if (!f.showHidden && (prefs.hidden || []).includes(e.id)) return false;
  if (e.status && e.status !== "active") return false;
  if (f.q) {
    const terms = fold(f.q).split(/\s+/).filter(Boolean);
    if (!terms.every(t => e.hay.includes(t))) return false;
  }
  if (f.cats.length && !f.cats.includes(e.category)) return false;
  if (f.themes.length && !e.themes.some(t => f.themes.includes(t))) return false;
  if (f.boroughs.length && !f.boroughs.includes(e.borough)) return false;
  if (f.tod.length && !f.tod.includes(todBucket(e.st))) return false;
  if (f.dur.length && !f.dur.includes(durBucket(e))) return false;
  if (f.price === "free" && e.cost !== 0) return false;
  if (f.price === "u15" && !(e.cost !== null && e.cost <= 15)) return false;
  if (f.format.length && !f.format.includes(e.format)) return false;
  if (f.org && e.org !== f.org) return false;
  if (f.stype.length && !f.stype.includes(e.source_type)) return false;
  if (f.extras.length && !f.extras.every(x => e[x] === true)) return false;
  if (prefs.hideMembers && e.members_only) return false;
  if (prefs.hideMuted && !f.q && isMuted(e, prefs, f)) return false;
  return true;
}

/** Interest fit, roughly 0-5. Hearings and deadlines start a little lower because they are frequent and routine. */
const CATEGORY_PRIOR = { "Public meeting": -0.5, "Date to know": -0.3 };
function fitScore(e, prefs) {
  const w = prefs.weights || DEFAULT_WEIGHTS;
  const ws = e.themes.map(t => (t in w ? w[t] : 1)).sort((a, b) => b - a);
  let s = ws.length ? ws[0] + 0.35 * (ws[1] || 0) + 0.15 * (ws[2] || 0) : 0.5;
  s += (CATEGORY_PRIOR[e.category] || 0) + ((prefs.cats || {})[e.category] || 0) * 0.8;
  if (e.cost === 0) s += prefs.preferFree ? 0.25 : 0.05;
  else if (prefs.preferFree && e.cost != null && e.cost > 20) s -= 0.3;
  if (e.members_only) s -= 0.8;
  if (e.waitlist) s -= 0.4;
  if (prefs.home && e.borough === prefs.home) s += 0.15;
  if (e.qa && prefs.favorQA) s += 0.2;
  if (e.indie && prefs.favorIndie) s += 0.15;
  return Math.round(s * 100) / 100;
}
function fitLevel(s) { return s >= 4.35 ? 5 : s >= 3.8 ? 4 : s >= 3.0 ? 3 : s >= 2.0 ? 2 : s > 0.8 ? 1 : 0; }
const FIT_WORDS = ["Muted topic", "Slight fit", "Some fit", "Good fit", "Strong fit", "Top fit"];
function fitReasons(e, prefs) {
  const w = prefs.weights || DEFAULT_WEIGHTS;
  return e.themes.filter(t => (t in w ? w[t] : 1) >= 2).sort((a, b) => w[b] - w[a]).map(t => THEME_SHORT[t]);
}

function compareSoonest(a, b) {
  if (a.startKey !== b.startKey) return a.startKey < b.startKey ? -1 : 1;
  return a.title < b.title ? -1 : 1;
}
function search(events, f, prefs, now) {
  const r = rangeFor(f.range, now, f.from, f.to);
  const list = events.filter(e => matches(e, f, prefs, now, r));
  for (const e of list) { e.score = fitScore(e, prefs); e.level = fitLevel(e.score); }
  const single = list.filter(e => !e.multi), running = list.filter(e => e.multi);
  if (f.sort === "fit") single.sort((a, b) => (b.score - a.score) || compareSoonest(a, b));
  else single.sort(compareSoonest);
  running.sort((a, b) => (b.score - a.score) || ((a.ed || "9999") < (b.ed || "9999") ? -1 : 1));
  return { range: r, single, running, total: list.length };
}
function groupByDay(list) {
  const out = [];
  for (const e of list) {
    const last = out[out.length - 1];
    if (last && last.day === e.sd) last.items.push(e); else out.push({ day: e.sd, items: [e] });
  }
  return out;
}
function relDay(d, today) {
  const n = daysBetween(today, d);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n > 1 && n < 7) return "This " + DOW_LONG[dow(d)];
  return "";
}

// ---------------------------------------------------------------- Ask (prompt search)
function eventLine(ref, e) {
  const when = e.multi
    ? `RUNS ${e.sd}${e.ed ? " to " + e.ed : " (no end date)"}`
    : `${DOW[dow(e.sd)]} ${e.sd} ${e.st ? e.st + (e.et && e.ed === e.sd ? "-" + e.et : "") : "time TBA"}`;
  const where = [e.venue, e.neighborhood, e.borough].filter(Boolean).join(", ").slice(0, 90);
  const flags = [e.qa && "Q&A/talkback", e.indie && "independent venue", e.rsvp && "RSVP",
    e.members_only && "members only", e.waitlist && "waitlist",
    e.format !== "In person" && e.format.toLowerCase()].filter(Boolean).join("; ");
  return [ref, when, e.title.slice(0, 110), where, e.category, e.themes.join(","), clean(e.price, 40), flags].join(" | ");
}
function dateHelpers(now) {
  const today = now.slice(0, 10), d = dow(today);
  const fri = addDays(today, (5 - d + 7) % 7);
  const sat = d === 0 ? addDays(today, -1) : addDays(today, (6 - d + 7) % 7);
  const nextMon = addDays(today, ((1 - d + 7) % 7) || 7);
  return `today = ${today} (${DOW[d]}); tomorrow = ${addDays(today, 1)}; this Friday = ${fri}; ` +
    `this weekend = ${sat} to ${addDays(sat, 1)}; next week = ${nextMon} to ${addDays(nextMon, 6)}`;
}
function interestsLine(prefs) {
  const w = prefs.weights || DEFAULT_WEIGHTS;
  const parts = THEMES.map(([k, l]) => `${l} ${w[k]}`);
  const boosted = CATEGORIES.filter(c => (prefs.cats || {})[c] === 1);
  const muted = CATEGORIES.filter(c => (prefs.cats || {})[c] === -1);
  let s = parts.join("; ");
  if (boosted.length) s += `\nEvent types they like most: ${boosted.join(", ")}.`;
  if (muted.length) s += `\nEvent types they don't want: ${muted.join(", ")}.`;
  const likes = [prefs.favorQA && "screenings and shows with a Q&A, talkback or guest in person",
    prefs.favorIndie && "independent bookstores, arthouse cinemas and community or artist-run spaces"].filter(Boolean);
  if (likes.length) s += `\nThey especially like ${likes.join(", and ")}.`;
  return s;
}
function askPool(events, prefs, now) {
  const today = now.slice(0, 10), horizon = addDays(today, 90);
  const hidden = new Set(prefs.hidden || []);
  return events.filter(e => e.overKey >= now && !hidden.has(e.id) && (!e.status || e.status === "active") &&
    (e.multi ? e.sd <= horizon : e.sd <= horizon)).sort(compareSoonest);
}
const ASK_BYTES = 80000;
function buildAskPrompt(q, pool, prefs, now) {
  const head =
`You help one person in New York City pick events from their personal events database, City Docket.

Right now it is ${nowPhrase(now)} in New York.
Date helpers: ${dateHelpers(now)}.

What they care about (0 = not interested, 3 = very interested):
${interestsLine(prefs)}
Home base: ${prefs.home || "anywhere in NYC"}.${prefs.preferFree ? " They prefer free or cheap events." : ""}

Events, one per line: ref | when | title | where | type | topics | price | notes
`;
  const rules =
`
Rules:
- Use only events from this list and refer to them by ref.
- Read dates against "right now". "Evening" means starting at 5 PM or later; "tonight" means today from 5 PM.
- A line marked RUNS is open across a date range (festival, film series, exhibition, play). Suggest it only when it fits the ask.
- Rank by how well each event answers the question, then by their interests. Skip anything already over.

Reply with only JSON in this shape:
{"interpretation": "one short line restating what you looked for, with actual dates", "picks": [{"ref": "r12", "why": "one concrete sentence, 22 words max"}], "also": [{"ref": "r40", "why": "..."}], "note": "optional one-line tip, or empty string"}
Give up to 6 picks and up to 6 in "also". If nothing fits, return empty lists and use "note" to say what comes closest.

Question: ${q}`;
  const enc = s => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length);
  // Everything in the pool goes in when it fits. When it doesn't, the weakest fits are left out first
  // (later dates before sooner ones), so the whole date range stays covered.
  const items = pool.map(e => ({ e, score: fitScore(e, prefs), b: enc(eventLine("r0000", e)) + 1 }));
  let total = items.reduce((n, x) => n + x.b, 0);
  const room = ASK_BYTES - enc(head) - enc(rules);
  const drop = new Set();
  if (total > room) {
    const weakest = items.slice().sort((a, b) => (a.score - b.score) || (a.e.sd < b.e.sd ? 1 : a.e.sd > b.e.sd ? -1 : 0));
    for (const x of weakest) { if (total <= room) break; drop.add(x); total -= x.b; }
  }
  const refs = new Map(), lines = [];
  for (const x of items) {
    if (drop.has(x)) continue;
    const ref = "r" + (lines.length + 1);
    lines.push(eventLine(ref, x.e)); refs.set(ref, x.e.id);
  }
  return { text: head + lines.join("\n") + "\n" + rules, refs, count: lines.length, left: drop.size };
}
function cleanAsk(data, refs) {
  const d = data && typeof data === "object" ? data : {};
  const pick = arr => (Array.isArray(arr) ? arr : []).map(p => ({
    id: refs.get(String(p && p.ref || "").trim()), why: clean(p && p.why, 240),
  })).filter(p => p.id);
  const seen = new Set();
  const dedupe = arr => arr.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  return { interpretation: clean(d.interpretation, 240), picks: dedupe(pick(d.picks)).slice(0, 8),
    also: dedupe(pick(d.also)).slice(0, 8), note: clean(d.note, 300) };
}

// ---------------------------------------------------------------- newsletter intake
function buildExtractPrompt(text, sourceName, now) {
  const year = now.slice(0, 4);
  return `Extract the events from the text below for City Docket, a personal database of New York City events.
Right now it is ${nowPhrase(now)} in New York. Dates without a year are in ${year}, unless that date has already passed this year by more than a month, in which case use the next year. Skip events that are already over, ads, fundraising appeals and anything without a date.

Return only a JSON array. Each item:
{"title": "event name", "org": "who is hosting", "venue": "place name", "address": "street address or empty",
 "borough": "one of Manhattan, Brooklyn, Queens, Bronx, Staten Island, Online, Citywide, or empty if unclear",
 "neighborhood": "or empty", "start": "YYYY-MM-DDTHH:MM (24-hour New York time), or YYYY-MM-DD if no time is given",
 "end": "same formats, or empty", "multi_day": true only for things open across several days (exhibition, festival, series, run of a play),
 "time_tba": true if no start time is given,
 "category": "one of ${CATEGORIES.join(", ")}",
 "themes": ["1 to 4 of: ${THEMES.map(([k, l]) => `${k} (${l})`).join(", ")}"],
 "price": "short text such as Free, $10, Sliding scale, or empty", "cost": general admission as a number (0 if free, null if unknown),
 "rsvp": true if registration or tickets are needed, "format": "In person, Online or Hybrid",
 "qa": true only for a screening, performance or show that includes a Q&A, talkback, intro or filmmaker/artist in person,
 "indie": true if the venue or organizer is independent (indie bookstore, arthouse cinema, artist-run or community space, small press or small nonprofit), false for major institutions and chains,
 "url": "the event's own link from the text, or empty", "desc": "one sentence in your own words, 30 words max"}
If there are no events, return [].

Source: ${clean(sourceName, 120) || "pasted text"}
Text:
"""
${text}
"""`;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
function normalizeExtracted(arr, now) {
  const out = [];
  for (const r of Array.isArray(arr) ? arr : []) {
    if (!r || typeof r !== "object") continue;
    const title = clean(r.title, 160);
    let start = clean(r.start, 16);
    if (!title || !DATE_RE.test(start)) continue;
    let end = clean(r.end, 16);
    if (end && (!DATE_RE.test(end) || end < start)) end = "";
    const multi = r.multi_day === true;
    const themes = (Array.isArray(r.themes) ? r.themes : []).map(t => String(t).trim().toLowerCase())
      .filter(t => THEME_LABEL[t]).slice(0, 4);
    const ev = {
      title, org: clean(r.org, 120), venue: clean(r.venue, 140), address: clean(r.address, 160),
      borough: BOROUGHS.includes(r.borough) ? r.borough : "", neighborhood: clean(r.neighborhood, 60),
      start, end, time_tba: !multi && (!start.includes("T") || r.time_tba === true), multi_day: multi,
      category: CATEGORIES.includes(r.category) ? r.category : "Talk", themes,
      price: clean(r.price, 80), cost: typeof r.cost === "number" && isFinite(r.cost) && r.cost >= 0 ? r.cost : null,
      format: FORMATS.includes(r.format) ? r.format : "In person", rsvp: r.rsvp === true,
      members_only: false, waitlist: false, qa: r.qa === true, indie: r.indie === true,
      url: /^https?:\/\/\S+$/i.test(String(r.url || "").trim()) ? String(r.url).trim().slice(0, 600) : "",
      desc: clean(r.desc, 300), note: "", recurring: "",
    };
    if (normEvent("probe", ev).overKey < now) continue;
    out.push(ev);
  }
  return out;
}
function eventKey(title, sd) { return fold(title).replace(/[^a-z0-9]/g, "").slice(0, 40) + "|" + sd; }
function makeId(e, taken) {
  const base = e.start.slice(0, 10).replace(/-/g, "") + "-" + (slugify(e.title) || "event");
  let id = base, i = 2;
  while (taken.has(id)) id = `${base}-${i++}`;
  return id;
}

// ---------------------------------------------------------------- calendar export
function place(e) {
  const b = e.borough && !["Online", "Citywide"].includes(e.borough) ? e.borough + ", NY" : "";
  return [e.venue, e.address, b].filter(Boolean).join(", ");
}
function endKeyOf(e) { return e.et ? `${e.ed}T${e.et}` : addMinutes(e.sd, e.st, e.dur || 90); }
function compactKey(k) { return k.replace(/-/g, "").replace(":", "") + "00"; }
function gcalUrl(e) {
  let dates;
  if (e.multi || !e.st) {
    const last = e.multi ? (e.ed || e.sd) : e.sd;
    dates = e.sd.replace(/-/g, "") + "/" + addDays(last, 1).replace(/-/g, "");
  } else {
    dates = compactKey(`${e.sd}T${e.st}`) + "/" + compactKey(endKeyOf(e));
  }
  const p = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates,
    details: [e.desc, e.url].filter(Boolean).join("\n\n"), location: place(e), ctz: TZ });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}
function csvCell(v) { const s = String(v == null ? "" : v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function mdy(d) { const [y, m, dd] = d.split("-"); return `${m}/${dd}/${y}`; }
function ampm(hm) { let [h, m] = hm.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${pad(h)}:${pad(m)} ${ap}`; }
function buildCSV(list) {
  const head = ["Subject", "Start Date", "Start Time", "End Date", "End Time", "All Day Event", "Description", "Location", "Private"];
  const rows = list.map(e => {
    const allDay = e.multi || !e.st;
    const end = allDay ? (e.multi ? (e.ed || e.sd) : e.sd) : endKeyOf(e).slice(0, 10);
    return [e.title, mdy(e.sd), allDay ? "" : ampm(e.st), mdy(end), allDay ? "" : ampm(endKeyOf(e).slice(11, 16)),
      allDay ? "True" : "False", [e.desc, e.url].filter(Boolean).join(" "), place(e), "False"];
  });
  return [head].concat(rows).map(r => r.map(csvCell).join(",")).join("\r\n");
}
function snapshotOf(e) {
  const keep = ["title", "org", "venue", "address", "borough", "neighborhood", "start", "end", "time_tba", "multi_day",
    "category", "themes", "price", "cost", "format", "url", "desc", "qa", "indie"];
  const o = {}; for (const k of keep) if (e[k] !== undefined) o[k] = e[k];
  return o;
}

if (typeof module !== "undefined") {
  module.exports = { TZ, THEMES, THEME_LABEL, THEME_SHORT, CATEGORIES, BOROUGHS, SOURCE_TYPES, FORMATS, EXTRAS, DEFAULT_WEIGHTS,
    defaultPrefs, mergePrefs, nowNY, addDays, dow, daysBetween, addMinutes, fmtDate, fmtTime, nowPhrase, fold, clean,
    slugify, normEvent, rangeFor, inRange, todBucket, durBucket, defaultFilters, facetCount, isMuted, matches, fitScore,
    fitLevel, FIT_WORDS, fitReasons, search, groupByDay, relDay, eventLine, dateHelpers, askPool, buildAskPrompt,
    cleanAsk, buildExtractPrompt, normalizeExtracted, eventKey, makeId, gcalUrl, buildCSV, snapshotOf };
}
