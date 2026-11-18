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
1. **Phone sign-in.** Today "stay signed in" lives in a browser cookie. The phone keeps the same sign-in token in Android's safe store and sends it in a header. The web keeps its cookie, unchanged.
2. **No double bills.** Every new bill, payment or note from the phone carries a one-time key, so if it is sent twice (weak internet), the server saves it once. The server does not have this yet; it comes with its own tests.
3. **The server's exact description** (OpenAPI), produced from the server's own code on every build.
4. **A small "latest version" answer** for Check For Update, read from the releases page.

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
| **8.1** | **Server groundwork:** phone sign-in, one-time keys against double bills, the OpenAPI description, the version answer; the shared maths examples in `packages/shared` | All existing web and server tests and pictures pass **unchanged**; new tests for phone sign-in, sending a bill twice (one bill made) and the description | 2 weeks |
| **8.2** | **App frame and building blocks:** `apps/android` set up (Kotlin, Compose, App ID `in.billingo.app`), the 20 colours, Inter and Noto Sans Devanagari, all building blocks of 7.2; sign in, fingerprint unlock, switch company, Home with real numbers, side menu, Create New, language switch, "No internet", "Server is waking up…", version line and Check For Update; the **signing key** is made (the owner keeps a copy); the APK built on GitHub | **The owner installs the first APK and signs in on their own phone** | 2 weeks |
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
