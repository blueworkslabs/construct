"use strict";
(() => {
  const $ = (id) => document.getElementById(id),
    D = SkyData;
  const provider = { adsb: "ADSB.lol", opensky: "OpenSky" },
    kindName = {
      jet: "Jet aircraft",
      business: "Business-jet model",
      turboprop: "Turboprop",
      piston: "Propeller aircraft",
      rotorcraft: "Rotorcraft",
      glider: "Glider / sailplane",
      balloon: "Lighter-than-air",
      unknown: "Aircraft",
    };
  let area = null,
    radius = 50,
    mode = "adsb",
    feeds = {},
    rows = [],
    selected = null,
    busy = false,
    active = true,
    epoch = 0,
    lastUpdated = 0,
    nextRefresh = 0,
    auto = false,
    budgets = {},
    infoTarget = null,
    infoBusy = false;
  const metadata = new Map(),
    queue = [];
  let inFlight = 0;
  const message = (el, text, tone = "") => {
    el.textContent = text;
    el.className = tone;
  };
  const describe = (e) =>
    ({
      CAPABILITY_DENIED:
        "Enable the requested capability in Construct’s Module access, then reopen.",
      LOCATION_PERMISSION:
        "Enable Allow reading phone location and Android location access in Module access, then reopen.",
      RUN_PAUSED: "Return to the module and retry.",
      HTTP_BUSY: "Requests are busy; retry shortly.",
      HTTP_RATE: "Internet request budget reached; wait a minute.",
    })[e.code] ||
    e.message ||
    "Request unavailable.";
  const element = (tag, text, className) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (className) e.className = className;
    return e;
  };
  function transport(url, format = "json") {
    return new Promise((resolve, reject) => {
      if (!active || queue.length >= 24) {
        reject(new Error("Requests paused or busy."));
        return;
      }
      queue.push({ url, format, resolve, reject, epoch });
      queue.sort(
        (a, b) => (a.format === "json" ? 0 : 1) - (b.format === "json" ? 0 : 1),
      );
      pump();
    });
  }
  function pump() {
    while (active && inFlight < 3 && queue.length) {
      const job = queue.shift();
      if (job.epoch !== epoch) {
        job.reject(new Error("Request interrupted."));
        continue;
      }
      inFlight++;
      call("net.http", { op: "get", url: job.url, format: job.format })
        .then((value) => {
          if (!active || job.epoch !== epoch)
            throw new Error("Request interrupted.");
          job.resolve(value);
        })
        .catch(job.reject)
        .finally(() => {
          inFlight--;
          pump();
        });
    }
  }
  function statusError(r, name) {
    if (r.status === 429) {
      const h = r.headers || {},
        raw = h["x-rate-limit-retry-after-seconds"] || h["retry-after"],
        seconds = /^\d+$/.test(raw || "")
          ? Math.min(86400, Math.max(30, Number(raw)))
          : 3600;
      throw Object.assign(
        new Error(name + " quota reached. Try again later."),
        { retryAfter: seconds },
      );
    }
    if (r.status !== 200)
      throw new Error(name + " unavailable (HTTP " + r.status + ").");
  }
  async function image(url) {
    const r = await transport(url, "image");
    statusError(r, "Map");
    if (typeof r.dataUrl !== "string")
      throw new Error("Map response unavailable");
    return r.dataUrl;
  }
  const map = new SkyMap(
    $("map"),
    image,
    (key) => {
      selected = key;
      render();
    },
    () => {
      $("search-here").hidden = !area;
    },
    (error) =>
      message(
        $("map-status"),
        error
          ? "Map tiles unavailable. Aircraft results may still be available."
          : "",
      ),
  );
  async function saveBudgets() {
    try {
      await call("storage.kv", {
        op: "set",
        key: "provider-cooldowns",
        value: budgets,
      });
    } catch (_) {
      /* No coordinates or aircraft history are stored here. */
    }
  }
  async function initBudgets() {
    try {
      const b = await call("storage.kv", {
        op: "get",
        key: "provider-cooldowns",
      });
      if (b && typeof b === "object")
        for (const s of ["adsb", "opensky", "adsbdb"]) {
          const x = b[s];
          if (x && Number.isFinite(x.last) && Number.isFinite(x.until))
            budgets[s] = {
              last: Math.max(0, Math.min(Date.now(), x.last)),
              until: Math.max(0, Math.min(Date.now() + 86400000, x.until)),
            };
        }
    } catch (_) {}
  }
  const ready = initBudgets();
  async function fetchSource(source, c, r, e) {
    const now = Date.now(),
      b = budgets[source] || { last: 0, until: 0 };
    let result = {
      source,
      ok: false,
      aircraft: [],
      message: "Unavailable",
      received: now / 1000,
    };
    try {
      if (b.until > now)
        throw new Error(
          provider[source] +
            " cooling down; retry in " +
            Math.ceil((b.until - now) / 60000) +
            " min.",
        );
      if (now - b.last < 15000)
        throw new Error(
          provider[source] + ": wait 15 seconds between refreshes.",
        );
      budgets[source] = { last: now, until: 0 };
      await saveBudgets();
      if (e !== epoch || !active) throw new Error("Request interrupted.");
      const aircraft = [];
      for (const url of D.urls(source, c, r)) {
        const response = await transport(url);
        statusError(response, provider[source]);
        const json = JSON.parse(response.text);
        aircraft.push(...D[source](json, Date.now() / 1000));
      }
      result = {
        ...result,
        ok: true,
        aircraft,
        message: "Live",
        received: Date.now() / 1000,
      };
    } catch (error) {
      if (error.retryAfter) {
        budgets[source] = {
          last: now,
          until: Date.now() + error.retryAfter * 1000,
        };
        await saveBudgets();
      }
      result.message = describe(error);
    }
    return result;
  }
  function setBusy(value) {
    busy = value;
    for (const id of [
      "refresh",
      "source",
      "radius",
      "show-aircraft",
      "use-location",
      "search-here",
    ])
      $(id).disabled = value;
    $("progress").hidden = !value;
    $("refresh").textContent = value ? "…" : "↻";
  }
  async function refresh() {
    if (!area || busy || !active) return;
    await ready;
    if (busy || !active) return;
    setBusy(true);
    const e = epoch,
      c = { ...area },
      r = radius;
    message($("status"), "Refreshing aircraft…");
    try {
      const results = await Promise.all(
        D.sources(mode).map((s) => fetchSource(s, c, r, e)),
      );
      if (e !== epoch || !active) return;
      for (const result of results) feeds = D.update(feeds, result);
      lastUpdated = Date.now();
      nextRefresh = lastUpdated + 30000;
      const errors = results.filter((x) => !x.ok).map((x) => x.message);
      message($("status"), errors.join(" "), errors.length ? "attention" : "");
      render();
    } finally {
      if (e === epoch) setBusy(false);
    }
  }
  function selectArea(c, fit = true) {
    if (busy || !active) return;
    area = c;
    feeds = {};
    selected = null;
    lastUpdated = 0;
    $("welcome").hidden = true;
    $("workspace").hidden = false;
    $("search-here").hidden = true;
    $("area-label").textContent =
      `Chosen area · ${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}`;
    map.setArea(c, radius, fit);
    render();
    refresh();
  }
  function showArea() {
    if (!active) return;
    if (area) {
      $("latitude").value = area.lat.toFixed(6);
      $("longitude").value = area.lon.toFixed(6);
    }
    message($("area-status"), "");
    $("area-dialog").showModal();
  }
  $("start").onclick = showArea;
  $("area").onclick = showArea;
  $("cancel-area").onclick = () => $("area-dialog").close();
  $("area-form").onsubmit = (e) => {
    e.preventDefault();
    if (busy) {
      message(
        $("area-status"),
        "Wait for the current refresh to finish.",
        "attention",
      );
      return;
    }
    const lat = $("latitude").value.trim(),
      lon = $("longitude").value.trim();
    const valid =
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(lat) &&
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(lon),
      c = valid ? D.point(Number(lat), Number(lon)) : null;
    if (!c) {
      message(
        $("area-status"),
        "Enter latitude −85 to 85 and longitude −180 to 180.",
        "error",
      );
      return;
    }
    $("area-dialog").close();
    selectArea(c);
  };
  $("use-location").onclick = async () => {
    if (busy || !active) return;
    const e = epoch;
    setBusy(true);
    message($("area-status"), "Getting one location fix…");
    try {
      const l = await call("location.read", { op: "get" });
      if (e !== epoch || !active) return;
      const c = D.point(l.latitude, l.longitude);
      if (!c)
        throw new Error("This map supports latitudes between −85 and 85.");
      $("latitude").value = c.lat.toFixed(6);
      $("longitude").value = c.lon.toFixed(6);
      message(
        $("area-status"),
        `Location ready · accuracy about ${Math.round(l.accuracyM)} m${l.approximate ? " · approximate" : ""}. Tap Show aircraft.`,
      );
    } catch (error) {
      if (e === epoch) message($("area-status"), describe(error), "attention");
    } finally {
      if (e === epoch) setBusy(false);
    }
  };
  $("refresh").onclick = refresh;
  $("source").onchange = () => {
    if (busy) return;
    mode = $("source").value;
    selected = null;
    render();
    refresh();
  };
  $("radius").onchange = () => {
    if (busy) return;
    radius = Number($("radius").value);
    if (area) {
      map.setArea(area, radius);
      render();
      refresh();
    }
  };
  $("auto").onchange = () => {
    auto = $("auto").checked;
    nextRefresh = Date.now() + 30000;
  };
  $("zoom-in").onclick = () => map.zoomBy(1);
  $("zoom-out").onclick = () => map.zoomBy(-1);
  $("center").onclick = () => {
    map.reset();
    $("search-here").hidden = true;
  };
  $("search-here").onclick = () => {
    if (!busy) selectArea({ ...map.center }, false);
  };
  const altitude = (a) =>
    a.altitudeM === null
      ? "Unknown"
      : Math.round(a.altitudeM / 0.3048).toLocaleString() + " ft";
  const speed = (a) =>
    a.speedMps === null ? "Unknown" : Math.round(a.speedMps * 3.6) + " km/h";
  const liveLine = (a) =>
    `${where(a)} · ${altitude(a)} · ${speed(a)} · ${Math.max(0, Math.round(Date.now() / 1000 - a.positionTime))} s ago`;
  function where(a) {
    const b = D.bearing(area, a.point);
    return `${D.distance(area, a.point).toFixed(1)} km · ${D.compass(b)}`;
  }
  function detailLine(parent, label, value) {
    if (value == null || value === "") return;
    const pair = element("div", null, "detail-line");
    pair.append(element("dt", label), element("dd", value));
    parent.append(pair);
  }
  function render() {
    if (!area) return;
    rows = D.merge(feeds, mode, area, radius, Date.now() / 1000);
    $("count").textContent = rows.length + " aircraft";
    $("source-status").replaceChildren();
    for (const s of D.sources(mode)) {
      const f = feeds[s];
      $("source-status").append(
        element(
          "span",
          provider[s] + " · " + (f ? (f.ok ? "live" : "problem") : "waiting"),
          "chip",
        ),
      );
    }
    const list = $("aircraft-list");
    list.replaceChildren();
    for (const a of rows) {
      const button = element("button", null, "aircraft");
      button.setAttribute("aria-pressed", String(a.key === selected));
      button.append(
        element(
          "strong",
          (a.track === null
            ? "• "
            : D.kind(a) === "rotorcraft"
              ? "✣ "
              : "✈ ") + D.label(a),
        ),
        element(
          "span",
          [a.registration, D.name(a.type)].filter(Boolean).join(" · "),
        ),
        element("span", liveLine(a)),
      );
      button.lastElementChild.dataset.liveKey = a.key;
      button.onclick = () => {
        selected = a.key;
        render();
        $("selected").scrollIntoView({ block: "nearest" });
      };
      list.append(button);
    }
    if (!rows.length)
      list.append(
        element(
          "p",
          lastUpdated
            ? "No recent airborne aircraft in this area."
            : "Choose an area and refresh.",
          "note",
        ),
      );
    const card = $("selected"),
      a = rows.find((x) => x.key === selected);
    card.hidden = !a;
    card.replaceChildren();
    if (a) {
      card.append(
        element("h2", D.label(a)),
        element(
          "p",
          [a.registration, D.name(a.type)].filter(Boolean).join(" · "),
        ),
        element("span", kindName[D.kind(a)], "chip"),
      );
      if (Date.now() / 1000 - a.positionTime > 30)
        card.append(element("span", "Stale", "chip attention"));
      const dl = element("dl");
      detailLine(
        dl,
        "Where",
        where(a) +
          " of your area · bearing " +
          Math.round(D.bearing(area, a.point)) +
          "°",
      );
      detailLine(dl, "Altitude", altitude(a) + " barometric");
      detailLine(dl, "Speed", speed(a) + " over ground");
      detailLine(
        dl,
        "Heading",
        a.track === null
          ? "Unknown ground track"
          : Math.round(a.track) + "° " + D.compass(a.track) + " ground track",
      );
      detailLine(
        dl,
        "Seen",
        Math.max(0, Math.round(Date.now() / 1000 - a.positionTime)) +
          " s ago · " +
          provider[a.source] +
          " position",
      );
      detailLine(
        dl,
        "Reported by",
        a.sources.map((s) => provider[s]).join(" + "),
      );
      if (a.identityConflict)
        detailLine(
          dl,
          "Identity",
          "Sources disagree; inspect source-labelled details.",
        );
      card.append(dl);
      const actions = element("div", null, "selected-actions"),
        more = element("button", "More aircraft info"),
        dismiss = element("button", "Dismiss details");
      more.onclick = () => showInfo(a);
      dismiss.onclick = () => {
        selected = null;
        render();
      };
      actions.append(more, dismiss);
      card.append(actions);
    }
    map.update(rows, selected);
    tickStatus();
  }
  function tickStatus() {
    if (lastUpdated)
      $("updated").textContent =
        `Updated ${Math.max(0, Math.round((Date.now() - lastUpdated) / 1000))} s ago` +
        (auto
          ? ` · next in ${Math.max(0, Math.ceil((nextRefresh - Date.now()) / 1000))} s`
          : "");
  }
  function localInfo(a) {
    const body = $("info-body");
    body.replaceChildren();
    body.append(
      element("h3", D.name(a.type)),
      element("p", [a.registration, a.type].filter(Boolean).join(" · ")),
      element("p", "Model type: " + kindName[D.kind(a)]),
    );
    body.append(
      element(
        "p",
        `Type: ${provider[a.typeSource] || "unknown"} · registration: ${provider[a.registrationSource] || "unknown"}`,
        "note",
      ),
    );
    if (a.category)
      body.append(
        element(
          "p",
          `Reported category: ${a.category} · ${provider[a.categorySource] || "unknown"}`,
        ),
      );
    if (a.identityConflict)
      body.append(
        element(
          "p",
          "Live sources disagree on identity. Database results below do not replace the live report.",
          "attention",
        ),
      );
    return body;
  }
  function showInfo(a) {
    infoTarget = { ...a };
    infoBusy = false;
    $("lookup").disabled = !D.lookup(a);
    $("lookup").textContent = "Look up with ADSBdb";
    $("info-title").textContent = "Aircraft info · " + D.label(a);
    const body = localInfo(a),
      request = D.lookup(a);
    body.append(
      element(
        "p",
        request
          ? `Optional lookup: only when you tap Look up, this sends aircraft ICAO ${request.icao}${request.airline ? " and callsign prefix " + request.airline : ""} to ADSBdb. The service sees your IP address, not your GPS coordinates. Records can be missing or old. Results stay in memory until you leave Sky Watch.`
          : "No real ICAO address is available for this report.",
        "note",
      ),
    );
    $("info-dialog").showModal();
  }
  $("close-info").onclick = () => {
    $("info-dialog").close();
    infoTarget = null;
  };
  $("info-dialog").addEventListener("cancel", () => {
    infoTarget = null;
  });
  async function metadataPart(path, parse) {
    const cached = metadata.get(path);
    if (cached && cached.until > Date.now()) return cached;
    let value;
    const b = budgets.adsbdb || { last: 0, until: 0 };
    try {
      if (b.until > Date.now())
        throw new Error("ADSBdb is cooling down. Tracking still works.");
      const response = await transport("https://api.adsbdb.com/v0/" + path);
      if (response.status === 404)
        value = {
          message: "No matching database record.",
          until: Date.now() + 300000,
        };
      else {
        statusError(response, "ADSBdb");
        value = {
          ...parse(JSON.parse(response.text)),
          until: Date.now() + 3600000,
        };
      }
    } catch (error) {
      if (error.retryAfter) {
        budgets.adsbdb = {
          last: Date.now(),
          until: Date.now() + error.retryAfter * 1000,
        };
        await saveBudgets();
      }
      value = { message: describe(error), until: 0 };
    }
    value.checkedAt = Date.now();
    if (value.until) {
      metadata.set(path, value);
      while (metadata.size > 64) metadata.delete(metadata.keys().next().value);
    }
    return value;
  }
  $("lookup").onclick = async () => {
    if (infoBusy || !infoTarget || !active) return;
    const a = infoTarget,
      request = D.lookup(a),
      e = epoch;
    if (!request) return;
    infoBusy = true;
    $("lookup").disabled = true;
    $("lookup").textContent = "Looking up…";
    try {
      const aircraft = await metadataPart("aircraft/" + request.icao, (j) => ({
          aircraft: D.aircraftInfo(j, request.icao),
        })),
        airline = request.airline
          ? await metadataPart("airline/" + request.airline, (j) => ({
              airline: D.airlineInfo(j, request.airline),
            }))
          : null;
      if (e !== epoch || !active || infoTarget !== a) return;
      const body = localInfo(a),
        section = element("section", null, "metadata-section");
      section.append(element("h3", "ADSBdb record"));
      if (aircraft.message) section.append(element("p", aircraft.message));
      const dl = element("dl");
      if (aircraft.aircraft) {
        const d = aircraft.aircraft;
        for (const [label, value] of [
          ["Manufacturer", d.manufacturer],
          ["Database model", d.model],
          ["Database type", d.typeCode],
          ["Registration", d.registration],
          ["Registry owner", d.owner],
          ["Registry country", d.country],
        ])
          detailLine(dl, label, value);
        if (
          (d.registration &&
            a.registration &&
            d.registration !== a.registration) ||
          (d.typeCode && a.type && d.typeCode !== a.type)
        )
          section.append(
            element(
              "p",
              "Database identity differs from the live feed. Records may be outdated.",
              "attention",
            ),
          );
      }
      if (airline)
        detailLine(
          dl,
          "Callsign airline",
          airline.airline
            ? airline.airline + " (" + request.airline + ")"
            : airline.message || "No unambiguous airline match.",
        );
      section.append(
        dl,
        element(
          "p",
          "Registry owner and callsign airline can differ through leasing or old records. These are not a verified current operator or private/cargo flight classification.",
          "note",
        ),
        element(
          "p",
          "Aircraft retrieved: " +
            new Date(aircraft.checkedAt).toLocaleTimeString(),
          "note",
        ),
      );
      if (airline)
        section.append(
          element(
            "p",
            "Airline retrieved: " +
              new Date(airline.checkedAt).toLocaleTimeString(),
            "note",
          ),
        );
      section.append(
        element(
          "p",
          "Retrieval times are not database update dates. Source: ADSBdb / PlaneBase.",
          "note",
        ),
      );
      body.append(section);
    } finally {
      if (infoTarget === a) {
        infoBusy = false;
        $("lookup").disabled = false;
        $("lookup").textContent = "Look up again";
      }
    }
  };
  window.addEventListener("constructvisibilitychange", (event) => {
    active = event.detail?.visible !== false;
    epoch++;
    if (!active) {
      while (queue.length) queue.shift().reject(new Error("Request paused."));
      setBusy(false);
      infoBusy = false;
      if ($("info-dialog").open) {
        $("info-dialog").close();
        infoTarget = null;
      }
      message($("status"), "Refresh paused while Construct’s menu is open.");
    }
    map.pause(!active);
    if (active) {
      nextRefresh = Date.now() + 30000;
      render();
      pump();
    }
  });
  setInterval(() => {
    if (!active || !area) return;
    tickStatus();
    if (auto && !busy && Date.now() >= nextRefresh) refresh();
    else if (!busy) {
      const next = D.merge(feeds, mode, area, radius, Date.now() / 1000);
      if (next.map((a) => a.key).join() !== rows.map((a) => a.key).join())
        render();
      else {
        for (const el of document.querySelectorAll("[data-live-key]")) {
          const a = rows.find((a) => a.key === el.dataset.liveKey);
          if (a) el.textContent = liveLine(a);
        }
        map.update(rows, selected);
      }
    }
  }, 1000);
})();
