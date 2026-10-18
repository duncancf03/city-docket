#!/usr/bin/env python3
"""City Docket: turn a database dump into the public site's files.

usage: python3 publish.py <dump-dir> <site-dir> [--force]

Reads <dump-dir>/events/*.json, <dump-dir>/sources/*.json and <dump-dir>/meta/status.json (what ArtifactData writes
with out_dir) and writes data/events.json, data/sources.json, data/meta.json and calendar/picks.ics under <site-dir>.
Public listings only: no mailing-list events, no subscriber-only listings, no private group sources, no inbox or
sender details, no redirect or tracking links, and no sentence that mentions Gmail, an inbox or a passcode. Refuses to
write if the event count falls below half of the last export (an incomplete dump) unless --force is given. Python
standard library only.
"""
import datetime, glob, json, math, os, re, sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

EVENT_FIELDS = ["title", "org", "venue", "address", "borough", "neighborhood", "start", "end", "time_tba", "multi_day",
                "category", "themes", "price", "cost", "format", "rsvp", "members_only", "waitlist", "qa", "indie", "url",
                "desc", "note", "recurring", "source", "source_type", "source_url", "added"]
SOURCE_FIELDS = ["name", "kind", "venue_type", "themes", "url", "signup", "cadence", "notes", "added"]
META_FIELDS = ["updated", "window_start", "window_end", "last_discovery", "new_sources"]
SUBSCRIBER_ONLY_HOSTS = {"nonsensenyc.com"}
REDIRECT_HOSTS = {"bit.ly", "tinyurl.com", "t.co", "ow.ly", "buff.ly", "lnkd.in", "rebrand.ly", "shorturl.at", "cutt.ly",
                  "mailchi.mp", "list-manage.com", "click.convertkit-mail.com", "mail.google.com", "mlsend.com",
                  "safelinks.protection.outlook.com"}
TRACKING = re.compile(r"^(utm_|mc_|fbclid$|gclid$|_hsenc$|_hsmi$|mkt_tok$|ck_subscriber_id$|vero_|oly_|rb_clickid$|s_cid$|pwd$)", re.I)
PRIVATE = re.compile(r"gmail|inbox|\bpaste|pass ?code|password|meeting id", re.I)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$")
# Default interests, the same as the page's (src/logic.js).
WEIGHTS = {"urban": 3, "housing": 3, "policy": 3, "left": 3, "civic": 2, "labor": 2, "solidarity": 2, "rights": 2,
           "academic": 2, "history": 2, "architecture": 2, "transit": 2, "art": 2, "literature": 2, "film": 2,
           "performance": 1, "environment": 1}
EST_MIN = {"Talk": 90, "Panel": 90, "Reading": 90, "Book talk": 75, "Workshop": 150, "Screening": 120, "Performance": 120,
           "Tour": 120, "Public meeting": 180, "Organizing": 120, "Social": 180, "Conference": 360}
PRIOR = {"Public meeting": -0.5, "Date to know": -0.3}


def load(folder):
    items = []
    for path in sorted(glob.glob(os.path.join(folder, "*.json"))):
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        doc["id"] = os.path.basename(path)[:-5]
        items.append(doc)
    return items


def host(u):
    try:
        h = (urlsplit(u).hostname or "").lower()
    except ValueError:
        return ""
    return h[4:] if h.startswith("www.") else h


def clean_url(u, dropped):
    u = str(u or "").strip()
    if not re.match(r"^https?://\S+$", u, re.I):
        return ""
    h, parts = host(u), urlsplit(u)
    if h in REDIRECT_HOSTS or any(h.endswith("." + r) for r in REDIRECT_HOSTS) or re.match(r"sendib\w*\.com$", h) \
            or re.search(r"/redirect\b", parts.path):
        dropped.append(u)
        return ""
    query = parse_qsl(parts.query, keep_blank_values=True)
    kept = [(k, v) for k, v in query if not TRACKING.match(k)]
    return u if len(kept) == len(query) else urlunsplit(parts._replace(query=urlencode(kept)))


def scrub(text, hits=None):
    parts = [p for p in re.split(r"(?<=[.!?])\s+", str(text or "")) if p]
    keep = [p for p in parts if not PRIVATE.search(p)]
    if hits is not None and len(keep) < len(parts):
        hits.append(1)
    return " ".join(keep).strip()


def number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def add_minutes(day, hm, mins):
    t = datetime.datetime.strptime(f"{day}T{hm}", "%Y-%m-%dT%H:%M") + datetime.timedelta(minutes=mins)
    return t.strftime("%Y-%m-%dT%H:%M")


def add_days(day, n):
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=n)).isoformat()


