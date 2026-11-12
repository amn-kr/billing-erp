# Windows app — trial checklist (Phase 6, step 8)

For the owner, on real Windows PCs. Tick each line; write what went wrong next to it (a photo of the screen helps).
Everything here was already tested automatically on GitHub's Windows machines and on the Mac; this checks it on
real computers, printers, pen drives and Google accounts.

**Before you start:** the releases access key and the Google "Desktop app" client are set up (docs/DEPLOY.md), and
v0.1.0 is on [the releases page](https://github.com/amn-kr/billing-erp-releases/releases).

## A. Install (do on a Windows 11 PC, then again on a Windows 10 PC)
- [ ] Download `BillinGo-Setup-0.1.0.exe` from the releases page and open it.
- [ ] Windows says "Windows protected your PC": *More info* › *Run anyway*. It installs without asking for an administrator password.
- [ ] A desktop icon and a Start-menu entry appear; the app opens.
- [ ] The top row shows the page title, "Version 0.1.0" and *Check for updates*. Clicking it says "Up to date".

## B. First start: This PC only
- [ ] The first screen asks "This PC only" or "Connect to cloud". Choose **This PC only**.
- [ ] "Opening your books…" for a few seconds, then the sign-in page (without "Open the demo shop").
- [ ] Click **Create account** and make an account and your shop. (Your online email and password don't work here: the PC's books are separate. From v0.1.1 the sign-in page can bring your online books to the PC instead.) The screens look the same as the website.
- [ ] Make 3 invoices, a payment received, a purchase bill. Numbers go INV-0001, 0002, 0003.
- [ ] Close the app and open it again: still signed in, everything there.
- [ ] **Turn Wi-Fi off** (and unplug the network cable). Make another invoice, open reports. Everything works; the fonts look the same. Turn Wi-Fi back on.

## C. Printing (A4 / A5)
- [ ] Settings › Print & invoice › *Printer on this PC*: choose your printer.
- [ ] Open an invoice › Print: it prints straight away, on the shop's paper size and direction, and says "Printed on …".
- [ ] Choose "Ask every time": Print opens the print window instead.
- [ ] Unplug or turn off the printer, press Print: the app says so plainly and opens the print window.

## D. Backups
- [ ] Settings › General › Backup & restore › choose **Pen drive or folder** › *Choose folder…* › a folder on a pen drive. Within a minute it says "Working".
- [ ] On the pen drive there is a folder "BillinGo Backup - BE-…" with files in it.
- [ ] Pull the pen drive out: the row says "Waiting" (no red line). Make an invoice. Put the pen drive back: within a minute it says "Working" again.
- [ ] *Recovery key* › *Print key*: the page prints with the key on one line. Keep it safe.
- [ ] Choose **Both** › *Connect Google Drive*: Google opens in your web browser; sign in and allow; the browser says "Google Drive is connected". Back in the app, the row shows your Google account within a few seconds, then "Working".
- [ ] In Google Drive there is a folder "BillinGo Backup - …" with files in it.
- [ ] *Test restore*: "The backup opened and checked out", with the same counts as your books.

## E. Restore on another computer (or another Windows user on the same PC)
- [ ] Install the app there, choose **This PC only**, create an account and a shop named "Temporary".
- [ ] Settings › Backup & restore › *Restore from files…* › **Pen drive or folder** › the pen drive › type the printed recovery key › *Open and check*: the counts match the first PC. Tick *I understand* › *Restore into new books* › *Open the restored books*: your shop, with everything; the next invoice number follows on.
- [ ] Again with **Google Drive** (connect the same Google account first): the same result.
- [ ] A wrong key is refused plainly.

## F. Move to cloud (use a test shop, not your real books)
- [ ] On a PC with a test shop in This PC only: Settings › General › Cloud sync › *Move to cloud…* › *Make a new online account* (a test email) › tick › *Move to cloud*. The counts on both sides match.
- [ ] *Open the online app* › sign in with the test email: the test shop is there, online. Closing and opening the app goes straight to the online app.
- [ ] On the website (any browser), sign in with the test email: the same shop.

## G. Connect to cloud, and uninstall
- [ ] On another Windows user or PC, choose **Connect to cloud**: your live online app opens inside the window; sign in; print works as in C.
- [ ] Windows Settings › Apps › BillinGo › Uninstall. Install again: the books and the choice are still there (they are kept in `%APPDATA%\billing-erp-desktop`).

## H. Update (after v0.1.1 is released)
- [ ] Within 4 hours (or by clicking *Check for updates*), the button turns green: "Restart to update to v0.1.1". Click it: the app restarts in the new version; the books are all there.

## I. The trial in the shop (about two weeks, This PC only)
- Use it for the shop's daily billing.
- Once a week: *Test restore* from the pen drive and from Google Drive.
- Note anything slow, confusing or wrong here, with the date:

| Date | What happened | Screen / steps |
|---|---|---|
| | | |
