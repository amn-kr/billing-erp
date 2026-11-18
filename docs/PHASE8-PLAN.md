# Phase 8: the Android app, step by step

_Written and **approved by the owner on 18 Nov 2026**, after the phone design (Phase 7) was approved. **The owner decided on 18 Nov 2026 that Phase 8 starts now**; the rest of the Windows trial (sections D, F, F2, G and the shop trial I) comes after the phone app is launched._

This plan turns the approved design, `reference/design/mobile.html`, into a real Android app that the owner installs on a phone. It follows `docs/MOBILE-PLAN.md` (the owner's decisions, the 20 colours, the wording rules and the fit checks). This file adds the detail: what is built in each step, what is tested, and what the owner checks.

---

## 1. What Phase 8 makes

- **An Android app** (an APK file), online only, English and Hindi, Android 7.0 and newer, portrait only.
- It shows **exactly the approved phone design**. The CSS of `mobile.html` is copied unchanged, the same way the web app copies the prototype.
- It talks to **the same server** as the web app, so a bill made on the phone appears on the web and on the Windows app at once.
- **Phone-only features:** camera barcode scan, picking a party from phone contacts, fingerprint unlock, invoice PDF shared to WhatsApp, and Check For Update.
- **Not in Phase 8:** iPhone (Phase 9), field salesman screens and staff access rules (later, after the owner's discussion), and the Play Store listing (owner's decision, later).

---

## 2. Decisions for the owner at the start

The owner allowed Phase 8 to start now (18 Nov 2026). These five questions need an answer before step 8.2 makes the first APK. Each has our suggestion.

| # | Question | Our suggestion | Why |
|---|---|---|---|
| 1 | How do updates reach the phone? | **Our own download first** (the flow approved on 18 Nov 2026: Check For Update → Download → Install), from the same releases page the Windows app uses. Play Store later. | Free and fast. The Play Store costs ₹2,100 once and adds review days to every update. |
| 2 | The app's permanent ID (Android "package name") | `in.billingo.app` | It can never change after the first install, so it is fixed now. |
| 3 | Who keeps the **signing key** copy | The owner keeps a second copy on a pen drive and on paper, like the recovery key. | If the key is lost, installed apps can never be updated again. |
| 4 | Test phones | The owner's own phone, plus one cheap older phone (Android 7 to 9) borrowed for the trial. | Problems show up first on slow, small phones. |
| 5 | GitHub Actions minutes | Build the APK on GitHub only when a version is released (about 10 minutes each), not on every change. Phone tests run on this computer. | The Actions budget is already tight: nightly backups are on hold until 1 Dec 2026 because of it. |

Nothing in Phase 8 costs money unless the owner chooses the Play Store (₹2,100 once).

---

## 3. How it is built (in plain words)

**One shared middle layer.** The web app calls the server from about 246 places in its code. Step 8.1 moves those calls into one shared package (`packages/client`) that both the web app and the phone app use. That way a rule is written once, and the phone can never disagree with the web.

**The phone app** lives in `apps/mobile`:
- **Capacitor + React:** the screens are React components built from the approved design, with the design's CSS copied unchanged.
- **Phone features** come from Capacitor plugins:
  - secure storage for staying signed in (Android Keystore)
  - camera barcode scan
  - phone contacts
  - fingerprint
  - share sheet and files (PDF to WhatsApp)
  - network status ("No internet")
  - app version, and installing a downloaded update

**The server stays the boss.** Numbering, GST, rounding, stock, balances, permissions and the audit log stay on the server (`apps/api`, `packages/shared`). The phone repeats none of these rules; it only shows what the server says.

**Changes on the server (step 8.1):**
1. **Phone sign-in.** Today "stay signed in" lives in a browser cookie, which apps can't rely on. On the phone, the same refresh token is kept in Android's secure store and sent in a header. The web keeps its cookie, unchanged.
2. **No double bills.** Every new bill, payment or note from the phone carries a one-time key, so if the phone sends it twice (weak internet), the server saves it once. The server does not have this yet; it is added with its own tests.
3. **The server accepts the app's address** (Capacitor's local address), as it accepts the web app's today.
4. **A small "latest version" answer** for Check For Update, read from the releases page.

**Invoice PDF.** The web prints through the browser, which a phone can't do. The phone draws the same invoice layout the web prints and saves it as a PDF with Android's own PDF maker. Nothing runs on the free server. The PDF is compared with the web's printed invoice (step 8.5).

**No internet.** The app shows the approved banner. A bill saved without internet is kept on the phone (encrypted) and sent once when the internet is back. The one-time key from server change 2 guarantees one bill, never two.

---

## 4. The steps

Every step from 8.3 on follows the same routine:
1. Build the screens from the approved design.
2. Run the tests: flow tests (tapping through, as in the design), fit checks at every width from 320 to 480 px in English and Hindi with large text, one picture per screen at 390 px compared with the design, and the existing web tests. The web tests must still pass unchanged.
3. Make a new APK and put it on the releases page.
4. **The owner installs it and tries it** (Check For Update shows the new version).
5. A PR is merged on the owner's "merge"; README and STATUS are updated.