def timing(e):
    """Start/end pieces the way the page derives them (normEvent in src/logic.js)."""
    start, end = str(e.get("start") or ""), str(e.get("end") or "")
    sd, multi = start[:10], bool(e.get("multi_day"))
    st = start[11:16] if len(start) > 10 and not e.get("time_tba") else ""
    ed = end[:10] if end else ("" if multi else sd)
    et = end[11:16] if len(end) > 10 else ""
    if multi:
        dur = None
    elif st and et:
        dur = (datetime.date.fromisoformat(ed) - datetime.date.fromisoformat(sd)).days * 1440 + \
            int(et[:2]) * 60 + int(et[3:]) - int(st[:2]) * 60 - int(st[3:])
    else:
        dur = EST_MIN.get(e.get("category"))
    if multi:
        over = f"{ed}T23:59" if ed else "9999-12-31T23:59"
    elif st and et:
        over = f"{ed}T{et}"
    elif st:
        over = add_minutes(sd, st, dur or 90)
    else:
        over = f"{sd}T23:59"
    return sd, st, ed, et, multi, dur, over


def fit_level(e):
    ws = sorted((WEIGHTS.get(t, 1) for t in e.get("themes") or [] if t in WEIGHTS), reverse=True)
    s = ws[0] + 0.35 * (ws[1] if len(ws) > 1 else 0) + 0.15 * (ws[2] if len(ws) > 2 else 0) if ws else 0.5
    s += PRIOR.get(e.get("category"), 0)
    cost = e.get("cost")
    if number(cost) and cost == 0:
        s += 0.25
    elif number(cost) and cost > 20:
        s -= 0.3
    s -= 0.8 if e.get("members_only") else 0
    s -= 0.4 if e.get("waitlist") else 0
    s += 0.15 if e.get("borough") == "Manhattan" else 0
    s += 0.2 if e.get("qa") is True else 0
    s += 0.15 if e.get("indie") is True else 0
    s = math.floor(s * 100 + 0.5) / 100
    return 5 if s >= 4.35 else 4 if s >= 3.8 else 3 if s >= 3.0 else 2 if s >= 2.0 else 1 if s > 0.8 else 0


