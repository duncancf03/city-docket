# City Docket

Talks, hearings, readings, screenings and actions around New York, ranked by interest.

**Site:** https://duncancf03.github.io/city-docket/
**Calendar feed (top picks and civic deadlines):** https://duncancf03.github.io/city-docket/calendar/picks.ics

This is the public copy of City Docket, a Claude artifact that collects NYC events from organizers' calendars,
newsletters, listings and government calendars. A scheduled Claude task refreshes the docket every Sunday evening
and then publishes the public listings here. It has the same search, filters and interest weights. Interests and
saved events are kept in each visitor's browser. Asking questions in plain English needs Claude, so that part stays
in the Claude version.

## What's here

| Path | What it is |
| --- | --- |
| `index.html` | The page. Built from `src/`; don't edit it by hand. |
| `data/events.json`, `data/sources.json`, `data/meta.json` | The public event list, source directory and refresh status, rewritten every Sunday. |
| `calendar/picks.ics` | Subscribable feed of the strongest fits plus deadlines such as voter registration. |
| `src/` | Page source shared with the Claude artifact: `template.html`, `logic.js`, `app.js`, plus `static.js` for this copy. |
| `tools/publish.py` | Turns a database dump into the files in `data/` and `calendar/`, leaving out anything private. Standard-library Python. The Sunday task carries an identical copy in its instructions. |
| `tools/build_page.py` | Builds `index.html` (`site`) or the artifact page (`artifact`) from `src/`. |

## What stays private

The export publishes public listings only. Events that came from member mailing lists, or that exist only inside a
subscriber email, stay out. So do private group lists, inbox and sender details, and redirect or tracking links.
Nothing from anyone's interests or saved events is ever uploaded.

## Weekly update

    python3 tools/publish.py <dump-dir> .     # dump-dir holds events/, sources/ and meta/status.json
    git add data calendar && git commit -m "Weekly refresh YYYY-MM-DD" && git push

The export refuses to publish if the event count drops by more than half from the last run, which usually means an
incomplete dump. If you change `tools/publish.py`, paste the same script into the Sunday task's instructions too:
the task runs its own copy and checks it against this file before publishing.

## Rebuilding the page

    python3 tools/build_page.py site

The build swaps a few Claude-specific lines for this copy and stops if any of them no longer match `src/`.
