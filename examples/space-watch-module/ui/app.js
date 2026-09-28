"use strict";
(() => {
  const $ = (id) => document.getElementById(id),
    O = SpaceOrbit,
    K = SpaceSky,
    C = SpaceCatalog,
    P = SpacePlan;
  // The acceptance fixture pins the clock; the product uses the phone's.
  const fixture = typeof SpaceFixture !== "undefined" ? SpaceFixture : null,
    now = () => (fixture ? fixture.now() : Date.now());
  const MINUTE = 60000,
    HOUR = 60 * MINUTE,
    ELEMENTS_TTL = 8 * HOUR,
    ELEMENTS_MANUAL = 2 * HOUR,
    SATCAT_TTL = 7 * 24 * HOUR,
    BACKOFF = 2 * HOUR,
    RETRY = 15 * MINUTE,
    ELEMENT_CHUNKS = 8,
    SATCAT_CHUNKS = 4,
    RECENT_CHUNKS = 4,
    PLAN_HOURS = 12,
    OLD_DATA = 72 * HOUR;
  let place = null,
    objects = [],
    satcat = new Map(),
    recent = [],
    launchDates = new Map(),
    trainList = [],
    plan = null,
    planKey = "",
    meta = { elements: 0, satcat: 0, recent: 0 },
    fetchState = { last: 0, until: 0, satcatLast: 0, satcatUntil: 0, recentLast: 0, recentUntil: 0 },
    prefs = { startWithLocation: true, red: false },
    selected = null,
    offset = 0,
    active = true,
    epoch = 0,
    busy = false,
    locating = false,
    locationRequest = 0,
    fetching = false,
    dataMessage = { text: "", tone: "" },
    sky = { stars: null, starsAt: 0, bodies: null, bodiesAt: 0 },
    listKey = "",
    lastCounts = "",
    infoTarget = null,
    infoGeneration = 0,
    infoBusy = false,
    wikiDone = false,
    wikiSection = null;
  const described = new Map(),
    passes = new Map(),
    ends = new Map(),
    launches = new Map();
  const message = (el, text, tone = "") => {
    el.textContent = text;
    el.className = tone;
  };
  const element = (tag, text, className) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (className) e.className = className;
    return e;
  };
  const interrupted = () =>
    Object.assign(new Error("Request interrupted."), { code: "RUN_PAUSED" });
  const denied = (e) =>
    e.code === "CAPABILITY_DENIED" || e.code === "LOCATION_PERMISSION";
  const describeError = (e) =>
    ({
      CAPABILITY_DENIED:
        "Enable the requested capability in Construct’s Module access, then reopen.",
      LOCATION_PERMISSION:
        "Enable Allow reading phone location and Android location access in Module access, then reopen.",
      LOCATION_TIMEOUT:
        "No location fix within 12 seconds. Move nearer a window, try again or enter coordinates.",
      LOCATION_UNAVAILABLE:
        "No location provider is available. Check the phone’s location setting or enter coordinates.",
      LOCATION_BUSY: "A location request is already running.",
      LOCATION_RATE: "Wait 15 seconds between location requests.",
      LOCATION_CANCELLED: "Location request cancelled.",
      RUN_PAUSED: "Return to the module and retry.",
      HTTP_BUSY: "Requests are busy; retry shortly.",
      HTTP_RATE: "Internet request budget reached; wait a minute.",
      HTTP_UNAVAILABLE: "No connection to the data source. Check the internet connection.",
      HTTP_DATA: "The data source sent something unexpected.",
      TIMEOUT: "Construct did not answer in time. Retry.",
    })[e.code] ||
    e.message ||
    "Request unavailable.";
  const time = (ms) =>
    new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  function day(ms) {
    const a = new Date(now()),
      b = new Date(ms),
      same = (x, y) => x.toDateString() === y.toDateString();
    if (same(a, b)) return `today ${time(ms)}`;
    a.setDate(a.getDate() + 1);
    if (same(a, b)) return `tomorrow ${time(ms)}`;
    return `${b.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${time(ms)}`;
  }
  const km = (x) => `${Math.round(x).toLocaleString("en-US")} km`;
  function age(ms) {
    const h = ms / HOUR;
    if (h < 1) return "less than an hour";
    if (h < 48) return `${Math.round(h)} h`;
    return `${Math.round(h / 24)} days`;
  }

  // ---- storage: preferences, fetch timing and the compact orbit cache ----
  async function kvGet(key) {
    try {
      return await call("storage.kv", { op: "get", key });
    } catch (_) {
      return null;
    }
  }
  async function kvSet(key, value) {
    try {
      await call("storage.kv", { op: "set", key, value });
      return true;
    } catch (_) {
      return false;
    }
  }
  // Chunks first, index last: a torn write leaves a generation mismatch, not bad data.
  async function saveRows(name, rowList, at, max) {
    const parts = O.chunks(rowList);
    if (!parts.length) parts.push([]);
    if (parts.length > max) return false;
    for (let i = 0; i < max; i++)
      if (!(await kvSet(`${name}.${i}`, i < parts.length ? { g: at, r: parts[i] } : null)))
        return false;
    return kvSet(`${name}.meta`, { at, n: parts.length });
  }
  async function loadRows(name, check, max) {
    const m = await kvGet(`${name}.meta`);
    if (!m || !Number.isFinite(m.at) || !Number.isInteger(m.n) || m.n < 1 || m.n > max)
      return { at: 0, rows: [] };
    if (m.at > now() + 5 * MINUTE) return { at: 0, rows: [] };
    const out = [];
    for (let i = 0; i < m.n; i++) {
      const c = await kvGet(`${name}.${i}`);
      if (!c || c.g !== m.at || !Array.isArray(c.r)) return { at: 0, rows: [] };
      for (const r of c.r) {
        const v = check(r);
        if (!v) return { at: 0, rows: [] };
        out.push(v);
      }
    }
    return { at: m.at, rows: out };
  }
  const savePrefs = () => kvSet("preferences", prefs);
  const saveFetchState = () => kvSet("fetch-state", fetchState);
  async function initPrefs() {
    const p = await kvGet("preferences");
    if (p && typeof p === "object") {
      if (typeof p.startWithLocation === "boolean")
        prefs.startWithLocation = p.startWithLocation;
      if (typeof p.red === "boolean") prefs.red = p.red;
    }
    const f = await kvGet("fetch-state");
    if (f && typeof f === "object")
      for (const k of ["last", "until", "satcatLast", "satcatUntil", "recentLast", "recentUntil"])
        if (Number.isFinite(f[k])) fetchState[k] = Math.max(0, Math.min(now() + 86400000, f[k]));
    applyRed();
    $("start-with-location").checked = prefs.startWithLocation;
  }
  async function initCache() {
    const e = await loadRows("elements", O.validRow, ELEMENT_CHUNKS);
    if (e.rows.length) {
      objects = O.build(e.rows);
      meta.elements = e.at;
    }
    const s = await loadRows("satcat", C.validRow, SATCAT_CHUNKS);
    if (s.rows.length) {
      satcat = C.index(s.rows);
      meta.satcat = s.at;
    }
    const r = await loadRows("recent", O.validRow, RECENT_CHUNKS),
      dates = await kvGet("recent-launches");
    if (r.at && dates && dates.at === r.at && Array.isArray(dates.d)) {
      recent = O.build(P.trainRows(r.rows));
      launchDates = new Map(dates.d.filter(validLaunch));
      meta.recent = r.at;
      rebuildTrains();
    }
  }
  const validLaunch = (x) =>
    Array.isArray(x) && x.length === 2 && /^\d{4}-\d{3}$/.test(x[0]) && /^\d{4}-\d\d-\d\d$/.test(x[1]);
  function rebuildTrains() {
    const key = (trains) => trains.map(t => `${t.id}:${t.centre.id}:${t.members.map(m => m.id).join()}`).join("|");
    const next = P.trains(recent, launchDates, now()), changed = key(next) !== key(trainList);
    trainList = next;
    described.clear();
    listKey = "";
    if (changed) planKey = "";
  }
  const ready = Promise.all([initPrefs(), initCache()]);

  // ---- network: CelesTrak lists, launch siblings and Wikipedia text ----
  async function getJson(url) {
    if (!active) throw interrupted();
    const e = epoch,
      r = await call("net.http", { op: "get", url, format: "json" });
    if (e !== epoch || !active) throw interrupted();
    return r;
  }
  const dataStatus = (text, tone = "") => {
    dataMessage = { text, tone };
    renderDataStatus();
  };
  function renderDataStatus() {
    const el = $("data-status");
    if (dataMessage.text) return message(el, dataMessage.text, dataMessage.tone);
    if (!objects.length) return message(el, fetching ? "Downloading orbit data from CelesTrak…" : "No orbit data yet.");
    // The orbits' own epochs, not the download time, say how fresh positions are.
    const old = O.ageHours(objects, now()) * HOUR;
    if (old > OLD_DATA)
      return message(el, `Orbit data is ${age(old)} old; positions may be off by minutes. Refresh when online.`, "attention");
    message(el, `Orbit data ${age(old)} old · CelesTrak${fetching ? " · updating…" : ""}`);
  }
  async function fetchElements(t) {
    const previous = fetchState.last;
    fetchState.last = t;
    try {
      const r = await getJson(C.ELEMENTS_URL);
      if (r.status !== 200) {
        fetchState.until = t + (r.status === 403 || r.status === 429 ? BACKOFF : RETRY);
        throw new Error(`CelesTrak orbit data unavailable (HTTP ${r.status}).`);
      }
      const rows = O.parseElements(r.text);
      if (rows.length < 10) {
        fetchState.until = t + BACKOFF;
        throw new Error("CelesTrak sent no usable orbit data.");
      }
      objects = O.build(rows);
      described.clear();
      listKey = "";
      meta.elements = t;
      fetchState.until = 0;
      passes.clear();
      ends.clear();
      dataMessage = { text: "", tone: "" };
      frame();
      await saveRows("elements", rows, t, ELEMENT_CHUNKS);
    } catch (e) {
      if (e.code === "CAPABILITY_DENIED") fetchState.last = previous;
      if (e.code === "RUN_PAUSED") {
        // An attempt the menu interrupted does not count toward the spacing.
        fetchState.last = previous;
        throw e;
      }
      if (e.code === "HTTP_DATA" || e.code === "HTTP_SIZE") fetchState.until = t + BACKOFF;
      dataMessage = {
        text: objects.length ? `${describeError(e)} Showing the saved orbits.` : describeError(e),
        tone: "attention",
      };
    } finally {
      await saveFetchState();
    }
  }
  async function fetchSatcat(t) {
    const previous = fetchState.satcatLast;
    fetchState.satcatLast = t;
    try {
      const r = await getJson(C.SATCAT_URL);
      if (r.status === 403 || r.status === 429) fetchState.satcatUntil = t + BACKOFF;
      if (r.status !== 200) return;
      const rows = C.parseSatcat(r.text);
      if (rows.length < 10) {
        fetchState.satcatUntil = t + BACKOFF;
        return;
      }
      satcat = C.index(rows);
      meta.satcat = t;
      fetchState.satcatUntil = 0;
      described.clear();
      listKey = "";
      await saveRows("satcat", rows, t, SATCAT_CHUNKS);
    } catch (e) {
      if (e.code === "CAPABILITY_DENIED") fetchState.satcatLast = previous;
      if (e.code === "HTTP_DATA" || e.code === "HTTP_SIZE") fetchState.satcatUntil = t + BACKOFF;
      if (e.code === "RUN_PAUSED") {
        fetchState.satcatLast = previous;
        throw e;
      }
      /* Descriptions fall back to the object names. */
    } finally {
      await saveFetchState();
    }
  }
  // Trains: recent launches, only the batches that can still fly as a line.
  async function fetchRecent(t) {
    const previous = fetchState.recentLast;
    fetchState.recentLast = t;
    try {
      const r = await getJson(C.RECENT_URL);
      if (r.status === 403 || r.status === 429) fetchState.recentUntil = t + BACKOFF;
      if (r.status !== 200) return;
      let raw = null;
      try { raw = JSON.parse(r.text); } catch (_) { /* Checked below. */ }
      const parsed = O.parseElements(r.text);
      // The generic orbit parser permits unknown launch IDs. Grouping cannot:
      // incomplete provider records must not become a successful empty snapshot.
      if (!Array.isArray(raw) || raw.some(o => !O.compact(o)?.[2]))
        throw Object.assign(new Error("Invalid recent orbit data"), { code: "HTTP_DATA" });
      const rows = P.trainRows(parsed);
      let dates = new Map();
      if (rows.length) {
        const q = await getJson(C.RECENT_SATCAT_URL);
        if (q.status === 403 || q.status === 429) fetchState.recentUntil = t + BACKOFF;
        if (q.status !== 200) return;
        let rawCatalog = null;
        try { rawCatalog = JSON.parse(q.text); } catch (_) { /* Checked below. */ }
        const catalog = C.parseSatcat(q.text);
        if (!Array.isArray(rawCatalog) || !catalog.length || rawCatalog.some(o => !C.compact(o)?.[9]))
          throw Object.assign(new Error("Invalid recent catalog"), { code: "HTTP_DATA" });
        dates = P.launchDates(catalog);
      }
      const keep = new Set(rows.map((x) => x[2].slice(0, 8)));
      recent = O.build(rows);
      launchDates = new Map([...dates].filter(([k]) => keep.has(k)));
      meta.recent = t;
      fetchState.recentUntil = 0;
      rebuildTrains();
      frame();
      // Retain the entire source batch for each detected train, including
      // stragglers: otherwise reopening changes “9 of 11” into “9 of 9”.
      const batches = new Set(trainList.map((x) => x.intdes)),
        kept = rows.filter((x) => batches.has(x[2].slice(0, 8)));
      if (await saveRows("recent", kept, t, RECENT_CHUNKS))
        await kvSet("recent-launches", { at: t, d: [...launchDates] });
    } catch (e) {
      if (e.code === "HTTP_DATA" || e.code === "HTTP_SIZE") fetchState.recentUntil = t + BACKOFF;
      if (e.code === "RUN_PAUSED" || e.code === "CAPABILITY_DENIED") fetchState.recentLast = previous;
      if (e.code === "RUN_PAUSED") throw e;
      /* Trains are optional; the bright-object sky works without them. */
    } finally {
      await saveFetchState();
    }
  }
  async function refreshData(manual = false) {
    if (fetching || !active) return;
    const t = now(),
      old = t - meta.elements;
    let wantElements =
      !objects.length || old > ELEMENTS_TTL || (manual && old > ELEMENTS_MANUAL);
    // A server back-off always holds; automatic attempts are also spaced out.
    const waitUntil = Math.max(fetchState.until, manual ? 0 : fetchState.last + RETRY);
    if (wantElements && t < waitUntil) {
      wantElements = false;
      if (manual && t < fetchState.until)
        dataStatus(`CelesTrak asked for a pause; try again after ${time(fetchState.until)}.`, "attention");
    } else if (manual && !wantElements && objects.length) {
      dataStatus(`Downloaded ${age(old)} ago; CelesTrak updates every few hours, so there is nothing newer yet.`);
      setTimeout(() => dataStatus(""), 8000);
      return;
    }
    fetching = true;
    renderDataStatus();
    $("refresh").disabled = true;
    try {
      if (wantElements) await fetchElements(t);
      const covered = objects.filter((o) => satcat.has(o.id)).length;
      if (
        objects.length &&
        t >= fetchState.satcatUntil &&
        (covered < objects.length * 0.9 || t - meta.satcat > SATCAT_TTL) &&
        t - fetchState.satcatLast > RETRY
      )
        await fetchSatcat(t);
      if (
        objects.length &&
        t - meta.recent > ELEMENTS_TTL &&
        t >= fetchState.recentUntil &&
        t - fetchState.recentLast > RETRY
      )
        await fetchRecent(t);
    } catch (_) {
      /* Paused: the next visible tick retries. */
    } finally {
      fetching = false;
      $("refresh").disabled = false;
      renderDataStatus();
      frame();
    }
  }

  // ---- the sky at one moment ----
  function info(o) {
    let d = described.get(o.id);
    if (!d) {
      d = C.describe(o, satcat.get(o.id));
      described.set(o.id, d);
    }
    return d;
  }
  function trainInfo(train) {
    let d = described.get(train.id);
    if (!d) {
      const since = train.launch ? Math.floor((now() - Date.parse(train.launch + "T00:00:00Z")) / 86400000) : null;
      d = {
        title: `${train.family} train`,
        kind: `${train.members.length} satellites in a line${train.launch ? ` · launched ${since < 1 ? "today" : since === 1 ? "yesterday" : since + " days ago"}` : ""}`,
        wiki: train.wiki,
        major: true,
        since,
      };
      described.set(train.id, d);
    }
    return d;
  }
  // An id is a NORAD number, or "train:YYYY-NNN" for a train.
  function find(id) {
    if (typeof id === "string") {
      const train = trainList.find((x) => x.id === id);
      return train ? { id, o: train.centre, train, d: trainInfo(train) } : null;
    }
    const o = objects.find((x) => x.id === id);
    return o ? { id, o, train: null, d: info(o) } : null;
  }
  const shortLabel = (o, d) =>
    d.title.endsWith(" train") ? d.title : o.id === 25544 ? "ISS" : o.id === 48274 ? "Tiangong" : o.id === 20580 ? "Hubble" : d.major ? d.title : o.name;
  const sunAt = (ms) => K.sun(ms, place.aob).el;
  function context(t) {
    if (!sky.stars || Math.abs(t - sky.starsAt) > 20000) {
      sky.stars = K.stars(t, place.aob);
      sky.starsAt = t;
    }
    if (!sky.bodies || Math.abs(t - sky.bodiesAt) > 20000) {
      sky.bodies = K.bodies(t, place.aob);
      sky.bodiesAt = t;
    }
  }
  function snapshot(t) {
    const sunAlt = sunAt(t),
      items = [];
    for (const o of objects) {
      const l = O.look(o, place.ob, t);
      if (!l || l.el < 0) continue;
      items.push({ id: o.id, o, l, state: O.state(l, sunAlt), d: info(o) });
    }
    for (const train of trainList) {
      const o = train.centre,
        l = O.look(o, place.ob, t);
      if (!l || l.el < 0) continue;
      items.push({ id: train.id, o, train, l, state: O.state(l, sunAlt), d: trainInfo(train) });
    }
    const rank = { visible: 0, low: 1, shadow: 2, daylight: 2 };
    items.sort((a, b) => rank[a.state] - rank[b.state] || b.l.el - a.l.el);
    return { t, sunAlt, items };
  }
  let dome = null;
  function frame() {
    if (!place || !active) return;
    const t = now() + offset * 1000;
    context(t);
    const s = snapshot(t),
      visible = s.items.filter((x) => x.state === "visible").length;
    dome.set({
      stars: sky.stars,
      asterisms: K.asterisms,
      bodies: sky.bodies,
      dark: s.sunAlt < O.DARK_SUN,
      red: prefs.red,
      selected,
      objects: s.items.map((x) => ({
        id: x.id,
        az: x.l.az,
        el: x.l.el,
        state: x.state,
        major: x.d.major,
        label: x.d.major || x.id === selected ? shortLabel(x.o, x.d) : null,
        trail:
          x.state === "visible" || x.state === "low" || x.id === selected
            ? O.trail(x.o, place.ob, t)
            : null,
        members: x.train
          ? x.train.members
              .filter((m) => m !== x.o)
              .map((m) => O.look(m, place.ob, t))
              .filter((m) => m && O.state(m, s.sunAlt) === "visible")
          : null,
      })),
    });
    const counts = `${visible} visible · ${s.items.length} above you`;
    if (counts !== lastCounts) {
      lastCounts = counts;
      $("counts").textContent = objects.length ? counts : "No orbit data yet";
      $("counts").className = visible ? "chip live" : "chip";
      $("dome").setAttribute(
        "aria-label",
        `Sky dome: ${counts}. The Overhead now list has the same objects as text.`,
      );
    }
    let note = "";
    if (objects.length) {
      if (s.sunAlt >= O.DARK_SUN)
        note = "The sky is too bright to see satellites now. The dome still shows where they are.";
      else if (!visible && s.items.length)
        note = "Nothing sunlit high enough right now: the objects above you are in Earth’s shadow or low.";
      else if (!s.items.length)
        note = "None of the bright objects are above you right now.";
    }
    $("sky-note").textContent = note;
    renderList(s);
    renderSpot(s);
    $("rewind-label").textContent = offset > 0 ? `Preview ${time(t)}` : K.ago(offset);
    $("now").hidden = offset === 0;
    planStart();
    renderPlan();
  }

  // ---- visible passes over the next hours, worked out in small slices ----
  let planTimer = 0;
  function planStart() {
    if (!place || !objects.length) return;
    const t = now(),
      key = `${place.lat},${place.lon}|${meta.elements}|${meta.recent}|${trainList.length}`;
    if (plan && planKey === key && t - plan.from < 30 * MINUTE) return;
    planKey = key;
    // Buffer the refresh interval; renderPlan still exposes only the rolling
    // next 12 hours, including passes that enter that window before refresh.
    const ranges = P.darkRanges(t, t + PLAN_HOURS * HOUR + 30 * MINUTE, sunAt),
      queue = [
        ...trainList.map((tr) => ({ id: tr.id, o: tr.centre })),
        ...objects.map((o) => ({ id: o.id, o })),
      ];
    plan = { from: t, ranges, queue, i: 0, results: [], done: !ranges.length, shown: "" };
    schedulePlan();
  }
  function planStep(budgetMs = 15) {
    if (!plan || plan.done || !active || !place) return;
    const started = Date.now();
    while (plan.i < plan.queue.length) {
      const q = plan.queue[plan.i++];
      for (const p of P.passes(q.o, place.ob, plan.ranges, sunAt)) plan.results.push({ ...p, id: q.id });
      if (Date.now() - started > budgetMs) break;
    }
    if (plan.i >= plan.queue.length) plan.done = true;
    renderPlan();
    schedulePlan();
  }
  function schedulePlan() {
    if (plan && !plan.done && !planTimer)
      planTimer = setTimeout(() => {
        planTimer = 0;
        planStep();
      }, 30);
  }
  const START = { rises: "rises", shadow: "comes out of Earth’s shadow", daylight: "appears as the sky darkens", ongoing: "already visible" },
    END = { sets: "sets", shadow: "fades into Earth’s shadow", daylight: "fades in the brightening sky", window: "still visible at window end" };
  function passLine(p) {
    const secs = (p.endMs - p.startMs) / 1000,
      mins = secs < 45 ? "under 1" : String(Math.max(1, Math.round(secs / 60)));
    const top = p.maxEl >= 75 ? (p.maxEl >= 84 ? "passes straight overhead" : "passes almost overhead") : `highest ${K.height(p.maxEl)} in the ${K.dir16(p.maxAz)}`;
    return `${K.dir16(p.startAz)} → ${K.dir16(p.endAz)} · ${top} · ${mins} min${p.endReason === "shadow" ? " · fades into shadow" : ""}`;
  }
  function renderPlan() {
    if (!plan) return;
    const t = now(),
      list = plan.results
        .filter((p) => p.endMs >= t && p.startMs <= t + PLAN_HOURS * HOUR && find(p.id))
        .sort((a, b) => a.startMs - b.startMs)
        .slice(0, 10),
      key = list.map((p) => p.id + ":" + p.startMs + ":" + (p.startMs <= t)).join() + "|" + plan.i + "|" + plan.done + "|" + Math.floor(t / MINUTE) + "|" + selected + "|" + (offset > 0);
    if (key === plan.shown) return;
    plan.shown = key;
    $("plan-status").textContent = !plan.ranges.length
      ? "The sky here stays too bright for satellites in the next 12 hours."
      : !plan.done
        ? `Working out passes… ${Math.round((100 * plan.i) / plan.queue.length)}%`
        : list.length
          ? "Tap one to preview it on the dome."
          : "No visible passes of the bright objects in the next 12 hours.";
    $("plan-list").replaceChildren(
      ...list.map((p) => {
        const f = find(p.id),
          b = element("button", null, "object pass");
        b.dataset.id = String(p.id);
        b.setAttribute("aria-pressed", String(p.id === selected && offset > 0));
        b.append(
          element("strong", `${p.startMs <= t ? "Now" : time(p.startMs)} · ${f.d.title}`),
          element("span", passLine(p)),
          element("span", `${START[p.startReason]} ${K.dir16(p.startAz)}, ${END[p.endReason]} ${K.height(p.endEl)} in the ${K.dir16(p.endAz)}`),
        );
        b.onclick = () => previewPass(p);
        return b;
      }),
    );
  }
  // Show the dome shortly after the pass becomes visible; it then runs in real time.
  function previewPass(p) {
    offset = Math.max(0, Math.round((P.previewTime(p, now()) - now()) / 1000));
    $("rewind").value = "0";
    plan.shown = "";
    select(p.id, true);
  }
  function listLine(x) {
    const where = `${K.dir16(x.l.az)} · ${K.height(x.l.el)}`,
      state = { visible: "visible", low: "low", shadow: "in Earth’s shadow", daylight: "daylight" }[x.state];
    return `${where} · ${state}`;
  }
  function renderList(s) {
    const key = s.items.map((x) => x.id + x.state).join() + "|" + selected + "|" + (offset > 0);
    if (key !== listKey) {
      listKey = key;
      const rows = s.items.map((x) => {
        const b = element("button", null, `object${x.state === "visible" ? " visible" : ""}`);
        b.dataset.id = String(x.id);
        b.setAttribute("aria-pressed", String(x.id === selected));
        b.append(element("strong", x.d.title), element("span", listLine(x)));
        b.onclick = () => select(x.id, true);
        return b;
      });
      $("list").replaceChildren(...rows);
      $("list-title").textContent = offset > 0 ? `Overhead at ${time(now() + offset * 1000)}` : offset ? `Overhead ${K.ago(offset)}` : "Overhead now";
    } else {
      const byId = new Map(s.items.map((x) => [String(x.id), x]));
      for (const b of $("list").children) {
        const x = byId.get(b.dataset.id);
        if (x && b.children[1]) b.children[1].textContent = listLine(x);
      }
    }
  }
  function renderSpot(s) {
    if (selected === null) {
      $("spot").hidden = true;
      return;
    }
    const found = find(selected);
    if (!found) {
      selected = null;
      $("spot").hidden = true;
      return;
    }
    const { o, d, train } = found,
      l = O.look(o, place.ob, s.t),
      st = O.state(l, s.sunAlt);
    $("spot").hidden = false;
    $("spot-title").textContent = d.title;
    $("spot-kind").textContent = d.kind;
    $("spot-when").hidden = offset === 0;
    $("spot-when").textContent = offset > 0 ? `At ${time(s.t)}:` : offset ? `${K.ago(offset)}:` : "";
    if (!l || st === "below") {
      $("spot-head").textContent = "Below your horizon";
      const p = nextPass(o, s.t);
      $("spot-anchor").textContent = p
        ? `Next time above you: ${day(p.riseMs)}, up to ${K.height(p.maxEl)}${p.visible ? ", visible" : ", not visible (shadow or daylight)"}.`
        : "Not above you in the next 36 hours.";
      $("spot-motion").textContent = "";
      $("spot-state").textContent = "";
      for (const id of ["stat-alt", "stat-speed", "stat-range"]) $(id).textContent = "–";
      if (l) {
        $("stat-alt").textContent = km(l.altKm);
        $("stat-speed").textContent = `${l.speedKms.toFixed(1)} km/s`;
        $("stat-range").textContent = km(l.rangeKm);
      }
      return;
    }
    const an = K.anchor(l, K.anchors(sky.bodies, sky.stars, s.sunAlt));
    $("spot-head").textContent = K.headline(l);
    $("spot-anchor").textContent = an ? an.text : "";
    $("spot-motion").textContent = K.motion(
      l,
      O.look(o, place.ob, s.t + MINUTE),
      O.look(o, place.ob, s.t + 4 * MINUTE),
    );
    const end = st === "visible" && offset === 0 ? passEnd(o, s.t) : null;
    const line = train
      ? `A line of ${train.members.length} satellites; early orbits are rough, so look along the track ahead and behind`
      : "";
    $("spot-state").textContent = [K.STATE[st], K.ending(end), line].filter(Boolean).join(". ");
    $("stat-alt").textContent = km(l.altKm);
    $("stat-speed").textContent = `${l.speedKms.toFixed(1)} km/s`;
    $("stat-range").textContent = km(l.rangeKm);
  }
  // Cached per object: the end of a pass moves little within ten seconds.
  function passEnd(o, t) {
    const c = ends.get(o.id);
    if (c && Math.abs(c.t - t) < 10000 && c.end)
      return { ...c.end, inS: Math.max(0, (c.end.atMs - t) / 1000) };
    const end = O.passEnd(o, place.ob, t, sunAt);
    ends.set(o.id, { t, end });
    return end;
  }
  function nextPass(o, t) {
    const c = passes.get(o.id);
    if (c && t >= c.t && t - c.t < 5 * MINUTE && (!c.p || c.p.riseMs > t)) return c.p;
    const p = O.nextPass(o, place.ob, t, sunAt);
    passes.set(o.id, { t, p });
    return p;
  }
  function select(id, fromList = false) {
    selected = id;
    listKey = "";
    frame();
    if (fromList && id !== null) $("spot").scrollIntoView({ block: "nearest" });
  }

  // ---- details: the lookup layer ----
  function facts(title, pairs) {
    const section = element("section");
    section.append(element("h3", title));
    const dl = element("dl");
    for (const [k, v] of pairs) {
      if (v == null || v === "") continue;
      const row = element("div", null, "fact");
      row.append(element("dt", k), element("dd", v));
      dl.append(row);
    }
    section.append(dl);
    return section;
  }
  function openInfo() {
    const found = find(selected);
    if (!found || !place) return;
    const o = found.o;
    infoTarget = o;
    const generation = ++infoGeneration;
    infoBusy = false;
    wikiDone = false;
    const d = found.d,
      train = found.train,
      c = train ? null : satcat.get(o.id),
      t = now(),
      l = O.look(o, place.ob, t),
      p = nextPass(o, t);
    $("info-title").textContent = d.title;
    $("info-kind").textContent = d.kind;
    const body = $("info-body");
    body.replaceChildren();
    if (l && l.el >= 0)
      body.append(
        facts("Right now", [
          ["Height", km(l.altKm)],
          ["Speed", `${l.speedKms.toFixed(2)} km/s · ${(Math.round(l.speedKms * 36) * 100).toLocaleString("en-US")} km/h`],
          ["Distance from you", km(l.rangeKm)],
          ["Light", l.sunlit ? "In sunlight" : "In Earth’s shadow"],
          ["Where", `${K.headline(l)}`],
        ]),
      );
    else body.append(facts("Right now", [["Where", "Below your horizon"]]));
    if (train) {
      const alts = train.members.map((m) => O.look(m, place.ob, t)).filter(Boolean).map((m) => m.altKm);
      body.append(
        facts("Train", [
          ["Satellites in the line", `${train.members.length} of ${train.batch} from this launch`],
          ["Launched", train.launch ? `${train.launch} · ${d.since < 1 ? "today" : d.since + " days ago"}` : null],
          ["Launch", train.intdes],
          ["Height", alts.length ? `${Math.round(Math.min(...alts)).toLocaleString("en-US")}–${km(Math.max(...alts))}` : null],
          ["Next time above you", p ? `${day(p.riseMs)} · up to ${K.height(p.maxEl)} · ${p.visible ? "visible" : "not visible"}` : "Not in the next 36 hours"],
        ]),
      );
      body.append(
        element(
          "p",
          `Freshly launched ${train.family} satellites fly close together, like a string of lights, until they raise their orbits and spread out over days to weeks. Early orbit data for a batch is rough, so the real line can run ahead of or behind the drawing.`,
          "note",
        ),
      );
      wikiSection = element("section");
      body.append(wikiSection);
      $("wiki").hidden = false;
      $("wiki").disabled = false;
      $("wiki").textContent = "Read on Wikipedia";
      $("info-dialog").showModal();
      return;
    }
    body.append(
      facts("Orbit", [
        ["Circles Earth every", c && c.period ? C.period(c.period) : null],
        ["Height range", c && c.perigee != null && c.apogee != null ? `${c.perigee}–${c.apogee} km` : null],
        [
          "Next time above you",
          p ? `${day(p.riseMs)} · up to ${K.height(p.maxEl)} · ${p.visible ? "visible" : "not visible"}` : "Not in the next 36 hours",
        ],
        ["Orbit data from", day(o.epoch)],
      ]),
    );
    body.append(
      facts("Catalog", [
        ["Name in the catalog", o.name],
        ["Type", d.kind],
        ["Launched", c && c.launch ? `${c.launch} · ${C.years(c.launch, t)} in orbit` : null],
        ["Radar size", c ? C.rcsWords(c.rcs) : null],
        ["IDs", `NORAD ${o.id}${o.intdes ? " · " + o.intdes : ""}`],
      ]),
    );
    const launch = element("section");
    body.append(launch);
    wikiSection = element("section");
    body.append(wikiSection);
    $("wiki").hidden = !C.wikiUrl(d);
    $("wiki").disabled = false;
    $("wiki").textContent = "Read on Wikipedia";
    $("info-dialog").showModal();
    loadLaunch(o, launch, generation);
  }
  async function loadLaunch(o, section, generation) {
    const url = C.launchUrl(o.intdes);
    if (!url) return;
    let rows = launches.get(o.intdes.slice(0, 8));
    if (!rows) {
      section.append(element("p", "Looking up the rest of its launch…", "note"));
      try {
        const r = await getJson(url);
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
        rows = C.parseSatcat(r.text);
        if (!rows.length) throw new Error("No usable launch records");
        launches.set(o.intdes.slice(0, 8), rows);
      } catch (_) {
        if (infoTarget === o && generation === infoGeneration) section.replaceChildren(element("p", "Launch details unavailable right now.", "note"));
        return;
      }
    }
    if (infoTarget !== o || generation !== infoGeneration) return;
    const v = C.summarizeLaunch(rows, o.id);
    section.replaceChildren(element("h3", "Same launch"));
    if (!v.total) return section.append(element("p", "Nothing else is catalogued from this launch.", "note"));
    if (v.payloads.length)
      section.append(
        element(
          "p",
          `${info(o).title.includes("rocket stage") ? "Carried" : "Launched with"}: ${v.payloads.map((x) => x.name).join(", ")}.`,
        ),
      );
    const bits = [];
    if (v.stages) bits.push(`${v.stages} other rocket stage${v.stages > 1 ? "s" : ""}`);
    if (v.debris) bits.push(`${v.debris} catalogued piece${v.debris > 1 ? "s" : ""} of debris`);
    if (bits.length) section.append(element("p", `Also from this launch: ${bits.join(" and ")}.`, "note"));
    if (v.reentered)
      section.append(element("p", `${v.reentered} of these have already fallen back and burned up.`, "note"));
  }
  $("wiki").onclick = async () => {
    const o = infoTarget, generation = infoGeneration;
    if (!o || infoBusy || wikiDone) return;
    const d = find(selected)?.o === o ? find(selected).d : info(o),
      section = wikiSection;
    infoBusy = true;
    $("wiki").disabled = true;
    section.replaceChildren(element("h3", "Wikipedia"), element("p", "Asking Wikipedia…", "note"));
    let result = null,
      searched = false;
    try {
      for (const search of d.wiki ? [false, true] : [true]) {
        const url = C.wikiUrl(d, search);
        if (!url) continue;
        const r = await getJson(url);
        if (r.status !== 200) throw new Error(`Wikipedia unavailable (HTTP ${r.status}).`);
        result = C.parseWiki(r.text);
        searched = search;
        if (result) break;
      }
      if (infoTarget !== o || generation !== infoGeneration) return;
      section.replaceChildren(element("h3", "Wikipedia"));
      if (!result) section.append(element("p", "No Wikipedia article found for this object.", "note"));
      else {
        if (searched)
          section.append(element("p", `Closest match: ${result.title}. It may describe a related object.`, "note"));
        section.append(element("p", result.extract, "wiki-text"));
        section.append(
          element("p", `From the Wikipedia article “${result.title}”, CC BY-SA 4.0.`, "credit"),
        );
      }
      wikiDone = true;
      $("wiki").textContent = "Wikipedia loaded";
    } catch (e) {
      if (infoTarget !== o || generation !== infoGeneration) return;
      section.replaceChildren(element("h3", "Wikipedia"), element("p", describeError(e), "note attention"));
      $("wiki").disabled = false;
    } finally {
      if (generation === infoGeneration) infoBusy = false;
    }
  };
  $("close-info").onclick = () => {
    infoTarget = null;
    infoGeneration++;
    infoBusy = false;
    $("info-dialog").close();
  };
  $("info-dialog").addEventListener("close", () => {
    if ($("info-dialog").open) return;
    infoTarget = null;
    infoGeneration++;
    infoBusy = false;
  });
  $("details").onclick = openInfo;
  $("clear").onclick = () => select(null);

  // ---- place: one foreground fix or typed coordinates; never stored ----
  function welcome(state, text = "", tone = "", retry = false) {
    const loc = state === "locating";
    $("welcome-title").textContent = loc ? "Finding your location…" : "Where are you watching from?";
    $("welcome-progress").hidden = !loc;
    $("welcome-text").hidden = loc;
    $("retry-location").hidden = !retry;
    message($("welcome-status"), text, tone);
  }
  function setPlace(lat, lon, source, accuracy) {
    const ob = O.observer(lat, lon, 0);
    if (!ob) return false;
    place = { lat, lon, source, ob, aob: K.observer(lat, lon, 0) };
    sky = { stars: null, starsAt: 0, bodies: null, bodiesAt: 0 };
    passes.clear();
    ends.clear();
    $("place-label").textContent =
      source === "location"
        ? `Your location${Number.isFinite(accuracy) ? ` · ±${accuracy < 1000 ? Math.round(accuracy) + " m" : (accuracy / 1000).toFixed(1) + " km"}` : ""} · stays on this phone`
        : `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
    $("welcome").hidden = true;
    $("workspace").hidden = false;
    listKey = "";
    lastCounts = "";
    frame();
    refreshData();
    return true;
  }
  async function locate(from) {
    if (busy || !active) return false;
    const e = epoch,
      request = ++locationRequest;
    locating = busy = true;
    $("show-sky").disabled = false;
    if (from === "dialog") message($("area-status"), "Getting one location fix…");
    try {
      const l = await call("location.read", { op: "get" });
      if (e !== epoch || request !== locationRequest || !active) return false;
      if (!Number.isFinite(l.latitude) || !Number.isFinite(l.longitude))
        throw new Error("Location unavailable.");
      locating = busy = false;
      if (from !== "dialog" && $("area-dialog").open) {
        $("latitude").value = l.latitude.toFixed(4);
        $("longitude").value = l.longitude.toFixed(4);
        message($("area-status"), "Location ready. Tap Show sky.");
        welcome("choose");
        return false;
      }
      if ($("area-dialog").open) $("area-dialog").close();
      return setPlace(l.latitude, l.longitude, "location", l.accuracyM);
    } catch (error) {
      if (e !== epoch || request !== locationRequest) return false;
      if (from === "dialog") message($("area-status"), describeError(error), "attention");
      else if (denied(error))
        welcome(
          "choose",
          "Phone location isn’t enabled for this module, so pick a place below. Allow both location switches in Construct’s Module access to skip this step next time.",
        );
      else welcome("choose", describeError(error), "attention", true);
      return false;
    } finally {
      if (e === epoch && request === locationRequest) locating = busy = false;
    }
  }
  function discardLocation() {
    if (!locating) return;
    locationRequest++;
    locating = busy = false;
  }
  const parse = (v) => {
    const s = String(v).trim().replace(/[−–]/g, "-").replace(",", ".");
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  };
  function showArea() {
    if (!active) return;
    if (place) {
      $("latitude").value = place.lat.toFixed(4);
      $("longitude").value = place.lon.toFixed(4);
    }
    $("start-with-location").checked = prefs.startWithLocation;
    message($("area-status"), "");
    $("area-dialog").showModal();
  }
  $("start").onclick = showArea;
  $("area").onclick = showArea;
  $("retry-location").onclick = () => {
    welcome("locating");
    locate("retry");
  };
  $("cancel-area").onclick = () => {
    discardLocation();
    $("area-dialog").close();
    if (!place && !busy) welcome("choose");
  };
  $("area-dialog").addEventListener("cancel", () => {
    discardLocation();
    if (!place) welcome("choose");
  });
  $("use-location").onclick = () => locate("dialog");
  $("start-with-location").onchange = () => {
    prefs.startWithLocation = $("start-with-location").checked;
    savePrefs();
  };
  $("area-form").onsubmit = (event) => {
    event.preventDefault();
    const lat = parse($("latitude").value),
      lon = parse($("longitude").value);
    if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) {
      message($("area-status"), "Enter a latitude from −90 to 90 and a longitude from −180 to 180.", "attention");
      return;
    }
    discardLocation();
    $("area-dialog").close();
    setPlace(lat, lon, "manual");
  };

  // ---- controls ----
  function applyRed() {
    document.body.classList.toggle("red", prefs.red);
    $("red").setAttribute("aria-pressed", String(prefs.red));
  }
  $("red").onclick = () => {
    prefs.red = !prefs.red;
    applyRed();
    savePrefs();
    frame();
  };
  $("rewind").oninput = () => {
    const v = Number($("rewind").value);
    offset = Number.isFinite(v) ? Math.max(-300, Math.min(0, Math.round(v))) : 0;
    listKey = "";
    frame();
  };
  $("now").onclick = () => {
    offset = 0;
    $("rewind").value = "0";
    listKey = "";
    frame();
  };
  $("refresh").onclick = () => refreshData(true);
  dome = new SpaceDome($("dome"), (id) => select(id));

  window.addEventListener("constructvisibilitychange", (event) => {
    active = event.detail?.visible !== false;
    epoch++;
    if (!active) {
      discardLocation();
      infoBusy = false;
      if ($("info-dialog").open) {
        $("info-dialog").close();
        infoTarget = null;
        infoGeneration++;
      }
      message($("status"), "Paused while Construct’s menu is open.");
      if (!place) welcome("choose");
      return;
    }
    message($("status"), "");
    frame();
    refreshData();
  });
  let ticks = 0;
  setInterval(() => {
    if (!active || !place) return;
    frame();
    planStep();
    if (++ticks % 60 === 0) {
      rebuildTrains();
      refreshData();
    }
  }, 1000);
  (async () => {
    await ready;
    if (!active) return;
    if (prefs.startWithLocation && !place) {
      welcome("locating", "One foreground fix, used only on this phone. Choose place to enter coordinates instead.");
      await locate("start");
    } else welcome("choose");
  })();
})();
