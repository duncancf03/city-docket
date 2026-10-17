/* City Docket: page app. Uses the db, user, sample and downloads capabilities when the viewer provides them. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => (/^https?:\/\/\S+$/i.test(String(u || "").trim()) ? String(u).trim() : "");
  const use = name => {
    try {
      return window.claude && typeof window.claude.use === "function" ? window.claude.use(name).catch(() => null) : Promise.resolve(null);
    } catch (e) { return Promise.resolve(null); }
  };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  const TABS = ["search", "ask", "saved", "sources", "interests"];
  const WHEN = [["today", "Today"], ["tonight", "Tonight"], ["tomorrow", "Tomorrow"], ["weekend", "This weekend"],
    ["next7", "Next 7 days"], ["next14", "Next 14 days"], ["next30", "Next 30 days"], ["all", "All upcoming"], ["custom", "Pick dates"]];
  const TOD = [["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening (5–9)"], ["late", "Late (9+)"]];
  const DUR = [["short", "Up to 1½ hrs"], ["mid", "1½–3 hrs"], ["long", "3+ hrs"], ["multi", "Multi-day"]];
  const PRICE = [["any", "Any price"], ["free", "Free"], ["u15", "$15 or less"]];
  const STYPE_LABEL = Object.fromEntries(SOURCE_TYPES);
  STYPE_LABEL.website = "Website"; STYPE_LABEL.newsletter = "Newsletter"; STYPE_LABEL["mailing list"] = "Mailing list";
  STYPE_LABEL.listings = "Listings"; STYPE_LABEL.government = "Government"; STYPE_LABEL.you = "Added by you";
  const EXAMPLES = [
    "What's going on this Friday evening I might want to check out?",
    "Free housing or tenant events in the next two weeks",
    "City Council hearings worth sitting in on this month",
    "A reading or screening on the Upper East Side or Midtown this week",
    "Something on the left that isn't a panel, this weekend",
    "Architecture tours I can still get into during Archtober",
    "Film screenings with a director Q&A this week",
    "Book talks at indie bookstores about cities, housing or the left",
  ];
  const ICON_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const ICON_STAR_O = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const ICON_HIDE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.4-6 9-6c1.7 0 3.2.5 4.4 1.2M21 12s-3.4 6-9 6c-1.7 0-3.2-.5-4.4-1.2M4 20L20 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const ICON_SHOW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.4-6 9-6 9 6 9 6-3.4 6-9 6-9-6-9-6z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/></svg>';

  const S = {
    events: [], byId: new Map(), sources: [], meta: null,
    prefs: defaultPrefs(), prefsMode: "local", uid: null,
    f: defaultFilters(), tab: "search", runOpen: null, dirKind: "All",
    db: null, sample: undefined, downloads: null, user: null,
    dbState: "loading", canWrite: null, isOwner: false,
    open: new Set(),
    ask: { turns: [], blocks: [], refs: null, ctl: null, busy: false, n: 0 },
    intake: { items: [], busy: false, ctl: null, source: "", type: "newsletter" },
    pruneAsk: false, pruning: false,
  };

  // ------------------------------------------------------------ restore per-browser conveniences
  (function restore() {
    const ui = store.get("cityDocket.ui");
    if (ui && typeof ui === "object") {
      const d = defaultFilters();
      if (ui.f && typeof ui.f === "object") {
        for (const k of Object.keys(d)) {
          if (k === "q") continue;
          if (Array.isArray(d[k]) && Array.isArray(ui.f[k])) d[k] = ui.f[k].filter(x => typeof x === "string");
          else if (typeof d[k] === typeof ui.f[k] && !Array.isArray(d[k])) d[k] = ui.f[k];
        }
      }
      S.f = d;
      if (TABS.includes(ui.tab)) S.tab = ui.tab;
    }
    const h = (location.hash || "").replace(/^#/, "");
    if (TABS.includes(h)) S.tab = h;
    const lp = store.get("cityDocket.prefs");
    if (lp) S.prefs = mergePrefs(lp);
  })();
  function persistUI() { store.set("cityDocket.ui", { tab: S.tab, f: Object.assign({}, S.f, { q: "" }) }); }

  // ------------------------------------------------------------ toast
  let toastTimer = null;
  function toast(msg, action) {
    const t = $("#toast");
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
    if (action) t.querySelector("button").onclick = () => { action.run(); t.classList.remove("show"); };
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), action ? 6000 : 3200);
  }

  // ------------------------------------------------------------ prefs
  let saveTimer = null, saving = false, dirty = false;
  function prefsChanged() {
    store.set("cityDocket.prefs", S.prefs);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePrefs, 700);
  }
  async function savePrefs() {
    if (S.prefsMode !== "db" || !S.db || !S.uid) return;
    if (saving) { dirty = true; return; }
    saving = true;
    try { await S.db.doc(`data/users/${S.uid}/prefs`).set(JSON.parse(JSON.stringify(S.prefs))); }
    catch (e) { S.prefsMode = "local"; renderPrefsWhere(); }
    saving = false;
    if (dirty) { dirty = false; savePrefs(); }
  }
  async function loadPrefs() {
    if (!S.db || !S.uid) { renderPrefsWhere(); return; }
    try {
      const snap = await S.db.doc(`data/users/${S.uid}/prefs`).get();
      S.prefsMode = "db";
      if (snap.exists) S.prefs = mergePrefs(snap.data());
      store.set("cityDocket.prefs", S.prefs);
    } catch (e) { S.prefsMode = "local"; }
    renderPrefsWhere(); syncInterests(); renderTab(); renderSavedCount();
  }
  function renderPrefsWhere() {
    $("#prefs-where").textContent = S.prefsMode === "db"
      ? "Your interests, saved and hidden events are stored with your account in this page, so they follow you across devices."
      : "Your interests, saved and hidden events are stored in this browser.";
  }

  // ------------------------------------------------------------ helpers for rows
  function shortDate(d) { return fmtDate(d, false); }
  function whenHTML(e, o) {
    const today = nowNY().slice(0, 10);
    if (e.multi) {
      return `<small>${e.sd > today ? "Opens " + esc(shortDate(e.sd)) : "Through"}</small>${e.ed ? esc(shortDate(e.ed)) : "Ongoing"}`;
    }
    const t = e.st ? esc(fmtTime(e.st)) : (e.category === "Date to know" ? "All day" : "TBA");
    if (o.flat) return `${esc(shortDate(e.sd))}<small>${esc(DOW[dow(e.sd)])} · ${t}</small>`;
    let sub = "";
    if (e.st && e.et && e.ed === e.sd) sub = `to ${esc(fmtTime(e.et))}`;
    else if (e.st && e.dur && e.durEst) sub = `about ${Math.round(e.dur / 30) / 2} hr`;
    return `${t}${sub ? `<small>${sub}</small>` : ""}`;
  }
  function whenLong(e) {
    if (e.multi) return `${fmtDate(e.sd)} – ${e.ed ? fmtDate(e.ed) : "ongoing"}`;
    const [, m, d] = e.sd.split("-").map(Number);
    const day = `${DOW_LONG[dow(e.sd)]}, ${MON[m - 1]} ${d}`;
    if (!e.st) return `${day} (time not announced)`;
    return `${day}, ${fmtTime(e.st)}${e.et && e.ed === e.sd ? " – " + fmtTime(e.et) : ""}`;
  }
  function whereText(e) {
    const parts = [e.venue];
    if (e.neighborhood && !String(e.venue || "").includes(e.neighborhood)) parts.push(e.neighborhood);
    if (e.borough && e.borough !== "Citywide" && e.borough !== e.venue && !String(e.venue || "").startsWith("Online")) parts.push(e.borough);
    return parts.filter(Boolean).join(", ");
  }
  function flagsHTML(e) {
    const f = [];
    if (e.qa) f.push('<span class="flag hi">Q&amp;A</span>');
    if (e.indie) f.push('<span class="flag">Indie</span>');
    if (e.members_only) f.push('<span class="flag warn">Members</span>');
    if (e.waitlist) f.push('<span class="flag warn">Waitlist</span>');
    if (e.rsvp && !e.members_only) f.push('<span class="flag">RSVP</span>');
    if (e.format === "Online") f.push('<span class="flag">Online</span>');
    if (e.format === "Hybrid") f.push('<span class="flag">Hybrid</span>');
    if (e.recurring) f.push('<span class="flag">Repeats</span>');
    return f.length ? `<span class="flags">${f.join("")}</span>` : "";
  }
  function rowHTML(e, o) {
    o = o || {};
    const key = `${o.ctx || "l"}:${e.id}`;
    const open = S.open.has(key);
    const saved = !!S.prefs.saved[e.id];
    const hidden = (S.prefs.hidden || []).includes(e.id);
    const score = fitScore(e, S.prefs), lvl = fitLevel(score);
    const reasons = fitReasons(e, S.prefs);
    const fitTitle = `${FIT_WORDS[lvl]}${reasons.length ? ": " + reasons.join(", ") : ""}`;
    const where = whereText(e);
    const price = e.price || "";
    return `<article class="ev" data-key="${esc(key)}" data-id="${esc(e.id)}">
      <div class="ev-when">${whenHTML(e, o)}</div>
      <div class="ev-body">
        <div class="kicker"><span class="cat">${esc(e.category)}</span>${e.org ? " · " + esc(e.org) : ""}</div>
        <h3 class="ev-title"><button type="button" data-act="toggle" aria-expanded="${open}">${esc(e.title)}</button></h3>
        <p class="meta">${esc(where)}${where && price ? " · " : ""}${esc(price)} ${flagsHTML(e)}</p>
        ${o.why ? `<p class="why"><b>WHY</b>${esc(o.why)}</p>` : ""}
        <div class="tags">${e.themes.slice(0, 4).map(t => `<span>${esc(THEME_SHORT[t])}</span>`).join("")}</div>
      </div>
      <div class="ev-side">
        <span class="fit" role="img" title="${esc(fitTitle)}" aria-label="${esc(fitTitle)}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= lvl ? "on" : ""}"></i>`).join("")}</span>
        <div class="acts">
          <button type="button" class="icon" data-act="save" aria-pressed="${saved}" aria-label="${saved ? "Remove from saved" : "Save"}" title="${saved ? "Saved" : "Save"}">${saved ? ICON_STAR : ICON_STAR_O}</button>
          <button type="button" class="icon" data-act="hide" aria-label="${hidden ? "Unhide" : "Hide this event"}" title="${hidden ? "Unhide" : "Hide"}">${hidden ? ICON_SHOW : ICON_HIDE}</button>
        </div>
      </div>
      ${open ? detailHTML(e) : ""}
    </article>`;
  }
  function detailHTML(e) {
    const url = safeUrl(e.url), surl = safeUrl(e.source_url);
    const where = [e.venue, e.address, e.neighborhood, e.borough].filter((x, i, a) => x && a.indexOf(x) === i).join(", ");
    const src = e.source ? (surl ? `<a href="${esc(surl)}" target="_blank" rel="noopener">${esc(e.source)}</a>` : esc(e.source)) : "Added by hand";
    return `<div class="detail">
      ${e.desc ? `<p>${esc(e.desc)}</p>` : ""}
      <dl>
        <dt>When</dt><dd>${esc(whenLong(e))}</dd>
        <dt>Where</dt><dd>${esc(where || "See the listing")}</dd>
        <dt>Price</dt><dd>${esc(e.price || "See the listing")}</dd>
        <dt>Format</dt><dd>${esc(e.format)}${e.rsvp ? " · registration or tickets needed" : ""}${e.qa ? " · Q&amp;A, talkback or guest in person" : ""}${e.indie ? " · independent venue" : ""}</dd>
        ${e.recurring ? `<dt>Repeats</dt><dd>${esc(e.recurring)}</dd>` : ""}
        ${e.note ? `<dt>Note</dt><dd>${esc(e.note)}</dd>` : ""}
        <dt>Found via</dt><dd>${src} <span class="kind">${esc(STYPE_LABEL[e.source_type] || "Source")}</span>${e.added ? ` · added ${esc(fmtDate(e.added))}` : ""}</dd>
      </dl>
      <div class="row">
        ${url ? `<a class="btn quiet" href="${esc(url)}" target="_blank" rel="noopener">Open listing ↗</a>` : ""}
        <a class="btn quiet" href="${esc(gcalUrl(e))}" target="_blank" rel="noopener">Add to Google Calendar ↗</a>
        <button type="button" class="btn quiet" data-act="copy">Copy details</button>
      </div>
    </div>`;
  }
  function eventFor(id) {
    if (S.byId.has(id)) return S.byId.get(id);
    const snap = S.prefs.saved[id];
    return snap && typeof snap === "object" ? normEvent(id, snap) : null;
  }

  // ------------------------------------------------------------ row actions (shared by every list)
  function onRowClick(ev) {
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    const art = btn.closest("article.ev");
    if (!art) return;
    const id = art.dataset.id, key = art.dataset.key, e = eventFor(id);
    const act = btn.dataset.act;
    if (act === "toggle") {
      const willOpen = !S.open.has(key);
      if (willOpen && e) { S.open.add(key); art.insertAdjacentHTML("beforeend", detailHTML(e)); }
      else { S.open.delete(key); const d = art.querySelector(".detail"); if (d) d.remove(); }
      btn.setAttribute("aria-expanded", String(willOpen));
    } else if (act === "save") toggleSave(id, e);
    else if (act === "hide") toggleHide(id);
    else if (act === "copy" && e) copyText(`${e.title}\n${whenLong(e)}\n${[e.venue, e.address, e.borough].filter(Boolean).join(", ")}\n${e.url || ""}`.trim());
  }
  function toggleSave(id, e) {
    if (S.prefs.saved[id]) delete S.prefs.saved[id];
    else if (e) S.prefs.saved[id] = snapshotOf(e);
    const on = !!S.prefs.saved[id];
    for (const b of $$(`article.ev[data-id="${CSS.escape(id)}"] [data-act="save"]`)) {
      b.setAttribute("aria-pressed", String(on)); b.innerHTML = on ? ICON_STAR : ICON_STAR_O;
      b.setAttribute("aria-label", on ? "Remove from saved" : "Save"); b.title = on ? "Saved" : "Save";
    }
    renderSavedCount(); prefsChanged();
    if (S.tab === "saved") renderSaved();
    toast(on ? "Saved. Find it under Saved." : "Removed from saved.");
  }
  function toggleHide(id) {
    const list = S.prefs.hidden || (S.prefs.hidden = []);
    const i = list.indexOf(id);
    if (i >= 0) { list.splice(i, 1); toast("Unhidden."); }
    else {
      list.push(id);
      toast("Hidden from your results.", { label: "Undo", run: () => toggleHide(id) });
    }
    prefsChanged(); renderTab();
  }
  function copyText(text) {
    const done = () => toast("Copied to clipboard.");
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove(); ok ? done() : toast("Couldn't copy here. Open the listing instead.");
    };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  }

  // ------------------------------------------------------------ search tab
  function chipGroup(el, items, isOn, onPick) {
    el.innerHTML = items.map(([v, l]) => `<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${!!isOn(v)}">${esc(l)}</button>`).join("");
    el.onclick = ev => { const b = ev.target.closest("button[data-v]"); if (b) onPick(b.dataset.v); };
  }
  function syncChips(el, isOn) { for (const b of el.querySelectorAll("button[data-v]")) b.setAttribute("aria-pressed", String(!!isOn(b.dataset.v))); }
  function toggleIn(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }
  const FACETS = [
    ["#f-cats", "cats", CATEGORIES.map(c => [c, c])],
    ["#f-themes", "themes", THEMES.map(([k]) => [k, THEME_SHORT[k]])],
    ["#f-boroughs", "boroughs", BOROUGHS.map(b => [b, b])],
    ["#f-tod", "tod", TOD],
    ["#f-dur", "dur", DUR],
    ["#f-format", "format", FORMATS.map(x => [x, x])],
    ["#f-extras", "extras", EXTRAS],
    ["#f-stype", "stype", [["website", "Websites"], ["newsletter", "Newsletters"], ["mailing list", "Mailing lists"], ["listings", "Listings"], ["government", "Government"], ["you", "Added by you"]]],
  ];
  function buildSearchControls() {
    chipGroup($("#when"), WHEN, v => S.f.range === v, v => { S.f.range = v; syncSearchControls(); renderResults(); });
    for (const [sel, key, items] of FACETS) chipGroup($(sel), items, v => S.f[key].includes(v), v => { toggleIn(S.f[key], v); syncSearchControls(); renderResults(); });
    chipGroup($("#f-price"), PRICE, v => S.f.price === v, v => { S.f.price = v; syncSearchControls(); renderResults(); });
    let qTimer = null;
    $("#q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.f.q = $("#q").value; renderResults(); }, 120); });
    $("#from").addEventListener("change", () => { S.f.from = $("#from").value; renderResults(); });
    $("#to").addEventListener("change", () => { S.f.to = $("#to").value; renderResults(); });
    $("#f-org").addEventListener("change", () => { S.f.org = $("#f-org").value; syncSearchControls(); renderResults(); });
    $("#f-running").addEventListener("change", () => { S.f.includeRunning = $("#f-running").checked; syncSearchControls(); renderResults(); });
    $("#f-hidden").addEventListener("change", () => { S.f.showHidden = $("#f-hidden").checked; syncSearchControls(); renderResults(); });
    $("#clear-filters").addEventListener("click", () => {
      S.f = Object.assign(defaultFilters(), { q: S.f.q, range: S.f.range, from: S.f.from, to: S.f.to, sort: S.f.sort });
      syncSearchControls(); renderResults();
    });
    $(".sortbox").addEventListener("click", ev => {
      const b = ev.target.closest("button[data-sort]"); if (!b) return;
      S.f.sort = b.dataset.sort; syncSearchControls(); renderResults();
    });
    $("#filters-toggle").addEventListener("click", () => {
      const rail = $("#rail"), open = rail.classList.toggle("closed") === false;
      $("#filters-toggle").setAttribute("aria-expanded", String(open));
    });
    for (const sel of ["#results", "#picks", "#saved-list", "#ask-thread"]) $(sel).addEventListener("click", onRowClick);
    $("#results").addEventListener("toggle", ev => { if (ev.target.matches && ev.target.matches("details.running")) S.runOpen = ev.target.open; }, true);
  }
  function syncSearchControls() {
    syncChips($("#when"), v => S.f.range === v);
    for (const [sel, key] of FACETS) syncChips($(sel), v => S.f[key].includes(v));
    syncChips($("#f-price"), v => S.f.price === v);
    for (const b of $$(".sortbox button")) b.setAttribute("aria-pressed", String(b.dataset.sort === S.f.sort));
    $("#custom-range").hidden = S.f.range !== "custom";
    if (S.f.range === "custom") {
      const r = rangeFor("custom", nowNY(), S.f.from, S.f.to);
      $("#from").value = S.f.from || r.from; $("#to").value = S.f.to || r.to;
    }
    $("#f-org").value = S.f.org;
    $("#f-running").checked = S.f.includeRunning;
    $("#f-hidden").checked = S.f.showHidden;
    const n = facetCount(S.f);
    $("#filter-n").hidden = !n; $("#filter-n").textContent = n || "";
    persistUI();
  }
  function refreshOrgOptions() {
    const counts = new Map();
    const now = nowNY();
    for (const e of S.events) if (e.org && e.overKey >= now) counts.set(e.org, (counts.get(e.org) || 0) + 1);
    const orgs = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    if (S.f.org && !counts.has(S.f.org)) orgs.push([S.f.org, 0]);
    $("#f-org").innerHTML = `<option value="">Any organizer</option>` + orgs.map(([o, n]) => `<option value="${esc(o)}">${esc(o)} (${n})</option>`).join("");
    $("#f-org").value = S.f.org;
  }
  function dayHeader(d, today) {
    const [, m, dd] = d.split("-").map(Number);
    const rel = relDay(d, today);
    return `<h2 class="day"><span class="dnum">${pad(dd)}</span><span class="dmeta"><b>${esc(DOW_LONG[dow(d)])}</b>${esc(MON[m - 1])} ${esc(d.slice(0, 4))}</span>${rel ? `<span class="rel${rel === "Today" || rel === "Tomorrow" ? " hot" : ""}">${esc(rel)}</span>` : ""}</h2>`;
  }
  function stateMessage() {
    if (S.dbState === "loading") return `<div class="empty"><strong>Loading the docket</strong>Events live in this page's database and appear here once it connects.</div>`;
    if (S.dbState === "absent") return `<div class="empty"><strong>Open City Docket in Claude to see events</strong>This page keeps its events in a database that only loads inside Claude. Open it from your artifacts on claude.ai or in the Claude app.</div>`;
    if (S.dbState === "error") return `<div class="empty"><strong>The event database stopped responding</strong>Reload the page to reconnect.</div>`;
    return "";
  }
  function renderResults() {
    const now = nowNY(), today = now.slice(0, 10);
    const summary = $("#summary"), picks = $("#picks"), results = $("#results");
    const msg = stateMessage();
    if (msg) { summary.textContent = S.dbState === "loading" ? "Loading…" : ""; picks.innerHTML = ""; results.innerHTML = msg; return; }
    if (!S.events.length) {
      summary.textContent = ""; picks.innerHTML = "";
      results.innerHTML = `<div class="empty"><strong>No events yet</strong>Paste a newsletter under Sources to add some, or ask Claude in your Planner/Events project to refresh City Docket.</div>`;
      return;
    }
    const res = search(S.events, S.f, S.prefs, now);
    const r = res.range;
    const span = r.to === "9999-12-31" ? `from ${fmtDate(r.from)}` : r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} – ${fmtDate(r.to)}`;
    summary.innerHTML = `<b>${res.single.length}</b> event${res.single.length === 1 ? "" : "s"}${res.running.length ? ` + <b>${res.running.length}</b> running` : ""} · ${esc(span)}${r.minTime ? " · 5 PM on" : ""}${r.friEvening ? " · Friday from 5 PM" : ""}`;
    const plain = !S.f.q && facetCount(S.f) === 0 && S.f.sort === "soonest";
    if (plain && res.single.length > 6) {
      const top = res.single.slice().sort((a, b) => b.score - a.score || (a.startKey < b.startKey ? -1 : 1)).filter(e => e.level >= 4).slice(0, 3);
      picks.innerHTML = top.length ? `<section class="picks" aria-label="Best fits"><div class="picks-head"><span class="notice-tag">For you</span><p>Best fits in this range, by your interests</p></div>${top.map(e => rowHTML(e, { flat: true, ctx: "p" })).join("")}</section>` : "";
    } else picks.innerHTML = "";
    let html = "";
    if (!res.single.length && !res.running.length) {
      html = `<div class="empty"><strong>Nothing matches</strong>Try a longer date range, fewer filters, or ${S.prefs.hideMuted ? "check whether a topic is switched off under Interests." : "a different search."}</div>`;
    } else {
      if (!res.single.length) html += `<div class="empty"><strong>No one-off events match</strong>Exhibitions, festivals and series running in this window are listed below.</div>`;
      else if (S.f.sort === "fit") html += res.single.map(e => rowHTML(e, { flat: true })).join("");
      else for (const g of groupByDay(res.single)) html += dayHeader(g.day, today) + g.items.map(e => rowHTML(e)).join("");
      if (res.running.length) {
        const open = S.runOpen == null ? (res.single.length < 8) : S.runOpen;
        html += `<details class="running"${open ? " open" : ""}><summary><h3>Running during these dates</h3><span class="dmeta">${res.running.length} exhibitions, festivals and series</span></summary>${res.running.map(e => rowHTML(e, { ctx: "r" })).join("")}</details>`;
      }
    }
    results.innerHTML = html;
  }

  // ------------------------------------------------------------ ask tab
  function buildAsk() {
    $("#ask-examples").innerHTML = EXAMPLES.map(x => `<button type="button" class="chip" data-q="${esc(x)}">${esc(x)}</button>`).join("");
    $("#ask-examples").addEventListener("click", ev => {
      const b = ev.target.closest("button[data-q]"); if (!b) return;
      if (S.ask.busy) return;
      resetAsk(); $("#ask-q").value = b.dataset.q; askSubmit();
    });
    $("#ask-go").addEventListener("click", askSubmit);
    $("#ask-q").addEventListener("keydown", ev => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); askSubmit(); } });
    $("#ask-stop").addEventListener("click", () => { if (S.ask.ctl) S.ask.ctl.abort(); });
    $("#ask-reset").addEventListener("click", () => { resetAsk(); renderAsk(); $("#ask-q").focus(); });
  }
  function resetAsk() { S.ask.turns = []; S.ask.blocks = []; S.ask.refs = null; }
  function setAskBusy(on) {
    S.ask.busy = on;
    $("#ask-go").disabled = on; $("#ask-stop").hidden = !on;
    $("#ask-reset").hidden = on || !S.ask.blocks.length;
    $("#ask-q").placeholder = S.ask.turns.length ? "Ask a follow-up, e.g. “only free ones” or “what about Saturday?”" : "What's going on this Friday evening I might want to check out?";
  }
  function askError(e) {
    const c = e && e.code;
    if (c === "cancelled") return "Stopped.";
    if (c === "not_granted") return "Claude access wasn't allowed for this page. Reload the page to be asked again.";
    if (["sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(c)) return "Ask isn't available in this view.";
    if (c === "rate_limited") return "Too many requests right now. Wait a minute, then try again.";
    if (c === "session_expired") return "Your Claude session expired. Sign in again, then retry.";
    if (c === "refused") return "Claude couldn't answer that one. Try wording it differently.";
    if (c === "prompt_too_large") return "Too many events to send at once. Try a narrower question.";
    if (c === "invalid_json" || c === "empty_completion") return "The answer came back garbled. Try again.";
    return "Couldn't reach Claude. Try again in a moment.";
  }
  async function askSubmit() {
    const q = $("#ask-q").value.trim();
    if (!q || S.ask.busy) return;
    if (S.sample === undefined) { toast("Still connecting to Claude. Try again in a few seconds."); return; }
    if (!S.sample) { toast("Ask only works when City Docket is open in Claude."); return; }
    if (S.dbState !== "ready") { toast("Events are still loading."); return; }
    const now = nowNY();
    let input, first = !S.ask.turns.length;
    if (first) {
      const built = buildAskPrompt(q, askPool(S.events, S.prefs, now), S.prefs, now);
      S.ask.refs = built.refs;
      input = [{ role: "user", content: built.text }];
    } else {
      const keep = S.ask.turns.slice(0, 1).concat(S.ask.turns.slice(1).slice(-6));
      input = keep.concat([{ role: "user", content: `Follow-up: ${q}\nRight now it is still ${nowPhrase(now)}. Answer in the same JSON shape, using the same event list.` }]);
    }
    const block = { n: ++S.ask.n, q, status: "thinking", data: null, error: "" };
    S.ask.blocks.push(block);
    $("#ask-q").value = "";
    const ctl = new AbortController();
    S.ask.ctl = ctl; setAskBusy(true); renderAsk();
    $("#ask-status").className = "ask-status live"; $("#ask-status").textContent = "Reading the docket…";
    try {
      const opts = { signal: ctl.signal, onText: () => { if (block.status === "thinking") { block.status = "writing"; $("#ask-status").textContent = "Writing the answer…"; renderAsk(); } } };
      if (!first) opts.cache = false;
      const data = await S.sample.json(input, opts);
      block.data = cleanAsk(data, S.ask.refs);
      block.status = "done";
      S.ask.turns = input.concat([{ role: "assistant", content: JSON.stringify(data) }]);
    } catch (e) {
      block.status = "error"; block.error = askError(e);
      if (e && ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(e.code)) S.sample = null;
      if (first) S.ask.turns = [];
    } finally {
      S.ask.ctl = null; setAskBusy(false);
      $("#ask-status").className = "ask-status"; $("#ask-status").textContent = "";
      renderAsk();
    }
  }
  function renderAsk() {
    const blocks = S.ask.blocks.slice().reverse();
    $("#ask-thread").innerHTML = blocks.map(b => {
      let inner = "";
      if (b.status === "thinking" || b.status === "writing") inner = `<p class="qa-int">${b.status === "writing" ? "Writing the answer…" : "Reading the docket…"}</p>`;
      else if (b.status === "error") inner = `<p class="qa-err">${esc(b.error)}</p>`;
      else if (b.data) {
        const d = b.data;
        const rows = list => list.map(p => { const e = S.byId.get(p.id); return e ? rowHTML(e, { flat: true, ctx: "a" + b.n, why: p.why }) : ""; }).join("");
        inner = `${d.interpretation ? `<p class="qa-int">${esc(d.interpretation)}</p>` : ""}${rows(d.picks)}${d.also.length ? `<p class="qa-sub">Also worth a look</p>${rows(d.also)}` : ""}${d.note ? `<p class="qa-note">${esc(d.note)}</p>` : ""}${!d.picks.length && !d.also.length && !d.note ? `<p class="qa-note">Nothing in the docket fits that. Try a wider date range or fewer conditions.</p>` : ""}`;
      }
      return `<section class="qa"><h3 class="qa-q">${esc(b.q)}</h3>${inner}</section>`;
    }).join("");
    $("#ask-reset").hidden = S.ask.busy || !S.ask.blocks.length;
    $("#ask-go").disabled = S.ask.busy || S.sample === null;
    if (S.sample === null) {
      $("#ask-fine").textContent = "Ask needs City Docket open in Claude, where it can use your Claude account. Search works everywhere.";
    }
  }

  // ------------------------------------------------------------ saved tab
  function renderSavedCount() {
    const n = Object.keys(S.prefs.saved || {}).length;
    const c = $("#saved-count"); c.hidden = !n; c.textContent = n || "";
  }
  function savedLists() {
    const now = nowNY();
    const list = Object.keys(S.prefs.saved || {}).map(eventFor).filter(Boolean);
    const upcoming = list.filter(e => e.overKey >= now).sort((a, b) => (a.startKey < b.startKey ? -1 : 1));
    const past = list.filter(e => e.overKey < now).sort((a, b) => (a.startKey > b.startKey ? -1 : 1));
    return { upcoming, past };
  }
  function renderSaved() {
    const { upcoming, past } = savedLists();
    let html = "";
    if (!upcoming.length && !past.length) html = `<div class="empty"><strong>Nothing saved yet</strong>Tap the star on any event to keep it here, then export the list to Google Calendar.</div>`;
    else {
      html += upcoming.length ? upcoming.map(e => rowHTML(e, { flat: true, ctx: "s" })).join("") : `<div class="empty"><strong>No upcoming saved events</strong>Everything you saved has already happened.</div>`;
      if (past.length) html += `<details class="running"><summary><h3>Already happened</h3><span class="dmeta">${past.length}</span></summary>${past.map(e => rowHTML(e, { flat: true, ctx: "sp" })).join("")}</details>`;
    }
    $("#saved-list").innerHTML = html;
  }
  async function exportCSV() {
    const { upcoming } = savedLists();
    if (!upcoming.length) { toast("Save some upcoming events first."); return; }
    if (!S.downloads) { toast("Downloads only work when City Docket is open in Claude. Use “Add to Google Calendar” on each event instead."); return; }
    try {
      await S.downloads.save({ filename: "city-docket-saved.csv", data: buildCSV(upcoming) });
      toast("Saved. In Google Calendar, go to Settings, then Import & export.");
    } catch (e) {
      if (e && e.code === "declined") return;
      toast(e && e.code === "rate_limited" ? "A download prompt is already open." : "Couldn't save the file here.");
    }
  }

  // ------------------------------------------------------------ sources tab
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
  function renderSources() {
    const cal = S.sources.filter(s => s.kind === "Calendar").length;
    const news = S.sources.filter(s => s.kind === "Newsletter" || s.kind === "Mailing list").length;
    const gov = S.sources.filter(s => s.kind === "Government" || s.kind === "Listings").length;
    $("#pipeline").innerHTML = `
      <div class="pipe"><div class="n">${cal}</div><div class="l">Calendars &amp; websites</div><p>Organizers' own event pages: indie bookstores, cinemas and theaters, universities, museums, community spaces, left groups and tenant organizations.</p></div>
      <div class="pipe"><div class="n">${news}</div><div class="l">Newsletters &amp; mailing lists</div><p>Email-first sources. Each refresh reads the ones marked “In your inbox” from Gmail; you can also paste any issue into the box below.</p></div>
      <div class="pipe"><div class="n">${gov}</div><div class="l">Government &amp; listings</div><p>Council hearings, community boards, election dates and citywide roundups.</p></div>`;
    const m = S.meta;
    const newSince = addDays(nowNY().slice(0, 10), -21);
    const isNew = src => typeof src.added === "string" && src.added >= newSince;
    const nNew = S.sources.filter(isNew).length;
    if (S.dirKind === "new" && !nNew) S.dirKind = "All";
    const bySrc = {};
    for (const e of S.events) { const k = e.source_type || "website"; bySrc[k] = (bySrc[k] || 0) + 1; }
    const mix = Object.entries(bySrc).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${String(STYPE_LABEL[k] || k).toLowerCase()}`).join(" · ");
    $("#refresh-note").innerHTML = S.dbState === "ready"
      ? `<span>${m && m.updated ? `Last pulled <b>${esc(fmtDate(String(m.updated).slice(0, 10)))}</b> · ` : ""}${m && m.last_inbox_check ? `inbox checked <b>${esc(fmtDate(String(m.last_inbox_check).slice(0, 10)))}</b> · ` : ""}${S.events.length} events (${esc(mix)})${nNew ? ` · <b>${nNew}</b> new source${nNew === 1 ? "" : "s"} in the last 3 weeks` : ""}</span><span>The Sunday refresh also looks for new sources and marks them New. For fresh listings any time, ask Claude in your Planner/Events project to <code>refresh City Docket</code>.</span>`
      : "";
    // directory
    const kinds = ["All", "Calendar", "Newsletter", "Mailing list", "Government", "Listings"];
    const vtypes = [["Bookstore", "Bookstores"], ["Cinema", "Cinemas"], ["Theater", "Theaters"], ["Indie space", "Indie spaces"]];
    const dirChips = [["All", "All"]].concat(nNew ? [["new", `New (${nNew})`]] : []).concat([["Calendar", "Calendars"], ["Newsletter", "Newsletters"], ["Mailing list", "Mailing lists"],
      ["Government", "Government"], ["Listings", "Listings"]]).concat(vtypes.map(([v, l]) => ["v:" + v, l]));
    chipGroup($("#dir-kinds"), dirChips, v => S.dirKind === v, v => { S.dirKind = v; renderSources(); });
    // Count by name (source or organizer) first; fall back to the link's host only when no other source shares it,
    // so listing sites like bookevents.nyc don't credit every shop they cover.
    const byName = new Map(), byHost = new Map(), hostOwners = new Map();
    for (const s of S.sources) { const h = host(s.url); if (h) hostOwners.set(h, (hostOwners.get(h) || 0) + 1); }
    for (const e of S.events) {
      for (const k of new Set([e.source, e.org].filter(Boolean))) byName.set(k, (byName.get(k) || 0) + 1);
      const h = host(e.source_url); if (h) byHost.set(h, (byHost.get(h) || 0) + 1);
    }
    const countFor = s => byName.get(s.name) || (hostOwners.get(host(s.url)) === 1 ? byHost.get(host(s.url)) || 0 : 0);
    const dk = String(S.dirKind || "All");
    const rows = S.sources.filter(s => dk === "All" || (dk === "new" ? isNew(s) : dk.startsWith("v:") ? s.venue_type === dk.slice(2) : s.kind === dk))
      .sort(dk === "new"
        ? (a, b) => (a.added === b.added ? (a.name < b.name ? -1 : 1) : a.added < b.added ? 1 : -1)
        : (a, b) => (a.kind === b.kind ? (a.name < b.name ? -1 : 1) : kinds.indexOf(a.kind) - kinds.indexOf(b.kind)));
    $("#directory").innerHTML = rows.length ? rows.map(s => {
      const url = safeUrl(s.url), signup = safeUrl(s.signup);
      const n = countFor(s);
      const news = s.kind === "Newsletter" || s.kind === "Mailing list";
      return `<div class="src"><div style="min-width:0"><span class="src-name">${esc(s.name)}</span>${isNew(s) ? `<span class="kind new" title="Added ${esc(fmtDate(s.added))}">New</span>` : ""}<span class="kind${news ? " news" : ""}">${esc(s.kind)}</span>${s.venue_type ? `<span class="kind">${esc(s.venue_type)}</span>` : ""}${s.cadence ? `<span class="kind">${esc(s.cadence)}</span>` : ""}${s.inbox ? `<span class="kind news">In your inbox</span>` : ""}
          <p>${esc(s.notes || "")}</p>
          <div class="tags">${(s.themes || []).filter(t => THEME_SHORT[t]).map(t => `<span>${esc(THEME_SHORT[t])}</span>`).join("")}${n ? `<span style="color:var(--ink)">${n} in the docket</span>` : ""}</div></div>
        <div class="src-links">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Open ↗</a>` : ""}${signup && signup !== url ? `<a href="${esc(signup)}" target="_blank" rel="noopener">Sign up ↗</a>` : (news && signup ? `<span class="fine" style="margin:0">Sign up on site</span>` : "")}</div></div>`;
    }).join("") : `<div class="empty"><strong>No sources yet</strong>Add one below.</div>`;
    $("#intake-source-list").innerHTML = S.sources.filter(s => s.kind === "Newsletter" || s.kind === "Mailing list").map(s => `<option value="${esc(s.name)}"></option>`).join("");
    const canWrite = !!S.db && S.canWrite !== false;
    $("#add-source-panel").hidden = !canWrite;
    renderIntake();
    renderMaintenance();
  }
  function renderIntake() {
    const noSample = S.sample === null, canWrite = !!S.db && S.canWrite !== false;
    $("#intake").hidden = noSample || !canWrite;
    const box = $("#intake-review");
    const items = S.intake.items;
    if (!items.length) { box.innerHTML = ""; return; }
    const chosen = items.filter(i => i.pick).length;
    box.innerHTML = `<p class="fine" style="margin:0 0 6px">Found ${items.length} event${items.length === 1 ? "" : "s"}. Uncheck anything you don't want.</p>` +
      items.map((it, i) => {
        const e = normEvent("x", it);
        return `<label class="review-item"><input type="checkbox" data-i="${i}" ${it.pick ? "checked" : ""}>
          <span style="min-width:0"><span class="kicker"><span class="cat">${esc(e.category)}</span>${e.org ? " · " + esc(e.org) : ""}</span>
          <span style="display:block;font-weight:650">${esc(e.title)}</span>
          <span class="meta">${esc(whenLong(e))}${whereText(e) ? " · " + esc(whereText(e)) : ""}${e.price ? " · " + esc(e.price) : ""}</span>
          ${it.dup ? `<span class="flags"><span class="flag warn">Already in City Docket</span></span>` : ""}</span></label>`;
      }).join("") +
      `<div class="ask-actions"><button class="btn primary" type="button" id="intake-save"${chosen ? "" : " disabled"}>Add ${chosen} event${chosen === 1 ? "" : "s"}</button><button class="btn quiet" type="button" id="intake-discard">Discard</button></div>`;
  }
  async function intakeSubmit() {
    const text = $("#intake-text").value.trim();
    if (!text) { toast("Paste a newsletter or event page first."); return; }
    if (S.sample === undefined) { toast("Still connecting to Claude. Try again in a few seconds."); return; }
    if (!S.sample) { toast("Finding events needs City Docket open in Claude."); return; }
    if (S.intake.busy) return;
    const source = $("#intake-source").value.trim() || "Pasted text";
    const type = $("#intake-type").value;
    const ctl = new AbortController();
    Object.assign(S.intake, { busy: true, ctl, source, type, items: [] });
    renderIntake();
    $("#intake-go").disabled = true; $("#intake-stop").hidden = false;
    const st = $("#intake-status"); st.className = "ask-status live"; st.textContent = "Reading the text…";
    try {
      const now = nowNY();
      const data = await S.sample.json(buildExtractPrompt(text.slice(0, 45000), source, now), {
        signal: ctl.signal, onText: () => { st.textContent = "Pulling out events…"; },
      });
      const arr = Array.isArray(data) ? data : (data && Array.isArray(data.events) ? data.events : []);
      const items = normalizeExtracted(arr, now);
      const keys = new Set(S.events.map(e => eventKey(e.title, e.sd)));
      S.intake.items = items.map(it => { const dup = keys.has(eventKey(it.title, it.start.slice(0, 10))); return Object.assign(it, { dup, pick: !dup }); });
      st.className = "ask-status";
      st.textContent = items.length ? "" : "No upcoming events found in that text.";
    } catch (e) {
      st.className = "ask-status"; st.textContent = askError(e);
      if (e && ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(e.code)) S.sample = null;
    } finally {
      S.intake.busy = false; S.intake.ctl = null;
      $("#intake-go").disabled = false; $("#intake-stop").hidden = true;
      renderIntake();
    }
  }
  async function intakeSave() {
    const chosen = S.intake.items.filter(i => i.pick);
    if (!chosen.length || !S.db) return;
    const btn = $("#intake-save"); if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
    const taken = new Set(S.events.map(e => e.id));
    const today = nowNY().slice(0, 10);
    let added = 0, stop = "";
    for (const it of chosen) {
      const doc = Object.assign({}, it, { source: S.intake.source, source_type: S.intake.type, source_url: "", added: today, status: "active" });
      delete doc.dup; delete doc.pick;
      const id = makeId(doc, taken); taken.add(id);
      try { await S.db.doc("events/" + id).set(doc); added++; }
      catch (e) {
        if (e && e.code === "quota_exceeded") { stop = "The database is full. Clear out past events under Housekeeping, then try again."; break; }
        if (e && e.code === "invalid_argument") { S.canWrite = false; stop = "You can view City Docket but not add to it."; break; }
        stop = "Some events couldn't be added. Try again."; break;
      }
    }
    toast(stop || `Added ${added} event${added === 1 ? "" : "s"} to City Docket.`);
    if (added) { S.intake.items = []; $("#intake-text").value = ""; }
    renderIntake();
  }
  async function addSource(ev) {
    ev.preventDefault();
    if (!S.db) return;
    const name = $("#src-name").value.trim(), url = safeUrl($("#src-url").value);
    if (!name || !url) { toast("Give the source a name and a full link starting with https://"); return; }
    const kind = $("#src-kind").value;
    const vtype = $("#src-vtype").value;
    const doc = { name: name.slice(0, 120), kind, themes: [], url, notes: $("#src-notes").value.trim().slice(0, 300), signup: "", cadence: "", tracked: true, added_by_viewer: true };
    if (["Bookstore", "Cinema", "Theater", "Indie space"].includes(vtype)) doc.venue_type = vtype;
    doc.added = nowNY().slice(0, 10);
    let id = slugify(name) || "source";
    const taken = new Set(S.sources.map(s => s.id));
    let i = 2; const base = id; while (taken.has(id)) id = `${base}-${i++}`;
    $("#src-save").disabled = true;
    try { await S.db.doc("sources/" + id).set(doc); toast(`Added ${name} to your sources.`); $("#add-source").reset(); }
    catch (e) { toast(e && e.code === "invalid_argument" ? "You can view City Docket but not add to it." : "Couldn't add that source. Try again."); }
    $("#src-save").disabled = false;
  }
  function renderMaintenance() {
    const show = !!S.db && (S.isOwner || S.canWrite === true);
    $("#maintenance").hidden = !show;
    if (!show) return;
    const cutoff = addDays(nowNY().slice(0, 10), -14) + "T00:00";
    const old = S.events.filter(e => e.overKey < cutoff);
    const box = $("#prune-box");
    if (S.pruning) { box.innerHTML = `<span class="ask-status live">Clearing out past events…</span>`; return; }
    if (!old.length) { box.innerHTML = `<span class="fine" style="margin:0">Nothing to clear: no events ended more than two weeks ago.</span>`; return; }
    box.innerHTML = S.pruneAsk
      ? `<span>Remove ${old.length} event${old.length === 1 ? "" : "s"} that ended before ${esc(fmtDate(cutoff.slice(0, 10)))}? Saved copies stay in your Saved tab.</span><button class="btn" type="button" data-prune="yes">Remove them</button><button class="btn quiet" type="button" data-prune="no">Cancel</button>`
      : `<button class="btn quiet" type="button" data-prune="ask">Clear out ${old.length} past event${old.length === 1 ? "" : "s"}</button>`;
  }
  async function prune() {
    const cutoff = addDays(nowNY().slice(0, 10), -14) + "T00:00";
    const old = S.events.filter(e => e.overKey < cutoff);
    S.pruning = true; S.pruneAsk = false; renderMaintenance();
    let n = 0;
    for (const e of old) { try { await S.db.doc("events/" + e.id).delete(); n++; } catch (err) { break; } }
    S.pruning = false; renderMaintenance();
    toast(`Cleared ${n} past event${n === 1 ? "" : "s"}.`);
  }

  // ------------------------------------------------------------ interests tab
  function buildInterests() {
    const LV = ["Off", "Low", "Med", "High"];
    $("#weights").innerHTML = THEMES.map(([k, l]) => `<div class="wrow"><span class="lab">${esc(l)}</span><span class="seg" role="group" aria-label="${esc(l)}" data-theme="${k}">${LV.map((x, i) => `<button type="button" data-w="${i}">${x}</button>`).join("")}</span></div>`).join("");
    $("#weights").addEventListener("click", ev => {
      const b = ev.target.closest("button[data-w]"); if (!b) return;
      const k = b.closest("[data-theme]").dataset.theme;
      S.prefs.weights[k] = Number(b.dataset.w); prefsChanged(); syncInterests(); renderResultsIfVisible();
    });
    const CV = [["-1", "Mute"], ["0", "Normal"], ["1", "Boost"]];
    $("#catweights").innerHTML = CATEGORIES.map(c => `<div class="wrow"><span class="lab">${esc(c)}</span><span class="seg" role="group" aria-label="${esc(c)}" data-cat="${esc(c)}">${CV.map(([v, l]) => `<button type="button" data-c="${v}">${l}</button>`).join("")}</span></div>`).join("");
    $("#catweights").addEventListener("click", ev => {
      const b = ev.target.closest("button[data-c]"); if (!b) return;
      const c = b.closest("[data-cat]").dataset.cat, v = Number(b.dataset.c);
      if (v) S.prefs.cats[c] = v; else delete S.prefs.cats[c];
      prefsChanged(); syncInterests(); renderResultsIfVisible();
    });
    $("#p-home").innerHTML = `<option value="">Anywhere</option>` + BOROUGHS.filter(b => b !== "Online" && b !== "Citywide").map(b => `<option>${b}</option>`).join("");
    $("#p-home").addEventListener("change", () => { S.prefs.home = $("#p-home").value; prefsChanged(); renderResultsIfVisible(); });
    for (const [sel, key] of [["#p-free", "preferFree"], ["#p-muted", "hideMuted"], ["#p-members", "hideMembers"], ["#p-qa", "favorQA"], ["#p-indie", "favorIndie"]]) {
      $(sel).addEventListener("change", () => { S.prefs[key] = $(sel).checked; prefsChanged(); renderResultsIfVisible(); });
    }
    $("#reset-prefs").addEventListener("click", () => {
      const keep = { saved: S.prefs.saved, hidden: S.prefs.hidden };
      S.prefs = Object.assign(defaultPrefs(), keep); prefsChanged(); syncInterests(); renderResultsIfVisible();
      toast("Interests reset. Saved and hidden events kept.");
    });
  }
  function syncInterests() {
    for (const seg of $$("#weights [data-theme]")) {
      const w = S.prefs.weights[seg.dataset.theme];
      for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(Number(b.dataset.w) === w));
    }
    for (const seg of $$("#catweights [data-cat]")) {
      const v = S.prefs.cats[seg.dataset.cat] || 0;
      for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(Number(b.dataset.c) === v));
    }
    $("#p-home").value = S.prefs.home || "";
    $("#p-free").checked = !!S.prefs.preferFree;
    $("#p-muted").checked = !!S.prefs.hideMuted;
    $("#p-members").checked = !!S.prefs.hideMembers;
    $("#p-qa").checked = !!S.prefs.favorQA;
    $("#p-indie").checked = !!S.prefs.favorIndie;
  }
  function renderResultsIfVisible() { if (S.tab === "search") renderResults(); }

  // ------------------------------------------------------------ tabs + status
  function setTab(t, focus) {
    if (!TABS.includes(t)) t = "search";
    S.tab = t;
    for (const b of $$(".tab")) {
      const on = b.dataset.tab === t;
      b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    for (const id of TABS) $("#panel-" + id).hidden = id !== t;
    persistUI();
    try { history.replaceState(null, "", "#" + t); } catch (e) { /* not allowed here */ }
    renderTab();
  }
  function renderTab() {
    if (S.tab === "search") renderResults();
    else if (S.tab === "ask") renderAsk();
    else if (S.tab === "saved") renderSaved();
    else if (S.tab === "sources") renderSources();
    else if (S.tab === "interests") syncInterests();
  }
  function renderStatus() {
    const line = $("#status-line"), plate = $("#sign-plate");
    if (S.dbState === "loading") line.textContent = "Connecting to the event database…";
    else if (S.dbState === "absent") line.textContent = "Open City Docket in Claude to load events.";
    else if (S.dbState === "error") line.textContent = "The event database stopped responding. Reload to reconnect.";
    else {
      const now = nowNY();
      const up = S.events.filter(e => e.overKey >= now);
      line.textContent = `${up.length} upcoming events · ${S.sources.length} sources${S.meta && S.meta.updated ? " · last pulled " + fmtDate(String(S.meta.updated).slice(0, 10)) : ""}`;
      const last = up.filter(e => !e.multi).reduce((m, e) => (e.sd > m ? e.sd : m), now.slice(0, 10));
      plate.innerHTML = `${esc(shortDate(now.slice(0, 10)))}<br>– ${esc(shortDate(last))}`;
    }
  }
  function renderAll() { renderStatus(); renderSavedCount(); renderTab(); }

  // ------------------------------------------------------------ wiring
  function wire() {
    buildSearchControls(); buildAsk(); buildInterests();
    $(".tabs").addEventListener("click", ev => { const b = ev.target.closest(".tab"); if (b) setTab(b.dataset.tab); });
    $(".tabs").addEventListener("keydown", ev => {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      const i = TABS.indexOf(S.tab), n = ev.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
      ev.preventDefault(); setTab(TABS[n], true);
    });
    $("#export-csv").addEventListener("click", exportCSV);
    $("#intake-go").addEventListener("click", intakeSubmit);
    $("#intake-stop").addEventListener("click", () => { if (S.intake.ctl) S.intake.ctl.abort(); });
    $("#intake-review").addEventListener("change", ev => {
      const cb = ev.target.closest("input[data-i]"); if (!cb) return;
      const it = S.intake.items[Number(cb.dataset.i)]; if (it) it.pick = cb.checked;
      const n = S.intake.items.filter(i => i.pick).length, btn = $("#intake-save");
      if (btn) { btn.disabled = !n; btn.textContent = `Add ${n} event${n === 1 ? "" : "s"}`; }
    });
    $("#intake-review").addEventListener("click", ev => {
      if (ev.target.closest("#intake-save")) intakeSave();
      else if (ev.target.closest("#intake-discard")) { S.intake.items = []; renderIntake(); }
    });
    $("#add-source").addEventListener("submit", addSource);
    $("#prune-box").addEventListener("click", ev => {
      const b = ev.target.closest("button[data-prune]"); if (!b) return;
      if (b.dataset.prune === "ask") { S.pruneAsk = true; renderMaintenance(); }
      else if (b.dataset.prune === "no") { S.pruneAsk = false; renderMaintenance(); }
      else prune();
    });
    syncSearchControls(); syncInterests(); renderPrefsWhere();
    setTab(S.tab);
    renderStatus(); renderSavedCount();
  }

  // ------------------------------------------------------------ capabilities
  async function connect() {
    const [db, user] = await Promise.all([use("db"), use("user")]);
    S.db = db; S.user = user;
    if (user) {
      try {
        const [id, owner, can] = await Promise.all([user.id(), user.isOwner(), user.can("data.write")]);
        S.uid = id; S.isOwner = !!owner; S.canWrite = can;
      } catch (e) { /* reads never reject, but stay safe */ }
    }
    if (!db) { S.dbState = "absent"; renderAll(); return; }
    db.collection("events").onSnapshot(snap => {
      S.events = snap.docs.map(d => normEvent(d.id, d.data()));
      S.byId = new Map(S.events.map(e => [e.id, e]));
      S.dbState = "ready"; refreshOrgOptions(); renderAll();
    }, err => { S.dbState = "error"; renderAll(); });
    db.collection("sources").onSnapshot(snap => {
      S.sources = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      renderStatus(); if (S.tab === "sources") renderSources();
    }, () => {});
    db.doc("meta/status").onSnapshot(snap => {
      S.meta = snap.exists ? snap.data() : null;
      renderStatus(); if (S.tab === "sources") renderSources();
    }, () => {});
    loadPrefs();
  }

  wire();
  connect();
  use("sample").then(s => { S.sample = s; if (S.tab === "ask") renderAsk(); if (S.tab === "sources") renderIntake(); });
  use("downloads").then(d => { S.downloads = d; });
  // Keep "tonight"/"today" honest if the page stays open across hours.
  setInterval(() => { if (S.dbState === "ready" && !document.hidden) { renderStatus(); if (S.tab === "search") renderResults(); } }, 5 * 60 * 1000);
})();
