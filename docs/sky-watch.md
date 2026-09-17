# Sky Watch — module-owned map

Sky Watch **0.2.2** runs its aircraft logic and UI in the signed HTML/CSS/JavaScript
module, using host **API 0.9 / alpha26**. The new package does not call `sky.watch`.
Camera/AR remains deferred.

## Module 0.2.x: installation and ownership

Install the compatible host first, then update Sky Watch through Browse. The old
`sky.watch` grant does **not** grant the new APIs. Allow **approved internet sources**
in native consent/Module access. For optional phone location, separately allow
**reading phone location** and **Android location access** there, then reopen.
Manual coordinates need no location permission. The approved sources are
`api.adsb.lol`, `opensky-network.org`, `tile.openstreetmap.org` and `api.adsbdb.com`.
They use HTTPS only. Source expansion requires fresh consent.

The module owns provider URLs/parsing, freshness, deduplication, identity/glossary,
ADSBdb interpretation, polling/backoff, Canvas map rendering and controls. The host
owns only bounded `net.http`, `location.read`, storage and the trusted shell/grants.
See [the generic API contract](module-api.md). A model name or provider parser
change now ships by signing a new module version; no APK change is required.

The map retains source/radius controls, aircraft selection/details, manual area or
one GPS fix, pan/zoom/recenter/Search here, stale markers and optional metadata
lookup. Auto refresh is opt-in, every 30 seconds. Module provider requests have a
persisted 15-second floor and quota backoff; the host independently enforces its
hard transport budget. Selected labels disappear off-screen; details remain until
the aircraft expires or selection changes. Rotation retains state; real background
exit discards coordinates, observations and the in-memory metadata cache.

Unlike 0.1.0, approved data now reaches module code. This module sends only the
chosen area to aircraft feeds, viewed tile coordinates to OpenStreetMap, and the
selected aircraft/callsign identifiers to ADSBdb after the explicit lookup button.
Only provider cooldowns are persisted in module storage. The host may cache raster
responses; it does not cache JSON. Data composition is explained in trusted consent.

Legacy 0.1.0 remains supported by the native workspace for existing installations
and rollback. The following sections describe that baseline and shared aviation
semantics; legacy native worker/request limits are **not** the new HTTP API limits.

## Historical 0.1.0 launcher baseline (API 0.8 / alpha23–27)

The following sections describe the retired native workspace, **not alpha28
runtime behavior**. Alpha28 removes that implementation; old required callers
need a module update. See [retirement and rollback handling](shell-retirement.md).

## Interaction

- Grant **Allow Sky Watch map and data**, then open the aircraft map.
- **Use my location** requests Android foreground location permission in response
  to that native button. Approximate location is supported. Alternatively enter a
  latitude/longitude; neither phone location nor permission is required then.
  Location uses one recent fix, not continuous movement tracking. To update it,
  choose **Area → Use my location** again.
- Pick **ADSB.lol**, **OpenSky**, or **Combined**, and 10/25/50/100 km.
- Pan, use zoom buttons, and **Search here** to move the search area. Panning alone
  does not change the aircraft-query center; the circle shows the actual radius.
- Tap a marker or list row for details. North is up; heading is ground track,
  not the aircraft's nose direction; an unknown track uses a neutral dot. Altitude is barometric feet, not height above
  the phone/terrain; speed is ground speed in km/h. Each row also gives the
  eight-point compass direction from the chosen area (the way to look), and the
  details card adds the exact bearing. The selected aircraft is haloed in jade
  with its label drawn on the map; amber markers are positions over 30 s old.
- Automatic updates run every 30 seconds while open, with a manual refresh and an
  off switch. The panel shows "Updated … ago" and the countdown to the next
  automatic refresh; a thin progress bar runs under the controls while fetching.
  Individual providers have a process-wide/persisted 15-second floor.
- Each active source has a worded chip (live / problem / waiting); "Sources &
  status" expands the provider messages, quota notes and unit explanations.
- Rotation retains the workspace. Leaving closes it, unregisters location updates,
  disconnects current HTTP requests and discards positions/coordinates. Reopening
  starts with area selection. No background tracking or notification service.

The radius is horizontal great-circle distance. Mercator map centers and aircraft
positions are restricted to latitude ±85°. Consumer drones and unreported traffic
are not generally visible. This is a spotting guide, not a navigation instrument.

## Providers and aggregation

ADSB.lol v2 radius queries use nautical miles (rounded up from the selected km,
then filtered to the exact requested circle). OpenSky `/states/all` uses bounding
boxes, split at the antimeridian, then the same circle filter. Only public,
unauthenticated OpenSky state queries are implemented; no credentials are needed
or accepted by the module. Its documented anonymous allowance is 400 daily
credits per IP, with cost dependent on bounding-box size; shared IP traffic can
consume that allowance. No guarantee of uninterrupted free updates is made.

Both formats normalize to metric internal values, ICAO identity, source and
**position** timestamp. Contact time is not used as a replacement for position
age. Ground traffic, missing/invalid coordinates and positions over 120 seconds
old are removed. Ages over 30 seconds are marked stale/amber. Unknown values stay
unknown instead of becoming zero.

Combined mode groups genuine ICAO addresses, takes the newest complete observation
without averaging coordinates or mixing altitude/time from different reports, and
retains a set of contributing sources. Non-ICAO ADSB.lol identifiers remain in a
separate namespace. Switching to one source filters out the other immediately.
A failed source leaves its recent cached positions visibly aging; another source
can still succeed. HTTP 429 honors numeric retry headers, with a conservative
fallback and a persisted per-provider backoff. Expired positions are removed even
when refresh is off or every connection is failing.

## Capability and privacy boundary

