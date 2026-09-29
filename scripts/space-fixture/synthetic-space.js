"use strict";
// Synthetic Space Watch: disposable acceptance fixture, never a product. Loaded
// after bridge.js, before app.js. It pins a known sky so the dome, list and
// words have known answers:
//   clock          → starts at 2026-09-28 17:50:40 UTC and runs in real time
//                    (Berlin twilight; the ISS pass matches Heavens-Above)
//   location.read  → a fixed Berlin viewpoint (clearly synthetic, 10 m accuracy)
//   net.http       → CelesTrak's bright-object orbits and catalog from a
//                    captured 2026-09-27 subset (24 objects), and the
//                    last-30-days lists reduced to two candidate batches (Starlink
//                    2026-219, Guowang 2026-221). Other requests
//                    (same-launch lookups, Wikipedia) go to the real host.
//   mirror         → a synthetic space-data mirror (dataset 20260928T1700Z)
//                    serving the same lists as compact rows, plus captured
//                    navigation (172) and geostationary (190) satellites
//                    for the layers. ?mirror=off answers it with HTTP 503 to
//                    show the CelesTrak fallback.
// The old shared Starlink elements are retained to test stale-batch exclusion;
// Guowang is the qualifying train under the 72-hour freshness rule.
// Storage uses the real host. Location/orbit fixture answers bypass native grants. The fixture-only query parameter
// ?celestrak=503 answers the orbit list (mirror and CelesTrak) with HTTP 503
// to show the error path.
const SpaceFixture = (() => {
  const START = Date.parse("2026-09-28T17:50:40Z"),
    loaded = Date.now(),
    ELEMENTS = /*ELEMENTS*/ null,
    SATCAT = /*SATCAT*/ null,
    RECENT = /*RECENT*/ null,
    RECENT_SATCAT = /*RECENT_SATCAT*/ null,
    GNSS = /*GNSS*/ null,
    GNSS_SATCAT = /*GNSS_SATCAT*/ null,
    GEO = /*GEO*/ null,
    GEO_SATCAT = /*GEO_SATCAT*/ null,
    MIRROR = "https://space-data.pages.dev/v1/",
    host = call,
    params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const json = (value) => ({
    status: 200,
    headers: { "content-type": "application/json" },
    text: JSON.stringify(value),
  });
  let mirrorFiles = null;
  // Built lazily: SpaceOrbit and SpaceCatalog load after this script.
  function mirror() {
    if (mirrorFiles) return mirrorFiles;
    const dataset = "20260928T1700Z",
      files = {},
      groups = {};
    const add = (group, kind, list, compact) => {
      const rows = [...new Map(list.map(compact).filter(Boolean).map((r) => [r[0], r])).values()],
        file = `${group}/${kind}-1.json`;
      files[`${MIRROR}${dataset}/${file}`] = { schema: 1, kind, rows };
      (groups[group] = groups[group] || {})[kind] = [{ file, rows: rows.length }];
    };
    for (const [group, elements, catalog] of [
      ["visual", ELEMENTS, SATCAT],
      ["last-30-days", RECENT, RECENT_SATCAT],
      ["gnss", GNSS, GNSS_SATCAT],
      ["geo", GEO, GEO_SATCAT],
    ]) {
      add(group, "elements", elements, SpaceOrbit.compact);
      add(group, "satcat", catalog, SpaceCatalog.compact);
    }
    files[MIRROR + "index.json"] = { schema: 1, dataset, built: "2026-09-28T17:00:00Z", path: dataset + "/", groups };
    return (mirrorFiles = files);
  }
  call = async (method, p = {}) => {
    if (method === "location.read")
      return { latitude: 52.52, longitude: 13.405, accuracyM: 10, timestamp: Date.now(), approximate: false };
    if (method === "net.http" && typeof p.url === "string") {
      if (p.url.startsWith(MIRROR)) {
        if (params.get("mirror") === "off" || params.get("celestrak") === "503") return { status: 503, headers: {} };
        const body = mirror()[p.url];
        return body ? json(body) : { status: 404, headers: {} };
      }
      if (p.url.startsWith("https://celestrak.org/NORAD/elements/gp.php?GROUP=visual"))
        return params.get("celestrak") === "503" ? { status: 503, headers: {} } : json(ELEMENTS);
      if (p.url.startsWith("https://celestrak.org/satcat/records.php?GROUP=visual")) return json(SATCAT);
      if (p.url.startsWith("https://celestrak.org/NORAD/elements/gp.php?GROUP=last-30-days")) return json(RECENT);
      if (p.url.startsWith("https://celestrak.org/satcat/records.php?GROUP=last-30-days")) return json(RECENT_SATCAT);
    }
    return host(method, p);
  };
  return { now: () => START + (Date.now() - loaded), START };
})();
