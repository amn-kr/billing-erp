# Phase 8: the Android app in Kotlin, step by step

_First plan approved by the owner on 18 Nov 2026 (React + Capacitor). The same day, after comparing Capacitor, React Native, Flutter and Kotlin, the owner chose **Kotlin**, and answered the start questions (section 2). This version is rewritten for Kotlin. **Phase 8 starts now** (owner, 18 Nov 2026); the rest of the Windows trial (sections D, F, F2, G and the shop trial I) comes after the phone app is launched._

This plan turns the approved design, `reference/design/mobile.html`, into a real Android app. It follows `docs/MOBILE-PLAN.md`: the owner's decisions, the 20 colours, the wording rules and the fit checks.

---

## 1. What Phase 8 makes

- **An Android app** (an APK file), written in **Kotlin with Jetpack Compose**, Google's own way to build Android screens. It is online only, English and Hindi, Android 7.0 and newer, portrait only.
- It **looks like the approved phone design**. Because Kotlin can't run the design's HTML and CSS, every screen is rebuilt in Compose from the design and compared with it picture by picture (section 6).
- It talks to **the same server** as the web app, so a bill made on the phone appears on the web and the Windows app at once.
- **Phone-only features:** camera barcode scan, picking a party from phone contacts, fingerprint unlock, invoice PDF shared to WhatsApp, and Check For Update.
- **Not in Phase 8:**
  - iPhone: decided later (owner, 18 Nov 2026), including whether to reuse Kotlin code.
  - Field salesman screens and staff access rules: later, after the owner's discussion.
  - Offline work: later. The app is online only now, but built so an on-phone database can be added later.
  - The Play Store listing: the owner decides later.

---

## 2. The owner's answers (18 Nov 2026)

| # | Question | Answer |
|---|---|---|
| 1 | Accept the Kotlin trade-offs: screens rebuilt from the design, on-phone maths kept in step with the web, about 16–20 weeks, iPhone separate later | **Yes** |
| 2 | Screen toolkit | **Jetpack Compose** |
| 3 | Where the code lives | **`apps/android`, in this same repository** |
| 4 | Keeping phone and web maths equal | **One shared list of test examples that both must pass** |
| 5 | Talking to the server | **Kotlin code generated from the server's exact description (OpenAPI)** |
| 6 | Reusable code for iPhone (Kotlin Multiplatform) | **Later** |
| 7 | Offline | **Online now; data handling ready for an on-phone database later** |
| 8 | Design match | **A picture at 390 px compared with the design, plus fit checks at every width from 320 to 480** |
| 9 | Fonts | **Inter** for English (from now on, also on the design page) and Noto Sans Devanagari for Hindi, both packed inside the app |
| 10 | Lowest Android version | **7.0** |
| 11 | How updates arrive | **Our own download first** (Check For Update → Download → Install), Play Store later |
| 12 | App ID (permanent) | **`in.billingo.app`**. It is not a website address, so any website name works with it |
| 13 | Signing key | **The owner keeps a second copy** (pen drive and paper) |
| 14 | Test phones | **The owner's phone, plus one cheap older phone (Android 7–9) for the trial** |
| 15 | Building on GitHub | The main repository is public, so builds are free: **an APK is built on every change for testing; only released versions are published** |
| 16 | Documents | **Updated for Kotlin in one PR** (this one) |

Nothing in Phase 8 costs money unless the owner later chooses the Play Store (₹2,100 once).

---

## 3. How it is built (in plain words)

