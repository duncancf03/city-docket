/* City Docket, public copy. Stands in for the Claude runtime that the page normally runs in:
   events, sources and the refresh status come from the data/ files the Sunday refresh publishes,
   interests and saved events stay in this browser, and Ask (which needs Claude) is left out. */
(function () {
  "use strict";
  const fail = (code, msg) => Object.assign(new Error(msg || code), { code });
  const load = path => fetch(path, { cache: "no-cache" }).then(r => {
    if (!r.ok) throw fail("unavailable", `${path} returned ${r.status}`);
    return r.json();
  });
  const files = Promise.all([load("data/events.json"), load("data/sources.json"), load("data/meta.json").catch(() => null)])
    .then(([ev, src, meta]) => ({
      events: Array.isArray(ev && ev.events) ? ev.events : [],
      sources: Array.isArray(src && src.sources) ? src.sources : [],
      meta: meta && typeof meta === "object" ? meta : null,
    }));
  files.catch(() => {}); // each reader reports its own failure

  const docOf = o => {
    const body = Object.assign({}, o), id = String(body.id || "");
    delete body.id;
    return { id, exists: true, data: () => Object.assign({}, body) };
  };
  const snapOf = list => {
    const docs = list.filter(o => o && typeof o === "object" && o.id).map(docOf);
    return { docs, size: docs.length, empty: !docs.length };
  };
  const readOnly = () => Promise.reject(fail("invalid_argument", "This copy of City Docket is read-only."));
  const db = {
    collection(name) {
      const pick = f => (name === "events" ? f.events : name === "sources" ? f.sources : []);
      return {
        onSnapshot(next, onError) {
          files.then(f => next(snapOf(pick(f))), e => { if (onError) onError(e); });
          return () => {};
        },
        get() { return files.then(f => snapOf(pick(f))); },
      };
    },
    doc(path) {
      const read = f => (path === "meta/status" && f.meta
        ? { id: "status", exists: true, data: () => Object.assign({}, f.meta) }
        : { id: String(path).split("/").pop(), exists: false, data: () => undefined });
      return {
        onSnapshot(next, onError) {
          files.then(f => next(read(f)), e => { if (onError) onError(e); });
          return () => {};
        },
        get() { return files.then(read); },
        set: readOnly, update: readOnly, delete: readOnly,
      };
    },
  };
  // No account here: interests and saved events fall back to this browser's storage.
  const user = { id: () => Promise.resolve(null), isOwner: () => Promise.resolve(false), can: () => Promise.resolve(false) };
  const downloads = {
    save(o) {
      try {
        const name = String((o && o.filename) || "city-docket.txt");
        const type = /\.csv$/i.test(name) ? "text/csv;charset=utf-8"
          : /\.ics$/i.test(name) ? "text/calendar;charset=utf-8" : "application/octet-stream";
        const href = URL.createObjectURL(new Blob([o && o.data != null ? o.data : ""], { type }));
        const a = document.createElement("a");
        a.href = href; a.download = name; a.style.display = "none";
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(href); a.remove(); }, 1500);
        return Promise.resolve();
      } catch (e) { return Promise.reject(fail("failed")); }
    },
  };
  const caps = { db, user, downloads };
  window.claude = {
    use: name => (caps[name] ? Promise.resolve(caps[name]) : Promise.reject(fail("not_declared", `${name} isn't part of the public copy`))),
  };

  // Calendar feed panel on the Saved tab.
  const feed = new URL("calendar/picks.ics", location.href).href;
  const webcal = feed.replace(/^https?:/, "webcal:");
  const $ = id => document.getElementById(id);
  if ($("feed-url")) $("feed-url").value = feed;
  if ($("feed-apple")) $("feed-apple").href = webcal;
  if ($("feed-google")) $("feed-google").href = "https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(webcal);
  if ($("feed-copy")) {
    $("feed-copy").addEventListener("click", () => {
      const btn = $("feed-copy"), label = btn.textContent;
      const done = ok => { btn.textContent = ok ? "Copied" : "Select the link and copy it"; setTimeout(() => { btn.textContent = label; }, 2200); };
      const fallback = () => {
        const f = $("feed-url"); f.focus(); f.select();
        let ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        done(ok);
      };
      try { navigator.clipboard.writeText(feed).then(() => done(true), fallback); } catch (e) { fallback(); }
    });
  }
})();
