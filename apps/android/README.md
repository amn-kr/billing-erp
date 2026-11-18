# BillinGo phone app (Android)

Kotlin + Jetpack Compose. Plan: [`docs/PHASE8-PLAN.md`](../../docs/PHASE8-PLAN.md); design: [`reference/design/mobile.html`](../../reference/design/mobile.html); rules: [`docs/MOBILE-PLAN.md`](../../docs/MOBILE-PLAN.md).

| | |
|---|---|
| App ID | `in.billingo.app` (permanent) |
| Android | 7.0 (API 24) and newer, portrait only |
| Colours | only the 20 in `app/src/main/java/billingo/app/ui/theme/Colours.kt`; `ColoursTest` fails on any other |
| Fonts | Inter (English) and Noto Sans Devanagari (Hindi), weights 400–700, in `app/src/main/res/font` (SIL Open Font License, copies in `fonts-licence/`) |
| Server | `BuildConfig.API_URL`, the live server by default; `-PapiUrl=http://10.0.2.2:3000` for the emulator against a local server |

## Build on a Mac

Needs Java 17 and the Android SDK (platform 35).

```bash
cd apps/android
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=~/Library/Android/sdk ./gradlew :app:testDebugUnitTest :app:assembleDebug
```

The test APK is `app/build/outputs/apk/debug/app-debug.apk`. GitHub builds the same on every change ("Phone app" workflow; the APK is under the run's Artifacts for 14 days).
