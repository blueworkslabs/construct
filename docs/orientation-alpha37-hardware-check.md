# API 0.14 orientation — alpha37 phone checks

**Ready for physical-phone checks.** The exact x86-64 candidate passed 11/11 Android gates;
[report and scope limits](orientation-alpha37-staging.md). Hardware results remain pending.

This is a host capability check, not Space Watch follow-mode acceptance. The chain
remains #42 → #51 → #52; neither host PR is merged by this review.

## Exact candidate

A new APK is required. Use the ARM64 alpha37 candidate from the draft linked on
[#51](https://github.com/blueworkslabs/construct/pull/51), not the held alpha35/36 files.

- Host source: `4e7f53478fab0f21c75b315691f3ea749cb845e6`.
- ARM64 SHA-256: `9e47fa6467095993372476b30615b95a03f7e20b48b759d531d74dc1f8ff7862`.
- Signed **Orientation probe 0.1.3**, diagnostic only:
  [candidate catalog](https://raw.githubusercontent.com/blueworkslabs/construct/01c8065a1fd773509b8844fb966d20aed5de417b/catalog/candidates/orientation-probe/index.json).
- Probe SHA-256: `7ddfcef340238db112eae99f255fec5e1beb02061f29308d5a9e7c6ed85b51ea`.

Keep existing app data; update the APK in place. In the catalog settings, use the
probe catalog and install Orientation probe. Its compass/tilt grant starts off.
It has no network or storage capability. Restore the normal catalog afterwards.

## Phone checklist

1. Read once and Watch are denied before enabling **Allow reading compass and tilt**
   in native Module access. No Android permission dialog is expected.
2. With the phone flat, rotate slowly: heading follows its top edge. Upright,
   heading follows the back-camera axis. Check pitch/roll directions and wrapping
   around 359°→0°. The heading is **magnetic**, not true north.
3. Inspect `accuracyDeg`/`calibrate`; unreliable heading may be absent. Check away
   from nearby magnets/metal and note the phone model. Emulator accuracy is not
   evidence for physical calibration.
4. Watch at 10/15 Hz, then Stop: Events must stop increasing. Open/close the native
   menu: it must remain stopped until an explicit new Watch.
5. While watching, open Quick Settings, go Home, and (if supported) focus another
   app in multi-window. On return, expect one terminal pause notification and no
   silent restart. Tap Watch again to resume. Delayed paused requests may be
   checked with the probe's dedicated 3-second button.
6. Revoke the grant: no readings; Read/Watch remain denied after reopening. Grant
   it again and verify only an explicit Watch starts the stream.
7. Restart Construct, rotate portrait/landscape and try enlarged text. The reading
   and controls should remain usable; a previous watch must not resume itself.

Report any mismatch and the phone/Android version. A normal screenshot may be
blocked by the privacy curtain; no screenshot is required. Native listener teardown
has emulator evidence; phone event counts alone do not measure native connections.

Do not install the emulator-only lifecycle helper on the phone. Space Watch 0.2.14
remains the production module; follow mode #52 has its own later acceptance.
