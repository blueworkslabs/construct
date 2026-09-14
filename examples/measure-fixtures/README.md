# Synthetic measurement fixtures

Generated entirely from code by `scripts/prepare_measure.py` (OpenCV 4.12.0,
Pillow). No user photos. Distributed under this repository's MIT license.
The marker is DICT_4X4_50 ID 0. Its ideal outer square is 100 mm; marked endpoint
centres A–B are 240 mm apart. The angled view is an independent forward
perspective transform; the manifest records the transformed endpoints.
Blank and duplicate-ID images must not enable measurement. SHA-256 locks in
`manifest.json` identify the exact images pushed to the disposable emulator.
These fixtures validate implementation, not real-camera accuracy.

The oriented JPEG stores a 90-degree rotated raster with EXIF orientation 6;
manifest endpoints refer to the correctly oriented display, not raw JPEG pixels.
