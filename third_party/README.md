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
