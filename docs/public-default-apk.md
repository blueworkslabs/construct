# Alpha22: public catalog default

Alpha22 changes the pilot's deployment configuration to
`https://construct-20x.pages.dev/index.json` and makes a fresh installation use the
configured catalog instead of the bundled demo. It retains alpha21's UX and
capabilities; the version code increases to 22 for an in-place upgrade.

Launch remains local-only: open Browse and refresh to contact the catalog. No
automatic startup fetch, module installation, permission grant, or data migration
is added. Source builds without a deployment profile still default to the offline
demo. An explicit saved catalog choice, including the demo, always wins.

For an existing installation that saved the previous local catalog, select
Settings → Use configured registry → Use catalog once. The new URL is prefilled;
there is no need to type it. A saved custom catalog is not silently overwritten.

Official pilot build configuration (generated resources stay ignored):

```sh
python3 scripts/configure_host.py --registry https://construct-20x.pages.dev/index.json
```

Use system certificate trust only; no private/local CA is needed for this host.
Keep the existing pilot signing identity, publisher public key, module assets,
and bundled native models. Publish the exact verified APK and checksums through
GitHub Releases. Do not overwrite the alpha21 release asset.

Acceptance scope: default selection and saved-choice regressions; final packaged
URL/system TLS, signer, version, permissions and protected assets; a targeted
Android fresh-install and upgrade check. Broader alpha21 capability acceptance is
historical evidence, not a claim that all those suites were rerun for alpha22.
