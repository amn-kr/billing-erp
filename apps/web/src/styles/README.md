# Styles — the app's own theme (copied unchanged from the prototype)

These files are the app's own theme (owner, 22 Nov 2026: the look comes from this theme; see `CLAUDE.md`). Change them only when the owner asks for a look change.
Until part 2 of the look rule change is merged, do not edit them: they are byte-for-byte copies, and
`src/styles/styles.test.ts` fails if they drift from the prototype.

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
