"use strict";
// Synthetic Space Watch: disposable acceptance fixture, never a product. Loaded
// after bridge.js, before app.js. It pins a known sky so the dome, list and
// words have known answers:
//   clock          → starts at 2026-09-28 17:50:40 UTC and runs in real time
//                    (Berlin twilight; the ISS pass matches Heavens-Above)
//   location.read  → a fixed Berlin viewpoint (clearly synthetic, 10 m accuracy)
//   net.http       → CelesTrak's bright-object orbits and catalog from a
//                    captured 2026-09-27 subset (24 objects), and the
//                    last-30-days lists reduced to two trains (Starlink
//                    2026-219, Guowang 2026-221). Other requests
//                    (same-launch lookups, Wikipedia) go to the real host.
// Storage and grants are the real host. The fixture-only query parameter
// ?celestrak=503 answers the orbit list with HTTP 503 to show the error path.
const SpaceFixture = (() => {
  const START = Date.parse("2026-09-28T17:50:40Z"),
    loaded = Date.now(),
    ELEMENTS = /*ELEMENTS*/ null,
    SATCAT = /*SATCAT*/ null,
    RECENT = /*RECENT*/ null,
    RECENT_SATCAT = /*RECENT_SATCAT*/ null,
    host = call,
    params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const json = (value) => ({
    status: 200,
    headers: { "content-type": "application/json" },
    text: JSON.stringify(value),
  });
  call = async (method, p = {}) => {
    if (method === "location.read")
      return { latitude: 52.52, longitude: 13.405, accuracyM: 10, timestamp: Date.now(), approximate: false };
    if (method === "net.http" && typeof p.url === "string") {
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