**The app** lives in `apps/android` (a Gradle project next to the web and server code):
- **Jetpack Compose** for every screen, rebuilt from the approved design.
- **The 20 colours** in one Kotlin file. A test fails if any other colour appears, the same rule as the design.
- **Fonts:** Inter and Noto Sans Devanagari, packed inside the app.
- **Building blocks first:** buttons, cards, list rows, badges, fields, sheets, tabs and banners, the same set as design step 7.2. Every screen is then made from them, so the look stays consistent.
- **Phone features from Android itself:**
  - the camera and Google's barcode reader
  - phone contacts
  - fingerprint (Android's biometric prompt)
  - making a PDF (Android's PDF maker)
  - sharing to WhatsApp (Android's share sheet)
  - a safe place to stay signed in (Android Keystore)
  - checking the network
  - installing a downloaded update
- **Ready for offline later:** screens get their data through one middle layer. Today it asks the server; later it can ask an on-phone database first.

**The server stays the boss.** Numbering, GST, rounding, stock, balances, permissions and the audit log stay on the server (`apps/api`, `packages/shared`). What the phone works out while you type (line totals, discount, CGST/SGST, round off, amount in words) is only a preview. The server's figure is the one saved.

**Keeping phone and web maths equal.** The phone's preview maths is a Kotlin copy of the web's TypeScript maths. To stop the two from drifting apart:
1. **One shared list of examples** in `packages/shared` (for example: ₹342 with 10% discount and ₹150 transport = ₹513).
2. The web's tests and the Kotlin tests **both run every example**. If either gives a different answer, the build fails before any APK is made.

**Talking to the server without mistakes.** The server publishes an exact description of every request and answer (OpenAPI). The Kotlin code that talks to the server is generated from it automatically, so when the server changes, the phone code is regenerated, not retyped.

**Changes on the server (step 8.1):**
1. **Phone sign-in.** Today "stay signed in" lives in a browser cookie. The phone keeps the same sign-in token in Android's safe store and sends it in a header. The web keeps its cookie, unchanged. Done in 8.1c (18 Nov 2026): the phone sends `x-app-client: phone` on every call, gets `refreshToken` and `refreshExpires` in the answer of sign-in, sign-up, shop switch and renewal, and sends the token back in `x-refresh-token` to `/auth/refresh` and `/auth/logout`. A call from a web page (it always carries an Origin) is never treated as the phone.
2. **No double bills.** Every new bill, payment or note from the phone carries a one-time key (the `Idempotency-Key` header), so if it is sent twice (weak internet), the server saves it once and the repeat gets the first answer back. Two copies arriving together make one bill; a save that fails can be sent again; the same key for a different save is refused; keys are kept 7 days and are not part of backups. Done in 8.1b (18 Nov 2026).
3. **The server's exact description** (OpenAPI), produced from the server's own code on every build. Done in 8.1d (18 Nov 2026): `apps/api/openapi.json`, made by `pnpm --filter @billing/api openapi` from the same shared rules that check each input; a test fails when it is out of date. Answers are described as plain JSON for now; their shapes are added as the phone screens need them.
4. **A small "latest version" answer** for Check For Update, read from the releases page. Done in 8.1d: `GET /api/app-version?app=android` gives the newest release tagged `android-v<version>` with an `.apk`, its download link and notes, and the oldest version still allowed (`ANDROID_MIN_VERSION`, for "Update Needed"); GitHub is asked at most every 10 minutes.
5. **Shared maths examples.** Done in 8.1d: `packages/shared/examples/maths.json` holds 24 bills (sales and purchases: GST, IGST, prices with GST, discounts, charges, TCS, round off, composition, GST off) and 12 amounts in words, with their exact answers. The web and server maths are tested against it; the phone's Kotlin maths will be too.

(Unlike a web page, a Kotlin app needs no "allowed address" setting on the server.)

**Invoice PDF.** The phone draws the invoice with Android's PDF maker, following the same layout the web prints and the Print And Invoice settings (approved in 7.4i). It is compared with the web's printed invoice (step 8.5). Nothing runs on the free server.

**No internet.** The app shows the approved banner. A bill saved without internet is kept on the phone (encrypted) and sent once when the internet is back. The one-time key from server change 2 makes sure it is one bill, never two.

---

## 4. The steps

Every step from 8.3 on follows the same routine:
1. Build the screens in Compose from the approved design.
2. Run the tests (section 6): the shared maths examples, Compose screen tests, fit checks at every width from 320 to 480 in English and Hindi with large text, the 390 px picture compared with the design, and flow tests on an Android emulator. The web's existing tests must still pass unchanged.
3. GitHub builds the APK (free, public repository).
4. **The owner installs it and tries it** (Settings › Check For Update shows the new version).
5. The owner says "approved" (or what to change). A PR is merged on the owner's "merge"; README and STATUS are updated.

| Step | What is built | How we check it | Rough time |
|---|---|---|---|
| **8.0** | Start: allowed by the owner on 18 Nov 2026; the answers in section 2 are given | — | done |
| **8.1** | **Server groundwork:** (a) **numbers only from the server**: no document number can be typed or edited anywhere (phone, web, Windows), and **live numbers**: an open bill, quotation, challan, payment or note screen shows the new next number at once when the same kind of document is saved anywhere (instant message from the server, plus a check every 15 seconds; a short note says the number changed), in the web and Windows apps now and in the phone app from 8.2 (owner, 18 Nov 2026); (b) one-time keys against double bills; (c) phone sign-in; (d) the OpenAPI description, the version answer and the shared maths examples in `packages/shared` | All existing web and server tests pass; pictures pass unchanged (the number field looks the same, it only can't be typed in); new tests: a typed number is refused, two open screens get the new number after a save, sending a bill twice makes one bill, phone sign-in, the description | 2½ weeks |
| **8.2** | **App frame and building blocks:** `apps/android` set up (Kotlin, Compose, App ID `in.billingo.app`), the 20 colours, Inter and Noto Sans Devanagari, all building blocks of 7.2; sign in, fingerprint unlock, switch company, Home with real numbers, side menu, Create New, language switch, "No internet", "Server is waking up…", version line and Check For Update; the **signing key** is made (the owner keeps a copy); the APK built on GitHub <br>**Done so far (8.2a, 18 Nov 2026):** the `apps/android` project (Kotlin 2.1, Compose, App ID `in.billingo.app`, Android 7.0 and newer, portrait), the 20 colours in `ui/theme/Colours.kt` with a test that fails on any other colour, Inter and Noto Sans Devanagari packed inside the app (400–700), the app icon, and the Sign In look in English and Hindi (signing in itself comes in 8.2c). GitHub builds a test APK on every change (`.github/workflows/android.yml`). **8.2b (18 Nov 2026):** all building blocks of design 7.2 in Compose (`ui/parts/Parts.kt` and `Kit.kt`): top bar, summary cards, tabs, list rows with amount and word, 8 badges, 5 button kinds with icons and a busy spinner, fields (prefix, icon, contacts, error), choice field, switch, tick box, bottom bar, sheet with tiles, confirm box, 4 banners, toast, loading bars, empty state; all 35 design icons; Indian money format (1,60,119.40) without floats; a Building Blocks page in test builds (tap the version line 5 times). **8.2c (18 Nov 2026):** real sign-in and Create Account against the server (`data/Api.kt`, OkHttp; the "stay signed in" token locked with a key in Android's Keystore, `data/SafeStore.kt`; the access token renewed by itself), Choose Company when there is more than one shop, Fingerprint Unlock (Android's own window, which also offers the phone's screen lock) with the navy Welcome Back screen, and a temporary Home with Switch Company, the fingerprint switch and Sign Out. The calls are written by hand for now: the server's description gives exact request shapes, but its answers are still plain JSON, so the generated client comes when the answers are described (with the screens that need them). **8.2d (18 Nov 2026):** the real Home (shop and date on top, You'll Get / You'll Give from the parties' balances, Parties / Bills / Items tabs with real lists, badges Paid / Part Paid / Credit / Overdue N Days / Cancelled, Low / Out Of Stock, pull down to refresh, Take Payment, + and New Bill), the side menu with every part of the app (groups open and close; screens that come later say so), Create New with 12 tiles, Sign Out?, Choose Language (English / हिंदी, kept by Android), the No Internet banner and Server Is Waking Up… (a call taking over 4 seconds), and the version with Check For Update at the foot of the menu, with the fingerprint switch (both move to Settings in 8.10). Download opens the APK link; installing from inside the app comes with the signing key. Next: 8.2e the signing key. | **The owner installs the first APK and signs in on their own phone** | 2 weeks |
| **8.3** | Parties: list, party page, statement, add and edit, pick from contacts, call, WhatsApp reminder | Routine | 1 week |
| **8.4** | Items and stock: list, item page, add and edit (single and variant), stock adjustment, godowns and transfer, brands, Price Manager with PIN, camera barcode scan | Routine; scan tested with real barcodes | 1½ weeks |
| **8.5** | **New sale:** credit and cash, item page with search, batches, discount and charges, GST, referral, quotation import, payment received, Save and Share; **the invoice PDF** | Routine, plus: the PDF matches the web's printed invoice; the shared maths examples pass; a bill made on the phone appears on the web at once | 2½ weeks |
| **8.6** | Sale bills, quotations (brand-wise and item-wise), delivery challans, payments received, credit notes, commission; cancel | Routine | 2 weeks |
| **8.7** | Purchases: orders, bills with batches, payments made, debit notes | Routine | 1 week |
| **8.8** | Expenses, bank and cash books, transfers, cash count, cheques | Routine | 1 week |
| **8.9** | Reports (the 12 built ones) with PDF, Excel and WhatsApp share | Routine; numbers match the web's reports | 1 week |
| **8.10** | Settings (everything in 7.4i) and the special states of 7.4j (staff "Ask The Owner", view only, trial ended, update needed, signed out) | Routine | 1 week |
| **8.11** | **Full test and trial:** the owner's phone and a cheap older phone, Android 7 and the newest, slow internet, sunlight reading, Hindi throughout; about **two weeks of real use in the shop**; checklist `docs/ANDROID-TRIAL.md` | The checklist passes and the owner is happy to give the app to another shop | 2 weeks |
| **8.12** | Play Store listing (₹2,100 once) | Owner's decision, later | — |

**Total:** about **17 weeks** from the start, including the two-week trial. After the phone app is launched, the rest of the Windows trial continues (owner, 18 Nov 2026).

---

## 5. How updates work (the approved flow, made real)

1. Every release has a version number, the same way the Windows app does (for example `v1.0.1`).
2. GitHub builds and signs the APK. Released versions go on the releases page, next to the Windows installers.
3. In the app, **Settings › Check For Update** asks the server for the latest version. When a newer one exists, the app shows **Download Update**, then **Install Update**.
4. The first time, Android asks once: "Allow installing apps from BillinGo?" The owner says yes. After that, an update takes two taps.
5. After installing, the app restarts. The Settings line reads, for example, "BillinGo v1.0.1 · 18 Nov 2026, 9:15 am", and Sign In shows "BillinGo v1.0.1". Bills and data are untouched, because they live on the server.

---

## 6. Testing in detail

- **Server:** the existing API tests, plus new ones for phone sign-in, the one-time keys (the same bill sent twice makes one bill), the OpenAPI description and the version answer.
- **Maths:** the shared list of examples runs in the web's tests (TypeScript) and in the app's tests (Kotlin). Both must give the same answers.
- **Screens (Compose tests, no phone needed, run on every change):**
  - **Fit checks** at every width from 320 to 480, English and Hindi, normal and large text. They check that nothing runs outside the screen, no text or amount is cut, and every button is at least 44 px.
  - **One picture per screen at 390 px**, compared with the same screen of the approved design. Small pixel differences are allowed; layout and colours must match.
  - **A colour test** that fails on any colour outside the 20.
- **Flows on an Android emulator:** the design's tap tests (the ones that checked amounts by hand) are ported, so the same numbers come out. They run on GitHub, free for the public repository.
- **Real phones:** the owner tries every step's APK. Step 8.11 adds the cheap older phone.

---

## 7. Risks and how they are handled

1. **Phone and web maths drift apart:** the shared examples run on both sides on every change.
2. **The app looks different from the approved design:** the 390 px picture of each screen is compared with the design, and the owner approves every step.
3. **The free server sleeps** after 15 idle minutes. The app shows "Server is waking up…" (approved in 7.4j) and keeps trying by itself.
4. **Signing key lost:** apps could never be updated. The key is kept as a GitHub secret, and the owner keeps a second copy (pen drive and paper).
5. **Double bills on weak internet:** the one-time keys, tested by sending the same bill twice.
6. **Breaking the web app in step 8.1:** every existing web test and picture must pass unchanged before 8.1 is merged.
7. **Invoice PDF differs from the printed invoice:** step 8.5 compares the two before it is approved.
8. **Old or cheap phones are slow:** lists load in pages, and step 8.11 tests a cheap Android 7 phone.
9. **Installing from outside the Play Store** asks for Android's one-time permission. The app explains it in one line (approved in the design), and the Play Store remains an option later.

---

## 8. What the owner does

| When | The owner |
|---|---|
| 8.1 | Nothing to install yet; approves the server changes and says "merge" |
| 8.2 | Installs the first APK, signs in, keeps the copy of the signing key |
| 8.3 to 8.10 | Installs each new version (Check For Update), tries the new screens, says "approved" or what to change, then "merge" |
| 8.11 | Uses the app in the shop for about two weeks with the checklist |
| 8.12 | Decides about the Play Store |
