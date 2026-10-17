#!/usr/bin/env python3
"""Build City Docket pages from src/.

  python3 tools/build_page.py site       writes index.html, the public copy served by GitHub Pages
  python3 tools/build_page.py artifact   writes dist/city-docket.html, the page published as the claude.ai artifact

Both share src/template.html, src/logic.js and src/app.js. The public copy adds src/static.js (which reads the
data/ files instead of the Claude database), drops Ask and newsletter intake, and swaps Claude-specific wording.
Every swap must match exactly once, so the build stops if the source drifts.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E"
        "%3Crect x='4' y='14' width='56' height='36' rx='6' fill='%230A6746'/%3E"
        "%3Crect x='9' y='19' width='46' height='26' rx='3' fill='none' stroke='white' stroke-width='3'/%3E%3C/svg%3E")

HEAD = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Talks, hearings, readings, screenings and actions around New York, ranked by interest. Updated every Sunday.">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="{ICON}">
"""

SITE_CSS = """<style>
[hidden] { display: none !important; }
.feed-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0 10px; }
.feed-url { width: 100%; font-family: var(--font-mono); font-size: .8rem; color: var(--muted); }
</style>
"""

FEED_PANEL = """      <div class="panel" id="feed-panel">
        <h3 class="sub">Top picks in your calendar</h3>
        <p class="fine" style="margin-top:0">A calendar feed of the strongest fits plus civic deadlines, refreshed every Sunday. Subscribe once and new picks show up on their own. It follows the default interests, not the ones set on this device.</p>
        <div class="feed-row">
          <a class="btn primary" id="feed-google" href="calendar/picks.ics" target="_blank" rel="noopener">Google Calendar ↗</a>
          <a class="btn" id="feed-apple" href="calendar/picks.ics">Apple Calendar</a>
          <button class="btn quiet" id="feed-copy" type="button">Copy feed link</button>
        </div>
        <label class="sr" for="feed-url">Calendar feed link</label>
        <input id="feed-url" class="feed-url" type="text" readonly value="calendar/picks.ics">
      </div>
"""

SITE_TEMPLATE = [
    ('    <button class="tab" role="tab" id="tab-ask" data-tab="ask" aria-controls="panel-ask" aria-selected="false" tabindex="-1">Ask</button>\n', ""),
    ('<p class="status" id="status-line">Connecting to the event database…</p>', '<p class="status" id="status-line">Loading events…</p>'),
    ("<strong>Loading the docket</strong>Events live in this page's database and appear here once it connects. If nothing shows up, open City Docket from Claude.</div>",
     "<strong>Loading the docket</strong>One moment.</div>"),
    ("These weights set the fit bars, the order of “Best fit” and what Ask recommends.", "These weights set the fit bars and the order of “Best fit”."),
    ("Every event links back to the page or email it came from.", "Every event links back to where it was listed."),
    ('      <div id="saved-list"></div>\n', '      <div id="saved-list"></div>\n' + FEED_PANEL),
]

SITE_APP = [
    ('const TABS = ["search", "ask", "saved", "sources", "interests"];', 'const TABS = ["search", "saved", "sources", "interests"];'),
    ("<strong>Loading the docket</strong>Events live in this page's database and appear here once it connects.</div>",
     "<strong>Loading the docket</strong>One moment.</div>"),
    ("<strong>The event database stopped responding</strong>Reload the page to reconnect.",
     "<strong>Couldn't load the event list</strong>Check your connection, then reload the page."),
    ('line.textContent = "Connecting to the event database…";', 'line.textContent = "Loading events…";'),
    ('line.textContent = "The event database stopped responding. Reload to reconnect.";',
     'line.textContent = "Couldn\'t load the event list. Reload to try again.";'),
    ("Paste a newsletter under Sources to add some, or ask Claude in your Planner/Events project to refresh City Docket.",
     "The list refreshes every Sunday evening."),
    ("Email-first sources. Each refresh reads the ones marked “In your inbox” from Gmail; you can also paste any issue into the box below.",
     "Email-first sources. The weekly refresh reads their latest issues."),
    ("<span>The Sunday refresh also looks for new sources and marks them New. For fresh listings any time, ask Claude in your Planner/Events project to <code>refresh City Docket</code>.</span>",
     "<span>Refreshed every Sunday evening, when it also looks for new sources and marks them New.</span>"),
    ('["#f-stype", "stype", [["website", "Websites"], ["newsletter", "Newsletters"], ["mailing list", "Mailing lists"], ["listings", "Listings"], ["government", "Government"], ["you", "Added by you"]]],',
     '["#f-stype", "stype", [["website", "Websites"], ["newsletter", "Newsletters"], ["listings", "Listings"], ["government", "Government"]]],'),
]


def swap(text, pairs, label):
    for old, new in pairs:
        n = text.count(old)
        if n != 1:
            sys.exit(f"build: {label}: expected exactly one match, found {n}: {old[:70]!r}")
        text = text.replace(old, new)
    return text


def read(name):
    return (SRC / name).read_text(encoding="utf-8")


def build_artifact():
    page = read("template.html").replace("/*__LOGIC__*/", read("logic.js")).replace("/*__APP__*/", read("app.js"))
    out = ROOT / "dist" / "city-docket.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(page, encoding="utf-8")
    return out


def build_site():
    template = swap(read("template.html"), SITE_TEMPLATE, "template.html")
    app = swap(read("app.js"), SITE_APP, "app.js")
    cut = template.index("</style>") + len("</style>")
    head, body = template[:cut], template[cut:]
    body = body.replace("/*__LOGIC__*/", read("static.js") + "\n" + read("logic.js")).replace("/*__APP__*/", app)
    page = HEAD + head.strip() + "\n" + SITE_CSS + "</head>\n<body>\n" + body.strip() + "\n</body>\n</html>\n"
    out = ROOT / "index.html"
    out.write_text(page, encoding="utf-8")
    return out


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "site"
    if target not in ("site", "artifact"):
        sys.exit("usage: build_page.py [site|artifact]")
    path = build_site() if target == "site" else build_artifact()
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)")
