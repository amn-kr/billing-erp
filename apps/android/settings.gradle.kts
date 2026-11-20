// The Android app (Phase 8, owner 18 Nov 2026): Kotlin + Jetpack Compose. See docs/PHASE8-PLAN.md.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "billingo-android"
include(":app")
