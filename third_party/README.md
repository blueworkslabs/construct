# Third-party materials

Construct-owned source is MIT-licensed. Dependencies retain their own licenses.
The vendored Gradle wrapper JAR contains its Apache-2.0 license; a copy is included
here, and the wrapper scripts retain upstream copyright notices.

AndroidX/Compose/CameraX and Kotlin/Gradle use Apache-2.0; JUnit 4 uses EPL-1.0;
Robolectric uses MIT; JSON-java 20240303 declares Public Domain in its upstream POM. These dependencies
are resolved by Gradle, not relicensed or copied into this source tree. Consult the
exact dependency POM/artifact notices when distributing binaries. The initial
public release distributes source, not a prebuilt release APK.

Python automation dependencies are declared in the runner requirements file and
remain separately licensed. OpenClaw and agent/model services are not bundled and
are not required to run the build or acceptance scripts. See project credits.

Pocket Measure builds a subset of OpenCV 4.12.0 from the official release source:
`https://github.com/opencv/opencv/archive/refs/tags/4.12.0.tar.gz`, SHA-256
`44c106d5bb47efec04e531fd93008b3fcd1d27138985c5baf4eafac0e1ec9e9d`.
Its Apache-2.0 license and provenance notice are bundled under
`core/app/src/main/assets/measure`. Source is checksum-verified at bootstrap and
kept outside Git; CMake flags and the small MIT-owned JNI bridge are tracked.
OpenCV's ArUco code is unchanged; unused modules and the Java wrapper are excluded,
and static-link garbage collection removes unreachable code. There is no new
Android permission, upstream Android manifest or runtime download. NDK 27.2.12479018
builds separate ARM64/x86-64 bridges with static C++ runtime and 16 KiB load alignment.

Historical alpha 15 used the full Maven AAR `org.opencv:opencv:4.12.0`, 117745028
bytes, SHA-256 `f71846a313388d9da667a59be1e921669fcf792d1ba264b3898253ca789bc3f0`.
Its multi-ABI JNI-byte checks remain historical evidence, not claims about the
new source-built native library.
