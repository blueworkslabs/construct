"use strict";
(() => {
  const $ = (id) => document.getElementById(id),
    O = SpaceOrbit,
    K = SpaceSky,
    C = SpaceCatalog;
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
    OLD_DATA = 72 * HOUR;
  let place = null,
    objects = [],
    satcat = new Map(),
    meta = { elements: 0, satcat: 0 },
    fetchState = { last: 0, until: 0, satcatLast: 0, satcatUntil: 0 },
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
    if (!parts.length || parts.length > max) return false;
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
      for (const k of ["last", "until", "satcatLast", "satcatUntil"])
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
  const shortLabel = (o, d) =>
    o.id === 25544 ? "ISS" : o.id === 48274 ? "Tiangong" : o.id === 20580 ? "Hubble" : d.major ? d.title : o.name;
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
      items.push({ o, l, state: O.state(l, sunAlt), d: info(o) });
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
        id: x.o.id,
        az: x.l.az,
        el: x.l.el,
        state: x.state,
        major: x.d.major,
        label: x.d.major || x.o.id === selected ? shortLabel(x.o, x.d) : null,
        trail:
          x.state === "visible" || x.state === "low" || x.o.id === selected
            ? O.trail(x.o, place.ob, t)
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
    $("rewind-label").textContent = K.ago(offset);
    $("now").hidden = offset === 0;
  }
  function listLine(x) {
    const where = `${K.dir16(x.l.az)} · ${K.height(x.l.el)}`,
      state = { visible: "visible", low: "low", shadow: "in Earth’s shadow", daylight: "daylight" }[x.state];
    return `${where} · ${state}`;
  }
  function renderList(s) {
    const key = s.items.map((x) => x.o.id + x.state).join() + "|" + selected;
    if (key !== listKey) {
      listKey = key;
      const rows = s.items.map((x) => {
        const b = element("button", null, `object${x.state === "visible" ? " visible" : ""}`);
        b.dataset.id = String(x.o.id);
        b.setAttribute("aria-pressed", String(x.o.id === selected));
        b.append(element("strong", x.d.title), element("span", listLine(x)));
        b.onclick = () => select(x.o.id, true);
        return b;
      });
      $("list").replaceChildren(...rows);
      $("list-title").textContent = offset ? `Overhead ${K.ago(offset)}` : "Overhead now";
    } else {
      const byId = new Map(s.items.map((x) => [String(x.o.id), x]));
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
    const o = objects.find((x) => x.id === selected);
    if (!o) {
      selected = null;
      $("spot").hidden = true;
      return;
    }
    const d = info(o),
      l = O.look(o, place.ob, s.t),
      st = O.state(l, s.sunAlt);
    $("spot").hidden = false;
    $("spot-title").textContent = d.title;
    $("spot-kind").textContent = d.kind;
    $("spot-when").hidden = offset === 0;
    $("spot-when").textContent = offset ? `${K.ago(offset)}:` : "";
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
    $("spot-state").textContent = [K.STATE[st], K.ending(end)].filter(Boolean).join(". ");
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
    const o = objects.find((x) => x.id === selected);
    if (!o || !place) return;
    infoTarget = o;
    const generation = ++infoGeneration;
    infoBusy = false;
    wikiDone = false;
    const d = info(o),
      c = satcat.get(o.id),
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
    const d = info(o),
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
    if (++ticks % 60 === 0) refreshData();
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
