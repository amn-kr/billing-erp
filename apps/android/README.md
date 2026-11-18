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

The test APK is `app/build/outputs/apk/debug/app-debug.apk`.

## Signed APK and releases (step 8.2e)

The app is signed with one key, kept by the owner (`~/BillinGo-signing-key`, plus a copy on a pen drive and the password on paper) and in the repository secrets `ANDROID_KEYSTORE_B64` and `ANDROID_KEY_PASSWORD`. It never goes into the code.

- **Every change:** GitHub's "Phone app" job runs the tests and makes `BillinGo-1.0.0.apk`, signed with the key, under the run's Artifacts (14 days). It installs over the previous one.
- **A release:** push a tag `android-v1.0.1`. The job builds version 1.0.1 (Android update number 10001) and puts a **draft** release on [billing-erp-releases](https://github.com/amn-kr/billing-erp-releases/releases). Publishing the draft makes Check For Update offer it.
- **On a Mac:** `BILLINGO_KEYSTORE=~/BillinGo-signing-key/billingo-release.jks BILLINGO_KEY_PASSWORD="$(cat ~/BillinGo-signing-key/password.txt)" ./gradlew :app:assembleRelease -PappVersion=1.0.1`
