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
        versionCode = 11
        versionName = "0.1.0-alpha11-public1"
    }
    buildFeatures { compose = true; buildConfig = true }
    buildTypes {
        create("pilot") {
            initWith(getByName("debug"))
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
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
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
