plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    // The code's own name. The App ID people and Android see is applicationId below
    // ("in" can't start a Kotlin package name without quotes, so the code uses billingo.app).
    namespace = "billingo.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "in.billingo.app" // permanent (owner, 18 Nov 2026)
        minSdk = 24 // Android 7.0
        targetSdk = 35
        // one place for the version (a release passes -PappVersion=1.0.1); Android's update number
        // follows it (1.0.1 → 10001), so a newer version always installs over an older one
        val v = (project.findProperty("appVersion") as String?) ?: "1.0.0"
        val (major, minor, patch) = v.split(".").map { it.toInt() }
        versionName = v
        versionCode = major * 10000 + minor * 100 + patch
        // the live server; a test build can point elsewhere with -PapiUrl=...
        val apiUrl = (project.findProperty("apiUrl") as String?) ?: "https://billing-erp-ynqf.onrender.com"
        buildConfigField("String", "API_URL", "\"$apiUrl\"")
        // English and Hindi only
        resourceConfigurations += listOf("en", "hi")
    }

    // The signing key (step 8.2e, owner 18 Nov 2026). It never sits in the code: the build reads it
    // from the computer it runs on (BILLINGO_KEYSTORE = path to the .jks, BILLINGO_KEY_PASSWORD).
    // On GitHub these come from the repository's secrets. Without them a release build is unsigned.
    val keystore = System.getenv("BILLINGO_KEYSTORE")?.takeIf { it.isNotBlank() && file(it).exists() }
    signingConfigs {
        if (keystore != null) create("release") {
            storeFile = file(keystore)
            storePassword = System.getenv("BILLINGO_KEY_PASSWORD")
            keyAlias = "billingo"
            keyPassword = System.getenv("BILLINGO_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            if (keystore != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.foundation)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.ui.tooling.preview)
    debugImplementation(libs.androidx.ui.tooling)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
}
