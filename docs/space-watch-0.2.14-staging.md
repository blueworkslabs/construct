# Space Watch 0.2.14 staging

Status: **source review passed; signing and exact-package Android acceptance pending.**
No hardware clearance, merge or production promotion. Production stays 0.1.6.

The shared grazing-aware next-rise search fixes the 00:42 SL-14 reproduction.
Review additionally refines the final lookup interval and clips coarse samples
to the requested rise window; its regression fails before and passes after.
Eighteen core test groups pass. The fixture lookup cost is 18,619 propagations
versus 99,483 for the plain 5-second reference. This is propagation-count evidence,
not a universal Android latency guarantee. The author's larger +8% benchmark
is attributed separately, not claimed as independently repeated.

Exact signed artifacts, Android receipt and original captures will be recorded
here once available. Earlier [0.2.12 evidence](space-watch-0.2.12-staging.md)
belongs to different module bytes and is not acceptance of this version.
