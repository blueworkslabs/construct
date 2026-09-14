plugins { id("com.android.application") }
android {
    namespace = "dev.construct.nanolab"
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.construct.nanolab"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-alpha1"
    }
    buildFeatures { buildConfig = true }
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
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies {
    implementation("com.google.mlkit:genai-prompt:1.0.0-beta4")
    testImplementation("junit:junit:4.13.2")
}
