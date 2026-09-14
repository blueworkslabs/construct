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

Pocket Measure resolves OpenCV Android 4.12.0 (`org.opencv:opencv:4.12.0`) from
Maven Central. Its Apache-2.0 license and provenance notice are bundled under
`core/app/src/main/assets/measure`. The unmodified AAR is 117745028 bytes,
SHA-256 `f71846a313388d9da667a59be1e921669fcf792d1ba264b3898253ca789bc3f0`.
Its manifest adds no permissions. The 64-bit `libopencv_java4.so` and
`libc++_shared.so` LOAD segments are 16 KiB aligned; 32-bit ABIs use 4 KiB
alignment. The full upstream multi-ABI runtime is bundled, increasing APK size.