def ics_text(s):
    return str(s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\\n").replace("\n", "\\n")


def fold(line):
    parts, cur, size = [], "", 0
    for ch in line:
        b = len(ch.encode("utf-8"))
        if size + b > (74 if parts else 75):
            parts.append(cur)
            cur, size = "", 0
        cur += ch
        size += b
    parts.append(cur)
    return "\r\n ".join(parts)


def write_list(path, head, key, items):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    head_json = json.dumps(head, ensure_ascii=False, separators=(",", ":"))[1:-1]
    body = ",\n".join(json.dumps(o, ensure_ascii=False, separators=(",", ":")) for o in items)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("{" + head_json + ',"' + key + '":[\n' + body + "\n]}\n")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        sys.exit("usage: python3 publish.py <dump-dir> <site-dir> [--force]")
    dump, site = args
    raw_events = load(os.path.join(dump, "events"))
    raw_sources = load(os.path.join(dump, "sources"))
    meta_path = os.path.join(dump, "meta", "status.json")
    raw_meta = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}
    if not raw_events:
        sys.exit(f"publish: no events under {os.path.join(dump, 'events')}")
    now = datetime.datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%dT%H:%M")
    dropped_links, scrubbed, private_names, left_out = [], [], set(), 0

    sources = []
    for s in raw_sources:
        if s.get("tracked") is False:
            continue
        if str(s.get("sender") or "").lower().startswith("list:"):  # private group lists
            private_names.add(s.get("name"))
            continue
        o = {"id": s["id"], **{k: s[k] for k in SOURCE_FIELDS if k in s}}
        o["url"], o["signup"] = clean_url(o.get("url"), []), clean_url(o.get("signup"), [])
        o["notes"] = scrub(o.get("notes"))
        if o.get("name") and o["url"]:
            sources.append(o)
    sources.sort(key=lambda o: o["name"].lower())

    events = []
    for e in raw_events:
        if e.get("status", "active") != "active":
            continue
        if e.get("source_type") == "mailing list" or e.get("source") in private_names or host(e.get("url")) in SUBSCRIBER_ONLY_HOSTS:
            left_out += 1
            continue
        if not e.get("title") or not DATE_RE.match(str(e.get("start") or "")) or (e.get("end") and not DATE_RE.match(str(e["end"]))):
            continue
        o = {"id": e["id"], **{k: e[k] for k in EVENT_FIELDS if k in e}}
        o["url"], o["source_url"] = clean_url(o.get("url"), dropped_links), clean_url(o.get("source_url"), dropped_links)
        for k in ("desc", "note", "recurring"):
            if k in o:
                o[k] = scrub(o[k], scrubbed)
        events.append(o)
    events.sort(key=lambda o: (o["start"], o["id"]))

    events_path = os.path.join(site, "data", "events.json")
    if os.path.exists(events_path) and "--force" not in sys.argv:
        try:
            before = len(json.load(open(events_path, encoding="utf-8")).get("events", []))
        except (ValueError, OSError):
            before = 0
        if before and len(events) < before * 0.5:
            sys.exit(f"publish: refusing to write {len(events)} events (last export had {before}); the dump may be incomplete. Re-dump, or pass --force if the drop is real.")

    write_list(events_path, {"generated": now, "count": len(events)}, "events", events)
    write_list(os.path.join(site, "data", "sources.json"), {"generated": now, "count": len(sources)}, "sources", sources)
    meta = {k: raw_meta[k] for k in META_FIELDS if k in raw_meta}
    meta.update(event_count=len(events), source_count=len(sources), published=now)
    with open(os.path.join(site, "data", "meta.json"), "w", encoding="utf-8") as fh:
        fh.write(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")

    # Calendar feed: top-fit single events plus civic deadlines, from 14 days back; no members-only events.
    keep_from = add_days(now[:10], -14) + "T00:00"
    picks = []
    for e in events:
        sd, st, ed, et, multi, dur, over = timing(e)
        if over < keep_from or e.get("members_only"):
            continue
        lvl = fit_level(e)
        if (e.get("category") == "Date to know" and lvl >= 1) or (not multi and lvl >= 5):
            picks.append((f"{sd}T{st}" if st else f"{sd}T99:99", e, (sd, st, ed, et, multi, dur)))
    picks.sort(key=lambda p: p[0])
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    compact = lambda k: k.replace("-", "").replace(":", "") + "00"
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//City Docket//Top picks//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             "X-WR-CALNAME:City Docket: top picks",
             "X-WR-CALDESC:Strongest-fit NYC talks\\, hearings\\, readings\\, screenings and actions\\, plus civic deadlines. Updated every Sunday.",
             "X-WR-TIMEZONE:America/New_York", "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H",
             "BEGIN:VTIMEZONE", "TZID:America/New_York",
             "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT", "DTSTART:19700308T020000",
             "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
             "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST", "DTSTART:19701101T020000",
             "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD", "END:VTIMEZONE"]
    for _, e, (sd, st, ed, et, multi, dur) in picks:
        if multi or not st:
            last = (ed or sd) if multi else sd
            when = [f"DTSTART;VALUE=DATE:{sd.replace('-', '')}", f"DTEND;VALUE=DATE:{add_days(last, 1).replace('-', '')}"]
        else:
            end_key = f"{ed}T{et}" if et else add_minutes(sd, st, dur or 90)
            when = [f"DTSTART;TZID=America/New_York:{compact(sd + 'T' + st)}", f"DTEND;TZID=America/New_York:{compact(end_key)}"]
        facts = " · ".join(x for x in [e.get("category"), e.get("org"), e.get("price"),
                                       e.get("format") if e.get("format") not in (None, "", "In person") else "",
                                       "Registration or tickets needed" if e.get("rsvp") else "", "Waitlist" if e.get("waitlist") else "",
                                       "Q&A or guest in person" if e.get("qa") is True else ""] if x)
        desc = "\n\n".join(x for x in [e.get("desc"), facts, e.get("note"), f"Listing: {e['url']}" if e.get("url") else "",
                                       f"Found via {e['source']}" if e.get("source") else ""] if x)
        boro = e["borough"] + ", NY" if e.get("borough") and e["borough"] not in ("Online", "Citywide") else ""
        where = ", ".join(x for x in [e.get("venue"), e.get("address"), boro] if x)
        lines += ["BEGIN:VEVENT", f"UID:{e['id']}@city-docket", f"DTSTAMP:{stamp}", *when, f"SUMMARY:{ics_text(e.get('title'))}"]
        if where:
            lines.append(f"LOCATION:{ics_text(where)}")
        lines.append(f"DESCRIPTION:{ics_text(desc)}")
        if e.get("url"):
            lines.append(f"URL:{e['url']}")
        lines += [f"CATEGORIES:{ics_text(e.get('category'))}", "TRANSP:TRANSPARENT", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    os.makedirs(os.path.join(site, "calendar"), exist_ok=True)
    with open(os.path.join(site, "calendar", "picks.ics"), "w", encoding="utf-8", newline="") as fh:
        fh.write("\r\n".join(fold(l) for l in lines) + "\r\n")

    upcoming = sum(1 for e in events if timing(e)[6] >= now)
    print(f"publish: {len(events)} events ({upcoming} upcoming), {len(sources)} sources, {len(picks)} calendar picks.")
    print(f"publish: left out {left_out} private-list events and {len(private_names)} private source(s).")
    if dropped_links:
        print(f"publish: removed {len(dropped_links)} redirect link(s): {' '.join(dropped_links)}")
    if scrubbed:
        print(f"publish: dropped private-looking sentences (Gmail, inbox, passcode) from {len(scrubbed)} event field(s)")


if __name__ == "__main__":
    main()
