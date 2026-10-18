## Codex ruling — native-mute deviation accepted; implementation not yet cleared

Reviewed exact head `39b8a481cf9874271ae6d9a5356967cf9fbfc11f`, `docs/audio-brief.md`, the API contract, and the private advisory.

**Accept the design deviation.** Declared modules may retain Web Audio for decoding/mixing/scheduling while native WebView mute is the output-authority boundary. Declaration is not authorization: keep the sink muted until grant, foreground, current sound policy, focus and trusted input all permit output. Constructor replacement for undeclared modules is additional protection, not a reason to weaken the native boundary. The five-second preceding-input window is an explicit bounded design choice; synthetic DOM events must not count. The rationale should say page-visible switches are untrusted, rather than claiming every JavaScript closure is necessarily readable.

### Changes required before implementation approval

1. **P1 — Recheck policy at the deferred unmute.** `ModuleAudio.kt:50–59` calls `unmute()` on a later gesture without rechecking authorization or `soundAllowed()`. `openAudio()` checked those earlier, potentially arbitrarily long ago (the existing test explicitly waits 60 seconds). Trace: open while allowed, remain waiting, change the fake platform's `allowed` to false, then call `userGesture()`; the code still calls `setMuted(false)`. Silent/vibrate is not itself a guarantee that Android's media stream will be muted. Revalidate on the actual silent-to-audible transition, fail closed without throwing an uncaught exception from input dispatch, and release focus on rejection. Add regressions for policy/authority changing during the wait. Also cover mode changes during active playback if the disclosure continues to promise that sound follows silent/DND, not merely that opening checks them.

2. **P1 — Unsupported WebViews must not retain the advisory's unrestricted path.** In `ModuleAudio.kt:43–46,150–155`, when both `MUTE_AUDIO` and `DOCUMENT_START_SCRIPT` are unavailable, both enforcement calls are no-ops; logging `AUDIO_UNCONTROLLED` still permits module scripts to run. The entry check in `ModuleWebView.kt` requires only `WEB_MESSAGE_LISTENER`, not these audio features. Reject module execution before page code runs when no proven audio-enforcement layer exists, with an actionable WebView-update error. Test the feature combinations independently; the current single `supported=false` fake cannot demonstrate the real no-op fallback. Constructor-only fallback needs its own adversarial/old-WebView evidence if retained; I am not approving it from this test alone.

3. **P2 — Exact-head fixture preparation is broken.** `scripts/prepare_fixtures.py:98–99` contains unquoted `audio-probe`, `audio-undeclared-probe`, `audio-registry`, `examples` and `fixtures`. I executed the exact function in isolation with inert build/publish stubs: `NameError: name 'audio' is not defined`. Quote the names/path segments and run fixture preparation from the final committed tree. This is not covered by the reported publisher tests and is not a no-op cleanup.

### Remaining release gates

The design ruling permits work to continue; it is **not** merge/publication approval. Still required: repaired-head JVM/lint/scripts and fixture preparation; open-at-load then tap; initial and changing silent/vibrate/DND/media-mute states; another app taking focus; exact-artifact staging report; physical-phone audibility. Existing emulator evidence is player/focus-state evidence, not listening evidence. Keep the advisory, fix and note private until coordinated publication.

Review verification here: source/contract inspection and the isolated Python failure reproduction. I did not rerun Android/JVM builds or claim new device evidence.

## Follow-up — `c888440`, 2026-10-18 07:39 UTC

Verified private draft PR #1 is OPEN at `c888440d76c900f205a5d59f1258e5a4071ad721` and read `docs/audio-play-staging.md`.

**Design deviation remains approved. Implementation remains changes-requested.**

The only commit since the reviewed head changes the staging report and three audio-probe fixture files. Git blob equality confirms `ModuleAudio.kt`, `ModuleWebView.kt`, `ModuleAudioTest.kt` and `scripts/prepare_fixtures.py` are all unchanged from `39b8a481`. Therefore all three findings above remain open:

- `ModuleAudio.kt:50–59`: deferred gesture still calls `unmute()` without current authorization/sound-policy checks.
- `ModuleAudio.kt:43–46,150–155` and `ModuleWebView.kt:42–44`: missing enforcement features still leave the no-op/log-only execution path.
- `scripts/prepare_fixtures.py:98–99`: independently reproduced `NameError: name 'audio' is not defined` again from the exact committed function with inert build/publish stubs.

The report records 12 emulator cases with APK hash `784cfda5746ed4f50c0dfdd22a1ad0954e0c2abb73598e6fb5155b4ca7e454fe`, explicitly distinguishing player state from audibility. Those receipts cover initial quiet modes and normal gesture/focus transitions, not policy/grant changes while waiting or active playback, nor real unsupported-WebView enforcement. They do not close the implementation findings. I read the report; I did not independently rerun the emulator or verify the APK bytes/raw receipts.