| Step | What is built | How we check it | Rough time |
|---|---|---|---|
| **8.0** | Start: the owner allowed it on 18 Nov 2026 (the rest of the Windows trial comes after the launch); the 5 decisions in section 2 answered | Owner says "start" | — |
| **8.1** | **Groundwork, no new screens:** the shared `packages/client` (the web's server calls move into it), phone sign-in on the server, one-time keys against double bills, the app's address allowed, the version answer | All existing web tests and pictures pass **unchanged**; new server tests for phone sign-in and double-send pass | 1½ weeks |
| **8.2** | **App frame:** `apps/mobile` with sign in, fingerprint unlock, switch company, Home with real numbers, side menu, Create New, language switch, "No internet", "Server is waking up…", Check For Update; the signing key is made (owner keeps a copy); APK built on GitHub on a release tag | **The owner installs the first APK and signs in on their own phone** | 1 week |
| **8.3** | Parties: list, party page, statement, add and edit, pick from contacts, call, WhatsApp reminder | Routine above | ½ week |
| **8.4** | Items and stock: list, item page, add and edit (single and variant), stock adjustment, godowns and transfer, brands, Price Manager with PIN, camera barcode scan | Routine; scan tested with real barcodes | 1 week |
| **8.5** | **New sale:** credit and cash, item page with search, batches, discount and charges, GST, referral, quotation import, payment received, Save and Share; **the invoice PDF** | Routine, plus: the PDF matches the web's printed invoice; a bill made on the phone appears on the web at once | 1½ weeks |
| **8.6** | Sale bills, quotations (brand-wise and item-wise), delivery challans, payments received, credit notes, commission; cancel | Routine | 1 week |
| **8.7** | Purchases: orders, bills with batches, payments made, debit notes | Routine | ½–1 week |
| **8.8** | Expenses, bank and cash books, transfers, cash count, cheques | Routine | ½ week |
| **8.9** | Reports (the 12 built ones) with PDF, Excel and WhatsApp share | Routine; numbers match the web's reports | ½ week |
| **8.10** | Settings (everything in 7.4i), and the special states of 7.4j (staff "Ask The Owner", view only, trial ended, update needed, signed out) | Routine | ½ week |
| **8.11** | **Full test and trial:** the owner's phone and a cheap older phone, Android 7 and the newest, slow internet, sunlight reading, Hindi throughout; about **two weeks of real use in the shop**; checklist `docs/ANDROID-TRIAL.md` | The checklist passes and the owner is happy to give the app to another shop | 2 weeks |
| **8.12** | Play Store listing (₹2,100 once) | Owner's decision, later | — |

**Total:** about **10 to 11 weeks** from the start, including the two-week trial. After the phone app is launched, the rest of the Windows trial continues (owner, 18 Nov 2026).

---

## 5. How updates work (the approved flow, made real)

1. Every release has a version number, the same way the Windows app does (for example `v1.0.1`).
2. GitHub builds the APK on a release tag, signs it with the key, and puts it on the releases page, next to the Windows installers.
3. In the app, **Settings › Check For Update** asks the server for the latest version. When a newer one exists, the app shows **Download Update**, then **Install Update**.
4. The first time, Android asks once: "Allow installing apps from BillinGo?" The owner says yes. After that, an update takes two taps.
5. After installing, the app restarts. The bottom line reads, for example, "BillinGo v1.0.1 · 18 Nov 2026, 9:15 am". Bills and data are untouched, because they live on the server.

---

## 6. Testing in detail

- **Server:** the existing API tests, plus new ones for phone sign-in, the one-time keys (sending the same bill twice makes one bill), and the version answer.
- **Shared layer (`packages/client`):** the web's existing tests and its 633 pictures must pass unchanged after step 8.1.
- **Phone screens:**
  - The same fit checks used for the design: every width from 320 to 480 px, English and Hindi, large text. They check that nothing runs outside the screen, no text or amount is cut, and every button is at least 44 px.
  - One picture per screen at 390 px, compared with the approved design.
  - The design's tap tests (the ones that checked amounts by hand) are ported, so the same numbers come out.
- **Real Android:** flow tests on an Android emulator on this computer before each APK. On GitHub, only the APK build runs, to save Actions minutes.
- **Real phones:** the owner tries every step's APK. Step 8.11 adds the cheap older phone.

---

## 7. Risks and how they are handled

1. **The free server sleeps** after 15 idle minutes. The app shows "Server is waking up…" (approved in 7.4j) and keeps trying by itself.
2. **Signing key lost:** apps could never be updated. The key is kept as a GitHub secret, and the owner keeps a second copy (pen drive and paper).
3. **Double bills on weak internet:** the one-time keys, tested by sending the same bill twice.
4. **Breaking the web app in step 8.1:** every existing web test and picture must pass unchanged before 8.1 is merged.
5. **Invoice PDF differs from the printed invoice:** step 8.5 compares the two before it is approved.
6. **Old or cheap phones are slow:** lists load in pages, pictures are small, and step 8.11 tests a cheap Android 7 phone.
7. **GitHub Actions budget:** the APK is built on GitHub only for releases; phone tests run on this computer.
8. **Installing from outside the Play Store** asks for Android's one-time permission. The app explains it in one line (approved in the design), and the Play Store remains an option later.

---

## 8. What the owner does

| When | The owner |
|---|---|
| At the start | Answers the 5 questions in section 2 and says "start" |
| 8.2 | Installs the first APK, signs in, keeps the copy of the signing key |
| 8.3 to 8.10 | Installs each new version (Check For Update), tries the new screens, says "approved" or what to change, then "merge" |
| 8.11 | Uses the app in the shop for about two weeks with the checklist |
| 8.12 | Decides about the Play Store |
