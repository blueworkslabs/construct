"use strict";
// What an object is: CelesTrak SATCAT rows, plain-language names for rocket
// stages, a small curated set of famous objects and the optional Wikipedia text.
const SpaceCatalog = (() => {
  const ELEMENTS_URL =
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json",
    SATCAT_URL =
      "https://celestrak.org/satcat/records.php?GROUP=visual&FORMAT=json",
    WIKI = "https://en.wikipedia.org/w/api.php";
  const TYPES = new Set(["PAY", "R/B", "DEB", "UNK"]),
    DATE = /^\d{4}-\d\d-\d\d$/,
    INTDES = /^\d{4}-\d{3}[A-Z]{1,3}$/,
    OWNER = /^[A-Z]{1,6}$/;
  const num = (x, min, max) =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max
      ? x
      : null;
  const text = (x, n = 40) =>
    typeof x === "string"
      ? x
          .replace(/[^\x20-\x7e]/g, "")
          .trim()
          .slice(0, n) || null
      : null;
  // Compact row: [id, type, owner, launch, decay, periodMin, apogeeKm, perigeeKm, rcsM2, intdes, name]
  function compact(o) {
    if (!o || typeof o !== "object") return null;
    const id = o.NORAD_CAT_ID;
    if (!Number.isInteger(id) || id < 1 || id > 999999999) return null;
    const type = TYPES.has(o.OBJECT_TYPE) ? o.OBJECT_TYPE : "UNK";
    return [
      id,
      type,
      typeof o.OWNER === "string" && OWNER.test(o.OWNER) ? o.OWNER : null,
      typeof o.LAUNCH_DATE === "string" && DATE.test(o.LAUNCH_DATE) ? o.LAUNCH_DATE : null,
      typeof o.DECAY_DATE === "string" && DATE.test(o.DECAY_DATE) ? o.DECAY_DATE : null,
      num(o.PERIOD, 1, 100000),
      num(o.APOGEE, 0, 1000000),
      num(o.PERIGEE, 0, 1000000),
      num(o.RCS, 0, 100000),
      typeof o.OBJECT_ID === "string" && INTDES.test(o.OBJECT_ID) ? o.OBJECT_ID : null,
      text(o.OBJECT_NAME),
    ];
  }
  function validRow(r) {
    if (!Array.isArray(r) || r.length !== 11) return null;
    return compact({
      NORAD_CAT_ID: r[0],
      OBJECT_TYPE: r[1],
      OWNER: r[2],
      LAUNCH_DATE: r[3],
      DECAY_DATE: r[4],
      PERIOD: r[5],
      APOGEE: r[6],
      PERIGEE: r[7],
      RCS: r[8],
      OBJECT_ID: r[9],
      OBJECT_NAME: r[10],
    });
  }
  function rows(list, check = compact, max = 400) {
    if (!Array.isArray(list)) return [];
    const seen = new Set(),
      out = [];
    for (const o of list) {
      const r = check(o);
      if (!r || seen.has(r[0])) continue;
      seen.add(r[0]);
      out.push(r);
      if (out.length >= max) break;
    }
    return out;
  }
  function parseSatcat(body) {
    try {
      return rows(JSON.parse(body));
    } catch (_) {
      return [];
    }
  }
  const record = (r) =>
    r && {
      id: r[0],
      type: r[1],
      owner: r[2],
      launch: r[3],
      decay: r[4],
      period: r[5],
      apogee: r[6],
      perigee: r[7],
      rcs: r[8],
      intdes: r[9],
      name: r[10],
    };
  const index = (rowList) => new Map(rowList.map((r) => [r[0], record(r)]));
  const OWNERS = {
    US: "USA",
    CIS: "Soviet Union / Russia",
    PRC: "China",
    JPN: "Japan",
    FR: "France",
    ESA: "European Space Agency",
    IT: "Italy",
    IND: "India",
    CA: "Canada",
    ARGN: "Argentina",
    ISS: "ISS partner agencies",
    UK: "United Kingdom",
    GER: "Germany",
    SKOR: "South Korea",
    ISRA: "Israel",
    BRAZ: "Brazil",
    SPN: "Spain",
    TURK: "Türkiye",
    UAE: "United Arab Emirates",
    EUME: "EUMETSAT",
    EUTE: "Eutelsat",
    GLOB: "Globalstar",
    O3B: "O3b / SES",
    SES: "SES",
    NZ: "New Zealand",
    AUS: "Australia",
  };
  const owner = (code) => (code ? OWNERS[code] || code : null);
  // Rocket stages are named by their launcher. Wikipedia titles for the
  // launcher articles; the SL-n names are the western designations.
  const LAUNCHERS = [
    [/^SL-16\b/, "Zenit", "Zenit (rocket family)"],
    [/^SL-14\b/, "Tsyklon-3", "Tsyklon-3"],
    [/^SL-8\b/, "Kosmos-3M", "Kosmos-3M"],
    [/^SL-3\b/, "Vostok", "Vostok (rocket family)"],
    [/^SL-4\b/, "Soyuz", "Soyuz (rocket family)"],
    [/^SL-6\b/, "Molniya", "Molniya (rocket)"],
    [/^SL-12\b/, "Proton", "Proton (rocket family)"],
    [/^CZ-2C\b/, "Long March 2C", "Long March 2C"],
    [/^CZ-2D\b/, "Long March 2D", "Long March 2D"],
    [/^CZ-4B\b/, "Long March 4B", "Long March 4B"],
    [/^CZ-4C\b/, "Long March 4C", "Long March 4C"],
    [/^CZ-6A\b/, "Long March 6A", "Long March 6A"],
    [/^CZ-8A?\b/, "Long March 8", "Long March 8"],
    [/^H-2A\b/, "H-IIA", "H-IIA"],
    [/^ARIANE 4/, "Ariane 4", "Ariane 4"],
    [/^ARIANE 5\b/, "Ariane 5", "Ariane 5"],
    [/^DELTA 1\b/, "Delta", "Delta (rocket family)"],
    [/^DELTA 2\b/, "Delta II", "Delta II"],
    [/^THOR AGENA/, "Thor-Agena", "Thor-Agena"],
    [/^ATLAS CENTAUR/, "Atlas-Centaur", "Atlas-Centaur"],
    [/^TITAN 4/, "Titan IV", "Titan IV"],
    [/^GSLV\b/, "GSLV", "Geosynchronous Satellite Launch Vehicle"],
    [/^PSLV\b/, "PSLV", "Polar Satellite Launch Vehicle"],
    [/^FALCON 9\b/, "Falcon 9", "Falcon 9"],
  ];
  // Curated where SATCAT says little. Keep claims short and durable.
  const NOTABLE = {
    25544: { title: "ISS (Zarya)", kind: "International Space Station · crewed", wiki: "International Space Station", major: true },
    48274: { title: "Tiangong (Tianhe)", kind: "Chinese space station · crewed", wiki: "Tiangong space station", major: true },
    20580: { title: "Hubble Space Telescope", kind: "Space telescope", wiki: "Hubble Space Telescope", major: true },
    27386: { title: "Envisat", kind: "Retired European Earth-observation satellite", wiki: "Envisat" },
    25994: { title: "Terra", kind: "NASA Earth-observation satellite", wiki: "Terra (satellite)" },
    27424: { title: "Aqua", kind: "NASA Earth-observation satellite", wiki: "Aqua (satellite)" },
    16908: { title: "Ajisai", kind: "Japanese geodetic satellite covered in mirrors", wiki: "Ajisai (satellite)" },
    10967: { title: "Seasat", kind: "NASA ocean satellite from 1978", wiki: "Seasat" },
    41337: { title: "Hitomi (ASTRO-H)", kind: "Japanese X-ray observatory, lost in 2016", wiki: "Hitomi (satellite)" },
    57800: { title: "XRISM", kind: "Japanese X-ray observatory", wiki: "XRISM" },
    59588: { title: "ACS3", kind: "NASA solar-sail test", wiki: "Advanced Composite Solar Sail System" },
  };
  const TYPE_KIND = {
    PAY: "Satellite",
    "R/B": "Spent rocket stage",
    DEB: "Debris",
    UNK: "Object",
  };
  function describe(o, c) {
    const n = NOTABLE[o.id];
    if (n) return { title: n.title, kind: n.kind, wiki: n.wiki, major: !!n.major };
    const type = c ? c.type : /\bR\/B\b/.test(o.name) ? "R/B" : /\bDEB\b/.test(o.name) ? "DEB" : "UNK";
    const who = c && owner(c.owner);
    if (type === "R/B") {
      const l = LAUNCHERS.find(([re]) => re.test(o.name));
      return {
        title: l ? `${l[1]} rocket stage` : o.name,
        kind: `Spent upper stage${who ? " · " + who : ""}`,
        wiki: l ? l[2] : null,
        major: false,
      };
    }
    if (/^SPACEMOBILE-/.test(o.name))
      return { title: o.name, kind: "AST SpaceMobile BlueBird satellite", wiki: "AST SpaceMobile", major: false };
    const kosmos = /^COSMOS (\d{1,4})$/.exec(o.name);
    return {
      title: o.name,
      kind: `${TYPE_KIND[type]}${who ? " · " + who : ""}`,
      wiki: kosmos ? `Kosmos ${kosmos[1]}` : null,
      search: type === "PAY" ? o.name : null,
      major: false,
    };
  }
  function rcsWords(rcs) {
    if (rcs === null || rcs === undefined) return "Unknown";
    if (rcs >= 100) return "Very large";
    if (rcs >= 10) return "Large";
    if (rcs >= 1) return "Medium";
    if (rcs >= 0.1) return "Small";
    return "Tiny";
  }
  function period(min) {
    if (!min) return null;
    return min < 120
      ? `${Math.round(min)} min`
      : `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
  }
  function years(launch, ms) {
    if (!launch) return null;
    const y = (ms - Date.parse(launch + "T00:00:00Z")) / 31557600000;
    return y >= 1 ? `${Math.floor(y)} year${Math.floor(y) === 1 ? "" : "s"}` : "less than a year";
  }
  // Everything else from the same launch: payloads it carried, pieces, reentries.
  const launchUrl = (intdes) =>
    INTDES.test(intdes || "")
      ? `https://celestrak.org/satcat/records.php?INTDES=${intdes.slice(0, 8)}&FORMAT=json`
      : null;
  function parseLaunch(body, selfId) {
    return summarizeLaunch(parseSatcat(body), selfId);
  }
  function summarizeLaunch(rowList, selfId) {
    const list = rowList.map(record);
    const others = list.filter((x) => x.id !== selfId);
    const order = { PAY: 0, "R/B": 1, UNK: 2, DEB: 3 };
    others.sort((a, b) => order[a.type] - order[b.type] || (a.intdes || "").localeCompare(b.intdes || ""));
    return {
      total: others.length,
      payloads: others.filter((x) => x.type === "PAY").slice(0, 12),
      debris: others.filter((x) => x.type === "DEB").length,
      reentered: others.filter((x) => x.decay).length,
      stages: others.filter((x) => x.type === "R/B").length,
    };
  }
  // Wikipedia: intro text only, plain text, redirects resolved server-side
  // (Construct does not follow HTTP redirects).
  // A curated or derived title first; a one-result search as the fallback.
  function wikiUrl(d, search = false) {
    const base = `${WIKI}?action=query&format=json&formatversion=2&prop=extracts%7Cinfo&inprop=url&exintro=1&explaintext=1&exsentences=4&redirects=1`;
    if (d.wiki && !search) return `${base}&titles=${encodeURIComponent(d.wiki)}`;
    if (d.search)
      return `${base}&generator=search&gsrlimit=1&gsrsearch=${encodeURIComponent(d.search + " satellite")}`;
    return null;
  }
  function parseWiki(body) {
    let j;
    try {
      j = JSON.parse(body);
    } catch (_) {
      return null;
    }
    const pages = j && j.query && Array.isArray(j.query.pages) ? j.query.pages : [];
    const p = pages.find((x) => x && !x.missing && typeof x.extract === "string");
    if (!p) return null;
    let extract = p.extract.replace(/\s+/g, " ").trim();
    if (extract.length > 900) extract = extract.slice(0, 900).replace(/\s+\S*$/, "") + "…";
    const title = typeof p.title === "string" ? p.title.slice(0, 120) : "";
    if (!extract || !title) return null;
    const url =
      typeof p.fullurl === "string" && p.fullurl.startsWith("https://en.wikipedia.org/wiki/")
        ? p.fullurl.slice(0, 300)
        : null;
    return { title, extract, url };
  }
  return {
    ELEMENTS_URL,
    SATCAT_URL,
    compact,
    validRow,
    rows,
    parseSatcat,
    index,
    owner,
    describe,
    rcsWords,
    period,
    years,
    launchUrl,
    parseLaunch,
    summarizeLaunch,
    wikiUrl,
    parseWiki,
    NOTABLE,
  };
})();
if (typeof module !== "undefined") module.exports = SpaceCatalog;
