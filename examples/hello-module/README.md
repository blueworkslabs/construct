# Hello Module

Runnable API 0.1 example: a persistent counter, a native toast and startup logging.
The HTML entry is `ui/index.html`; `ui/app.js` uses the current message-port bridge.

`scripts/build_demo.py` (also called by `prepare_fixtures.py`) builds two working
versions, 0.1.0 and 0.2.0, plus a deliberately broken 0.2.1 startup fixture. The
second working version reveals Reset; rollback retains the per-module counter.
The broken version tests host error reporting and recovery, not normal use.

These signed packages and their matching public key are generated into ignored
assets for the bundled demo catalog. See [building](../../docs/building.md) and
[the implemented API](../../docs/module-api.md) before adapting the example.
