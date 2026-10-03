# Design baseline (Phase 0)

`capture.cjs` photographs the prototype so the rebuild can be compared with it.

```
pnpm install
pnpm baseline            # all widths: 1280, 1366, 1920
pnpm baseline 1366       # one width
```

Output goes to `reference/baseline/<width>/` (not committed — it is regenerated
the same way every time):

- `screens/` — the sign-in page plus the 26 app screens (one per section)
- `dialogs/` — all 41 dialogs plus the invoice drawer (`ov`)
- `report.json` — how each one was opened, and any page errors

Runs are repeatable: the clock is frozen at 1 Oct 2026 14:00 IST (the date the
sample data is built around), the timezone is Asia/Kolkata, and the Google
fonts are served from `fonts/` (refresh with `fetch-fonts.sh`).

Notes
- `vPls` (old "Price lists" screen) is retired in the prototype — `go('pls')`
  shows the Price manager — so it is not captured.
- `plm` (New price list) has no live button any more; it is shown with `openM`.
