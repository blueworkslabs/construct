# Evidence ledger and known limits

Reference: alpha11 native source `19c984c`, review checkpoint `93be7fd`, September
2026 private pilot. These counts describe that tested baseline, **not** a fresh
third-party build of this public-preparation branch.

| Layer | Recorded result | What it does not establish |
| --- | --- | --- |
| Android JVM/Robolectric | 86 tests passed | Physical-device or comprehensive sandbox behavior |
| Android lint | 0 errors, 17 warnings | Absence of defects |
| Module JS | Snake19, Focus12, Contacts8 passed | Complete integration inside Android WebView |
| Publisher / runner tests | 11 / 27 passed | A live signed install by themselves |
| Host Android scopes | Checklist5, tone7, consent5; renderer recovery | All Android versions or power-loss durability |
| Bounded probes | 5 BLOCKED, 6 CONTAINED, 0 FAIL | Comprehensive network-egress or hostile-module isolation |
| Module Android scopes | Focus6, Snake8, Contacts9 | Phone touch feel or native tone audibility |
| Camera Android scope | 9 with explicit fresh launches | Direct-Reopen accessibility, physical optics or every camera device |

The final APK was identified by SHA-256, checked for signer continuity, and matched
against in-app diagnostics and served downloads. The accepted set combines complete
child scopes and clean continuations on identical APK bytes; it was **not one
uninterrupted all-green parent run**. The failed long-list navigation parent remains
in the private evidence archive.

## Screenshots

The [README landscape image](media/snake-landscape.png) and
[native menu image](media/native-menu.png) are actual Android emulator captures from
the accepted final APK, not browser mockups. Snake data is synthetic. The images
show layout, not proof of every lifecycle or security assertion.

## Remaining boundaries

- Intermittent camera-launcher accessibility descendants can disappear after native
  dialogs/direct Reopen. A fresh host launch restores them. This is not fixed.
- Contacts are read-only and bounded, but a grant includes intentional browsing;
  query restrictions are not a guarantee against address-book enumeration.
- The native tone capability is bounded; its grant is not universal control of
  every sound mechanism a WebView might expose.
- Focus promises no background alarm or late completion tone.
- Camera stores a limited private album. No system-gallery export, image stream to
  JavaScript, face analysis, microphone or arbitrary file API is implemented.
- Modules sharing a data schema must handle updates/rollback sensibly; code rollback
  does not automatically undo changes already made to stored data.
- The pilot uses development signing and a private registry. Production trust/key
  rotation, authenticated registry distribution and broad device coverage are future work.
- The alpha11 focused Pixel UI check remains pending in the recorded context.

Public-facing evidence should be a reviewed summary and synthetic screenshots,
not raw diagnostics, private endpoints, actual contacts, photos or chat transcripts.

## Public source verification

The clean MIT import has its own [verification ledger](public-release.md). Do not
transfer the historical pilot verdicts to a newly built APK without rerunning the
relevant scopes. Hosted CI and the external emulator runner cover different layers.
