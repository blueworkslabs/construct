# Public catalog and APK distribution

The public repository owns `catalog/`: the production index, immutable signed
module ZIPs, a public verification key, and a small static landing page. Cloudflare
Pages serves this directory; Android APKs are separate GitHub Release assets.
No server, Pages Functions, signing service, or GitHub Actions workflow is needed.

Production site: <https://construct-20x.pages.dev/>

In Construct Settings, use this exact catalog URL:

```text
https://construct-20x.pages.dev/index.json
```

## Cloudflare Pages

- Production branch: `main`
- Framework: None
- Repository root: leave blank
- Build command: `exit 0`
- Build output directory: `catalog`
- Environment variables: none

The production catalog URL is `https://construct-20x.pages.dev/index.json`, not
`/catalog/index.json`. Use the final URL: Construct rejects redirects, non-HTTPS
origins, credentials, query strings, and fragments in its catalog URL. Do not put
an authentication challenge in front of these public static files.

The index revalidates on every request; versioned ZIPs are immutable and can be
cached long-term. A real `404.html` prevents Pages' default SPA fallback from
returning the landing page for nonexistent ZIPs. Cache rules on a custom domain
must not override the index policy.

## Trust and release process

The first public catalog is an exact copy of the already-published catalog: eight
modules and 25 historical/current versions. No package was rebuilt or re-signed.
Keep existing version URLs and ZIP bytes unchanged. Add a new version rather than
replacing an old one. Publish only tested release artifacts, not test catalogs.

`publisher-public.der` is a **public** RSA key, matching the key pinned in the
official pilot APK. Its SHA-256 is
`6d82e01afd38130c7634aec030f0c2b7da10bbac1104002727529dee19374a0f`.
The app does not download or trust this file dynamically: its embedded key remains
the trust anchor. A self-built APK with a different publisher key cannot install
these packages unless explicitly configured with the appropriate public key.
The index's hashes and package signatures are preserved; the index itself is not
a separately signed catalog or a freshness guarantee.

Sign locally using the existing private publisher key. Keep private keys,
keystores, operator profiles, private certificates/keys, raw test receipts, and
personal data out of this directory and Git. Commit the index and its new ZIPs
together, verify, then deploy the complete snapshot through Pages.

Local verification (Python with `cryptography` installed):

```sh
python3 scripts/verify_public_catalog.py
python3 scripts/verify_public_catalog.py --url https://construct-20x.pages.dev/index.json
```

The HTTPS check uses normal public CA validation, rejects redirects, checks every
package's hash/signature/manifest identity, and compares deployed bytes with this
checkout. It intentionally does not reuse the local nginx-specific path/method
checks in `check_registry.py`.

The verifier identifies itself as `Construct-Catalog-Verifier/1.0`. The initial
Pages deployment returned Cloudflare error 1010 for Python's generic urllib
user agent, while this named verifier and an Android-style Dalvik user agent
received HTTP 200. No server security setting was changed. A successful HTTP
probe is not a substitute for testing the actual app on the phone.

## APKs

Use tagged GitHub Releases with immutable APK filenames, release notes, and
`SHA256SUMS`. Never commit APK binaries into Git history. Upload the exact tested
APK; no rebuild or signing-key change is needed to migrate its hosting.

The initial public prerelease is `v0.1.0-alpha21`, pointing to frozen app source
`4f19bf7`. This is the same ARM64 pilot APK already distributed for device testing,
not a new stable build or a claim that the separate UX review PR is merged.
Retain the existing pilot app signer for update continuity. The public source is
available at the release tag; third-party notices remain in the source and APK.

## Cutover

1. Verify public HTTPS index, all signed ZIPs, and the downloaded APK checksum.
2. In the existing app, change the catalog URL in Settings and refresh Browse.
   The existing APK's configured shortcut may still point to the old deployment;
   use the explicit new URL. No reinstall or data reset is required.
3. Test a module install/update from a phone off the home network and confirm
   existing data and offline use. Device acceptance is separate from HTTP checks.
4. Update the configured catalog for future official APK builds.
5. Only then retire old production routes. Testing catalogs and other nginx
   consumers are separate; this migration does not authorize removing them.

APK downloads through a browser may follow GitHub's download redirects. This is
separate from Construct's stricter module downloader; module ZIPs stay on Pages.
