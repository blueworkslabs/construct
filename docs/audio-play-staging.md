# audio.play (API 0.15) staging report, emulator and phone

Status: **emulator acceptance and the phone listening check, both complete**, 2026-10-18.
The emulator runs with `-no-audio`, so its rows are API evidence; audibility comes from the
phone check at the end.

- Build: debug APK from the fix branch at `9e92545` (the review repairs,
  then the policy watch while open and native mute required), with the probe fixtures in the
  bundled demo catalog. Every row below was run on this build; rows 1 to 12 gave the same
  results on `addcc39` and `39b8a48`.
- APK x86_64 sha256 `a91e6d84e3483984684ecdff5ecb7b4068b46f9575455fd27de2c8a269ca0803`.
- Device: API 37 emulator (`sdk_gphone16k_x86_64`), WebView 145.0.7632.218, booted from a clean
  snapshot.
- Fixtures: `dev.construct.audio-probe` 0.1.1 declares `audio.play`. At load it constructs an
  `AudioContext`, starts a quiet 440 Hz tone and asks `{op:'open'}` with no tap.
  `dev.construct.audio-undeclared-probe` 0.1.0 does not declare it.
- Evidence per step: the probe's text read from the accessibility tree, `dumpsys audio` players
  (the app's uid only), and the audio focus stack. Raw receipts are kept private, outside the
  repository.

| # | Condition | Page result | Player (app uid) | Focus |
|---|---|---|---|---|
| 1 | Undeclared module at load | `new AudioContext()` → `NotAllowedError` | none | none |
| 2 | Declared, not granted, open at load and on tap | `CAPABILITY_DENIED` | none (tone running in the page) | none |
| 3 | Granted, open at load, no tap | `{open:true, waitingForGesture:true}` | **none** | held, `GAIN_TRANSIENT_MAY_DUCK` |
| 4 | Then a tap (`state`) | `{open:true, waitingForGesture:false}` | AAudio `USAGE_MEDIA` **started** | held |
| 5 | `close` | `{open:false}`, event `suspended:module` | none | released |
| 6 | Ringer silent, then open | `AUDIO_MUTED` | none | none |
| 7 | Ringer vibrate, then open | `AUDIO_MUTED` | none | none |
| 8 | Do Not Disturb on, then open | `AUDIO_MUTED` | none | none |
| 9 | Media volume 0, then open | `AUDIO_MUTED` | none | none |
| 10 | Open after a tap, normal conditions | `{open:true, waitingForGesture:false}` | started | held |
| 11 | Incoming call (`emu gsm call`) | event `suspended:focus` | **stopped** | telecom `GAIN_TRANSIENT` on top |
| 12 | Call cancelled, then `state` | `{open:false}`: no automatic resume | none | none |
| 13 | Playing (as 10), then ringer silent | event `suspended:policy` | **stopped** | released |
| 14 | Playing, then ringer vibrate | event `suspended:policy` | stopped | released |
| 15 | Playing, then Do Not Disturb on | event `suspended:policy` | stopped | released |
| 16 | Playing, then media volume to 0 | event `suspended:policy` | stopped | released |
| 17 | After each of 13 to 16, back to normal, then `state` | `{open:false}`: no automatic resume, no further event | none | none |

Earlier runs on the same build also covered the menu pause: the player stopped, focus was
released, the event `suspended:pause` arrived, and a re-open after a tap played again.

Not covered here: another media app taking focus (a call stands
in), split screen and the notification shade, and an old WebView without `MUTE_AUDIO` (covered
only by JVM tests: such a WebView opens no module at all, `WEBVIEW_UNSUPPORTED`).

## Phone listening check (physical device): complete

Accepted by Codex, 2026-10-18 (technical approval for `9e92545`; see `docs/reviews/audio-0.15-codex.md`).

- 2026-10-18 08:31–08:37 UTC, the player's Pixel 8a, Android 17 (SDK 37), WebView
  154.0.8037.107. The diagnostics' environment record carries APK sha256
  `ace1d6c14e2b6fc03a76124b488e071ffb0b8c8361db6a0db6fb094627b752a1` (arm64-v8a, built at
  `9e92545`, the build Codex reviewed).
- Script: undeclared probe (`NotAllowedError`, silent); declared probe with access off, then
  on and reopened; silent before any touch; a tap makes the tone audible; the phone switched to
  silent while playing; back to sound stays quiet until `Open audio and play` again; close.
- The player's verdict, in their words: "Imo it works as expected".
- Host log (diagnostics): the undeclared probe has no audio events. After the grant there are
  **8 opens, 6 audible transitions and 8 suspensions**. The four opens from a tap
  (08:34:06, 08:34:17, 08:34:37, 08:36:29) became audible at once. Of the four module reloads
  that opened at load, two became audible only at the first tap, 1.3 s and 1.4 s later
  (08:35:32, 08:36:10). The last two (08:37:01, 08:37:10) were suspended about 1.2 s later,
  before any `AUDIO_AUDIBLE`. No `AUDIO_AUDIBLE` follows a suspension without a new
  `AUDIO_OPENED`.
- Limits: the host log records event codes, not the suspension reason or a refused open's
  error code, so which suspension was `policy`, `module` or `background` comes from the
  script, not the log. The first reload after the grant (08:33:54) logged no `AUDIO_OPENED`
  at load; the open there was refused or not reached, and the log cannot say which. The next
  tap opened normally.
