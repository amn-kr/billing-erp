# Styles — the app's own theme (copied unchanged from the prototype)

These files are the app's own theme (owner, 22 Nov 2026: the look comes from this theme; see `CLAUDE.md`). Change them only when the owner asks for a look change.
They started as byte-for-byte copies of the prototype; no test compares them with it any more.
Every colour and font in them (and anywhere else in the web and Windows apps) must be on the list in
`theme-list.ts`, or `look-guard.test.ts` fails. Adding to that list needs the owner's OK.

| File | Source |
|---|---|
| `app.css` | the `<style>` block in `reference/design/app.html` |
| `palette.css` | the colour-combination CSS the prototype generates at start-up (`PAL`) |
| `expenses.css` | the expenses CSS the prototype adds at start-up |
| `extras.css` | the small "Sample data" button CSS the prototype adds at start-up |
| `sync.css` | the cloud-sync button CSS the prototype adds at start-up |
| `auth.css` | the `<style>` block in `reference/firebase-site/public/index.html` (sign-in page) |

They are injected as `<style>` elements in the same order as in the
prototype (`useStyles`), and only while their page is on screen, because the
sign-in page and the app each style `body`, `.card`, `.btn` and so on differently.
