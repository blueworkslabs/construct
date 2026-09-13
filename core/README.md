# Android host

The implemented Kotlin/Compose application is under [`app`](app). It owns package
verification/install/rollback, per-module storage and grants, the WebView boundary,
native contacts/camera APIs and the module-first shell.

Start with [architecture](../docs/architecture.md), [module API](../docs/module-api.md)
and [build/reproduction status](../docs/reproduce.md). JVM/Robolectric tests are in
`app/src/test`; emulator acceptance lives in `scripts/android-runner`, not this folder.
