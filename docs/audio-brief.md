# Audio brief — `audio.play`

Status: **implemented** as API 0.15.0 (Construct 0.1.0-alpha38). Review, emulator staging and
the physical-phone listening check are complete; see the
[staging report](audio-play-staging.md) and the [review](reviews/audio-0.15-codex.md), including
their evidence limits (the emulator runs without audio output; audibility rests on a person's
observation of the phone; the host log records event codes, not suspension reasons). The note,
the fix and the advisory publish together.

## Why

- A module that wants real sound effects (a game, a metronome, a timer with a chime) has only
  `device.tone`: two fixed patterns, one per two seconds. That is right for a notification,
  not for a game's effects or short clips.
- Web Audio already works inside the module WebView today, but **outside the host's audio
  policy**. On API 37 with WebView 145, an `AudioContext` created by a module that declares
  no audio capability is `running` at page load, plays decoded PCM, and Android shows an
  active `USAGE_MEDIA` track from the host app with no audio-focus request. The tone player's
  rules (silent/vibrate/DND check, focus, rate limit) do not apply to it. Session pause (the
  native menu) does stop output. Details are in the private security advisory on this repo,
  not here.
- So this note does two things at once: it closes the undeclared path for every module, and it
  opens a declared, consented path for modules that need audio.

## Ownership

| Host (APK) | Module |
| --- | --- |
| Whether audio may play at all: declaration, grant, mute/DND rule, audio focus, pause and close | What to play: decoding, mixing, scheduling, volume within the module |

The module keeps Web Audio as its engine (it is the only engine that runs under the current
CSP, which has no `media-src`, and it is standard). The host does not proxy sample data or mix.

## Implemented contract

Capability `audio.play` is declared with a reason and may be `optional`. Consent text: "Play
sounds while this module is open." No Android runtime permission. Off until granted in Module
access, like `device.tone`.

1. **Every module page starts muted natively.** The host mutes the WebView's audio
   (`WebViewCompat.setAudioMuted`, feature `MUTE_AUDIO`, androidx.webkit 1.12) before the
   page loads. This is the second layer the decisions below asked for, and it exists.
2. **Undeclared: no Web Audio.** A document-start script
   (`WebViewCompat.addDocumentStartJavaScript`) replaces `AudioContext`, `webkitAudioContext`
   and `OfflineAudioContext` with non-configurable constructors that throw `NotAllowedError`
   before any module script runs. `<audio>`/`<video>` stay blocked by the CSP. This applies to
   every module from the API version that ships it: older modules lose an unintended path, not
   a contract. Without native mute, module execution is refused (`WEBVIEW_UNSUPPORTED`),
   declared or not.
3. **Declared and granted: a bridge-gated sink.** The module keeps the real constructor, so it
   can decode and schedule ahead; the native mute is the gate. It requests `{op:'open'}` on
   `audio.play`. The host checks grant, foreground, ringer mode, stream mute and the
   interruption filter (the tone player's `AUDIO_MUTED` rule) and requests audio focus
   (`USAGE_MEDIA`, `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`). It returns
   `{open:true, waitingForGesture}`; `{op:'state'}` reports the same, `{op:'close'}`
   suspends.
   *Deviation from the first draft:* the draft re-enabled a blocked constructor after open. A
   module page has one JavaScript world, so any in-page switch the host flips can be found and
   flipped by the module; native mute has no in-page switch.
4. **Focus loss, pause, close, revocation.** On focus loss, menu pause, background, close or a
   grant change, the host dispatches `constructaudio` with `{state:'suspended', reason}` and
   mutes the WebView again and gives up focus (the event lets the module stop its own
   scheduling). Background includes another window in front, the notification shade, Home and
   Recents (the same foreground eligibility as `orientation.read`). Revocation is reachable only
   through the menu, which suspends first. Resume requires a new `{op:'open'}`, which re-checks
   every rule, and a new gesture.
5. **No autoplay without a gesture.** After a successful open the WebView stays muted until the
   first trusted gesture inside the module: a native touch or key release the host dispatched
   to the WebView. Synthetic DOM events never reach the host. A tap up to 5 s before the open
   counts, so a click handler that opens audio plays at once; an open at load stays silent until
   the next tap.
6. **Re-checked at the gesture, fail closed.** The tap that unmutes can come long after the open,
   so the grant and the mute rule are checked again then; if they no longer hold, the open is
   suspended (`reason: policy`). The same rule is watched for as long as audio is open: when
   the ringer goes to silent or vibrate, Do Not Disturb comes on, or the media stream is muted
   or set to 0 (the system's broadcasts, and a check every 500 ms in case one is missed), the
   host mutes, gives up focus and suspends with `reason: policy`. Going back to normal does not
   resume; the page needs a new open and gesture. Native mute is required: a WebView without it
   opens no module at all (`WEBVIEW_UNSUPPORTED`), declared or not, since removing the
   constructors alone does not prove every audio route silent. Without document-start scripts an
   undeclared module keeps the constructors but stays natively muted all session (it can never
   open), recorded as `AUDIO_LIMITED`.
7. **Errors:** `AUDIO_MUTED`, `AUDIO_UNAVAILABLE` (focus refused),
   plus the common grant and session errors.

Non-goals: background audio, streaming from the network, microphone, system volume changes,
media-session controls.

## Acceptance (staging)

- Undeclared module: `new AudioContext()` throws at load; no AudioFlinger track from the host
  appears (dumpsys before/after).
- Declared, not granted: `{op:'open'}` returns the grant error; the WebView stays muted.
- Granted: open after a tap succeeds, a clip plays, `dumpsys audio` shows the focus holder and a
  `started` player; output before any tap stays silent and starts on the first tap.
- Silent, vibrate, DND on, media muted: `AUDIO_MUTED`, no track.
- Menu pause during a long clip stops output within one frame budget; `constructaudio` arrives;
  resume needs a new open.
- Another app takes focus: output stops, event arrives.
- Physical phone: audible check by a person, with the same matrix.

## Decisions (formerly open questions)

- `device.tone` stays separate: it is the zero-consent beep, a different promise (two fixed
  patterns, two seconds apart), and existing modules rely on it.
- Focus is requested with `USAGE_MEDIA`, the same attribute as the tone player, so one
  attribute means one policy. A `USAGE_GAME` option is added only if a real device is
  measured to duck media badly.
- Native mute (`MUTE_AUDIO`) is mandatory: a WebView without it opens no module. The
  document-start constructor replacement is defence in depth for undeclared modules, not a
  release fallback; removing the constructors alone is not evidence that every audio route is
  silent.
