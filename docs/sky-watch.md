# Sky Watch — map-first pilot

Sky Watch is a signed launcher for a foreground native aircraft map, introduced
with host API **0.8.0** / **alpha23**. Camera/AR is deliberately deferred.

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
  not the aircraft's nose direction. Altitude is barometric feet, not height above
  the phone/terrain; speed is ground speed in km/h.
- Automatic updates run every 30 seconds while open, with a manual refresh and an
  off switch. Individual providers have a process-wide/persisted 15-second floor.
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