There is no committed `docs/reviews/` review file at this head. Copy this complete review into the private fork as requested. Repair the findings and add meaningful regressions, run fixture preparation/checks from the repaired committed tree, then refresh exact-artifact staging evidence before the phone listening gate. Split screen, notification shade and physical audibility remain explicitly untested in the report. Keep the advisory/fix/note private pending coordinated release; no merge or publication approval is given here.

## Scope clarification — 2026-10-18 07:42 UTC

Clawd reports repairs and passing checks at `addcc39`; I have not reviewed that revision and do not clear it here. In response to the explicit scope question:

- Add active-playback sound-policy enforcement in this PR, not a follow-up. Silent/vibrate, DND and media mute/zero-volume transitions must mute, release focus and emit `suspended:policy`. Restoring normal settings must not auto-resume: require a fresh open and trusted gesture. Add transition regressions and matching emulator evidence.
- Constructor blocking alone is not established as a complete audio-output boundary. Reject module execution without native mute for this release unless the alternative has adversarial evidence covering all audio routes. A fake recording constructor-block calls is not that evidence.
- Finish these changes before treating a rerun as final acceptance evidence. Review must use the frozen committed head and matching APK hash; physical listening remains a separate gate.

## Re-review — `9e92545` / `883c958`, 2026-10-18

**Implementation repairs accepted; proceed to the private physical-phone listening check. No remaining blocking finding in this reviewed delta. This is not merge, release or advisory-publication approval.**

Verified private draft PR #1 remains open at `883c95848df9104e706bafb1ef18e56bc4eaebaa`. Its only change from code head `9e92545069ea8250db639c3f9c463b30fde438b4` is `docs/audio-play-staging.md`. The prior review in the fork matches the original local file byte-for-byte (SHA-256 `195a896dc5710a46737ff3d00e2421364d3cfd33af1008e3fa342a284e1fb5b7`) before this addendum.

### Findings closed

- Deferred gesture unmute now rechecks both authorization and current sound policy; failure suspends with `policy`, keeps native mute on and releases focus. Regression coverage includes both changed policy and revoked authority.
- Native `MUTE_AUDIO` is required by `install()` before page loading. Every module is refused without it, regardless of declaration/document-start support. Constructor blocking is only defense in depth; the native-mute-only path remains gated for declared modules and permanently muted for undeclared ones.
- The audio fixture names/path segments are quoted correctly. Independently executed the committed `prepare_audio` with real package building/signing/publishing, a disposable in-memory RSA key and a fresh temporary output: both probe packages were produced successfully. This was the affected function, not a rerun of the whole fixture bootstrap.
- Active-policy enforcement now watches ringer, DND and stream mute/volume broadcasts with a 500 ms polling fallback while audio is open, including while waiting for the first tap. Disallowed policy mutes, releases focus, unregisters/cancels the watch and emits `suspended:policy`. Restoration does not reopen; suspension clears the remembered gesture. Source and tests cover termination and late callbacks. The polling fallback is not a zero-latency guarantee.

### Independent verification

- Re-executed `testDebugUnitTest` (task forced with `--rerun`) on the tracked-clean report head under the staging lab lock: **275 tests, 0 failures, 0 errors, 0 skipped**, including **ModuleAudioTest 13/13**. Fresh XML timestamps are 08:25:34–08:25:50 UTC.
- Re-executed main debug lint analysis/report and `lintDebug`: success, **0 errors, 23 warnings**, no ModuleAudio diagnostic. Correct the handoff wording: lint passes, but it is not warning-free. The earlier retained report also contained 23 warnings.
- Python script suite: **37/37 pass**. `git diff --check` passes.
- Independently hashed both the retained matrix APK and the original build output: x86_64 SHA-256 **`a91e6d84e3483984684ecdff5ecb7b4068b46f9575455fd27de2c8a269ca0803`**. The retained build receipt identifies `9e92545`; its only untracked entry is the existing `dist` link. Installation receipt says success, WebView 145.0.7632.218.
- Read the raw emulator receipts (kept private), not just the Markdown report. Checked initial native player/focus gating and call takeover; independently asserted each silent/vibrate/DND/media-zero transition has an app AAudio player started before the change, no started app player afterward or after restoration, focus released, exactly one new `suspended:policy`, and final `{open:false,waitingForGesture:false}`. All four transition receipt checks pass. For these four changes the retained player entries disappear; the call receipt explicitly records the app player as stopped.
- ARM64 companion from the same build (`app-arm64-v8a-debug.apk`): SHA-256 **`ace1d6c14e2b6fc03a76124b488e071ffb0b8c8361db6a0db6fb094627b752a1`**. All **24 DEX/assets entries** match the matrix x86_64 APK. This is cross-artifact byte comparison, not ARM64 execution or listening evidence.

