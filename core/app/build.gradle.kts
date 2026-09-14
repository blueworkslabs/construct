plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "dev.construct.runtime"
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.construct.runtime"
        minSdk = 28
        targetSdk = 35
        versionCode = 14
        versionName = "0.1.0-alpha14"
    }
    buildFeatures { compose = true; buildConfig = true }
    androidResources { noCompress += "tflite" }
    buildTypes {
        create("pilot") {
            initWith(getByName("debug"))
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "vision-proguard.pro")
            matchingFallbacks += "release"
        }
    }
    // Optional ignored deployment resources override safe defaults for each variant.
    listOf("debug", "pilot", "release").forEach { variant ->
        sourceSets.getByName(variant).res.srcDir("src/deployment/res")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all { it.systemProperty("construct.fixtureRoot", rootProject.file("dist/fixtures").absolutePath) }
    }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("androidx.camera:camera-view:1.4.2")
    implementation("com.google.mediapipe:tasks-vision:0.10.35") {
        exclude(group = "com.google.mediapipe", module = "tasks-core")
    }
    // Reproducibly patched by prepare_vision.py to use the upstream no-op logger.
    implementation(files("libs/mediapipe-core-local.aar"))
    implementation("com.google.flogger:flogger:0.6")
    implementation("com.google.flogger:flogger-system-backend:0.6")
    implementation("com.google.guava:guava:27.0.1-android")
    implementation("com.google.protobuf:protobuf-javalite:4.26.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