`sky.watch` supports only `{op:"open"}` and replies `{opened:true}`. It is explicit
opt-in, denied by default, and requires API 0.8.0. JavaScript cannot supply an area,
URL, credential, header, query, location operation or configuration; cannot trigger
location permission; and receives no positions, map pixels or aircraft data.
The existing no-network/no-geolocation WebView boundary is unchanged.

The native user-selected area is disclosed to the selected aircraft provider(s).
Visible tile coordinates are disclosed to OpenStreetMap. Those services also see
the connection's IP address. Standard OSM tiles are fetched only for the visible
viewport, with an identifying User-Agent, cache-header handling, no prefetch or
bulk download, and a bounded private disk cache (12 MiB). Cached tiles can imply
previously viewed areas; coordinates/aircraft are otherwise not persisted. Android
backup remains disabled. Clear the app cache to remove tiles. Per-source request
and backoff times are stored without area coordinates.

All requests have fixed HTTPS origins/paths, system CA validation, redirects off,
timeouts, body/row limits and access checks before use/at delivery. Permission
revocation/stale module identity fails closed. Activity is not exported. No camera,
microphone, new native library, external SDK, general module networking, location
analytics or credential storage is added. The APK adds only Android coarse/fine
foreground location permissions; no background-location permission.

## Attribution, access and release scope

- Map: © OpenStreetMap contributors, <https://www.openstreetmap.org/copyright>.
  Standard tile usage: <https://operations.osmfoundation.org/policies/tiles/>.
- ADSB.lol data: ODbL 1.0, <https://www.adsb.lol/docs/open-data/api/>.
  Its API documentation asks production integrators to contact the provider and
  warns that access may later require a key/feeding. This is an experimental pilot,
  not a claim of an agreed production service or SLA.
- OpenSky: <https://openskynetwork.github.io/opensky-api/> and linked terms.
  Cite Schäfer et al., *Bringing Up OpenSky: A Large-scale ADS-B Sensor Network
  for Research*, IPSN 2014, pp. 83–94. The public service is documented for
  research/non-commercial use; commercial distribution requires appropriate terms.

A provider's availability, quotas and terms can change. Neither provider is scraped
through its consumer UI. Production scaling/paid credentials are outside this pilot.

## Acceptance

Normalization, aggregation, unit conversion, stale/future rejection, source
isolation, antimeridian queries, radius filtering, capability/version gates and
revocation are covered by deterministic tests. Live checks use a public airport
reference, never a personal location. Actual optimized-APK emulator and physical
phone evidence must be reported separately; source tests alone do not establish
GPS, map rendering, lifecycle, physical location accuracy or phone acceptance.

## Aircraft identity and optional details (alpha25)

The selected card and nearby list decode a small, hand-curated glossary of common
ICAO type designators into readable model names. Unknown codes remain visible;
coverage is intentionally incomplete. The glossary consists of short factual
model/designator associations, not a copied aircraft database. Reference:
ICAO Aircraft Type Designators (Doc 8643), <https://www.icao.int/publications/DOC8643>.
A designator may cover multiple variants (for example B77L covers the 777-200LR
and freighter); the glossary is not a passenger/cargo/private-flight classifier.

ADSB.lol emitter categories and OpenSky's optional `extended=1` category are
normalized separately from models. Weight categories are not airline categories.
Reported rotorcraft/glider categories and known model families inform symbols;
unknown/conflicting classifications retain a generic symbol. Unknown ground
track still uses a non-directional dot. Speed/altitude never classify an aircraft.

Combined fills missing registration/type/category from other **active, recent**
source observations, with per-field provenance and an explicit disagreement note.
The newest coherent position/altitude/speed/time is unchanged. Switching to a
single source does not import identity from the disabled provider. Identity
expires with its supporting observation, even if a later position still exists.

**More aircraft info** first opens local information and a disclosure. Only the
separate **Look up with ADSBdb** button sends requests to the documented public
`https://api.adsbdb.com/v0/aircraft/{icao24}` and, when a recognizable callsign
prefix exists, `/v0/airline/{icao}` endpoints. No route endpoint, photograph,
redirect, arbitrary URL, API credential or phone coordinate is used. ADSBdb sees
the selected aircraft ID, optional three-letter airline prefix and connection IP.
The tracking-source selector still controls only live tracking providers.

Registry owner and callsign-associated airline are labelled separately. Leasing,
old records and callsign reuse can explain disagreements; neither field proves
current operator, occupants or flight purpose. Lookup facts never replace the
map's live identity. Errors/not-found are independent of tracking. Returned
identity is checked against the requested address before displaying any record.

Lookups have a separate worker, 8-second connect/read timeouts, 32 KiB response
bounds, no redirects, system TLS, capability checks before and after requests
and on cached reads, and a conservative 30-request/minute persisted limit plus
429 backoff. Cache only parsed aircraft/airline fields in memory: at most 64
records, one hour for successes, five minutes for not-found. No positions,
queries, owners or lookup responses are saved to disk. Leaving clears the cache,
closes connections and invalidates pending UI results. Reopening requires a new
explicit lookup. The retrieved timestamp is **not** the database's update date.

ADSBdb documents its public GET API and rate limits at <https://www.adsbdb.com/>
and <https://github.com/mrjackwills/adsbdb>. Aircraft data is credited to PlaneBase.
This integration uses individual public API lookups with a transient session
cache; it does **not** bundle, scrape or redistribute an aircraft database. The
software's MIT license is not presented as a license for upstream databases.
ADSBdb's separately restricted flight-route data is excluded entirely. Bulk or
persistent database reuse needs a separate terms assessment; no such rights or
provider agreement are claimed by this pilot. Photos and live routes remain
out of scope.