### Limits and next step

No new emulator run or physical listening was performed by this reviewer. The matrix used `-no-audio`: player/focus evidence cannot prove audibility. The platform-feature matrix is fake-platform JVM coverage, not an old-WebView device test. Split screen, notification shade and another media app taking focus remain untested (the call is the focus-loss case).

Receipt hygiene: three initial load-text files in the latest raw run are empty; subsequent page dumps retain the relevant constructor/load-result text and the native player/focus captures exist. The latest matrix runner also contains no dedicated menu-pause acceptance row, so I do not independently certify the report's earlier-menu-pause claim against these bytes. Keep these distinctions when summarizing evidence.

Proceed with the private ARM64 listening candidate from the reviewed source and record the exact installed hash and phone observations, including initial silence, first trusted tap, policy suspension and no automatic resume. Keep remaining untested scopes explicit. No source changes, merge or publication were made during this review. Fresh verification logs are kept with the private receipts.

## Physical listening acceptance and technical approval — `4485438`, 2026-10-18

**The physical listening gate is accepted for the exercised script on the reviewed ARM64 artifact. Technical approval is granted for code `9e92545` in the coordinated advisory/fix/brief landing. No diagnostic code change or additional phone sitting is required before landing. Correct the documentation inaccuracies below before coordinated merge/publication.** This is a review decision; I did not merge, release or publish the advisory.

Independently retrieved the player's actual diagnostics export, SHA-256 `b45fd434e039df529c31789620c3291788410c446e64d4b2959949286cbfe890`. Its environment record identifies APK `ace1d6c14e2b6fc03a76124b488e071ffb0b8c8361db6a0db6fb094627b752a1`, Pixel 8a, Android 17/API 37, WebView 154.0.8037.107. Probe package digests match the staging fixtures. The player's accompanying statement is exactly: "Imo it works as expected". Physical audibility and observed silent-mode behavior rest on that human verdict in response to the supplied script, not on the `AUDIO_AUDIBLE` event name.

The raw host events contain **8 AUDIO_OPENED, 6 AUDIO_AUDIBLE, 8 AUDIO_SUSPENDED** for the declared probe, and no audio events for the undeclared probe. Every audible transition follows an open; none follows suspension without a new open. Two load opens at 08:35:32 and 08:36:10 become audible after 1.322408 s and 1.428818 s respectively. The final two load opens at 08:37:01 and 08:37:10 suspend without any audible transition. Four other opens become audible after 20–25 ms, consistent with the allowed recent-gesture path; the log itself does not record the gesture. The first post-grant module reload has no load-time AUDIO_OPENED; its cause remains unknown, not evidence of unauthorized output. Suspension reasons and refused-open errors are absent, so do not infer which individual suspension was policy/background/module from these codes alone.

Verified remote PR head `4485438f9fca978e93637fb534119e07ac90fbf3`; subsequent changes since the code head are review/report documentation only. The advisory is still draft/unpublished. PR #1 explicitly says **"Do not merge or publish separately: the advisory, this fix and docs/audio-brief.md publish together."** Technical approval does not override that coordinated landing boundary.

### Documentation corrections before coordinated landing

1. Replace the report's "Each reopen ... AUDIO_AUDIBLE ... 1.1–1.4 s later" claim with the exact counts/timing distinction above. Two final reopens never became audible. Keep the human verdict separate from what the diagnostics prove.
2. Update the staging report's opening status: phone listening is now complete for the stated script, not "comes next". Keep the emulator-only audibility limitation scoped to the emulator section and retain all other untested scopes.
3. Refresh PR #1's stale body: native mute is mandatory (`WEBVIEW_UNSUPPORTED` without it), active policy enforcement exists, current JVM count is 275/275, lint is 0 errors/23 warnings, current x86_64/ARM64 hashes and reports supersede the old probe, and physical listening is no longer pending. Do not describe the discarded constructor-only fallback or `AUDIO_UNCONTROLLED` path as current behavior.

These are documentation corrections only; they do not require rebuilding the reviewed artifacts. Logging bounded suspension reasons and refused-open error codes is a useful **non-blocking follow-up**, not a reason to change the accepted code/phone artifact now. Retain the explicit limits on split screen, notification shade, another media app taking focus and old-WebView device execution. No extra physical run is requested for this acceptance decision.
