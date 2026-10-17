# Changing the app's name

The name people see is written in **one file**: `packages/shared/src/brand.ts`.
Everything else reads it from there. A rename takes a few minutes.

## On rename day

**(a) Edit the one file.**
On GitHub, open `packages/shared/src/brand.ts` and press the pencil (Edit).
Change only the text inside the quotes on this line:

```ts
const name = '...';
```

For example: `const name = 'New Name';`. Keep the quotes.
Keep it short. The brand check warns above 16 letters, because a longer name may be cut off in the sidebar.

**(b) Run the brand check.**
GitHub runs it for you on the pull request (step "Brand check"). On a computer, run `pnpm brand:check`.
It says in plain words if the name is still typed by hand anywhere.

**(c) Open the pull request.**
Press "Commit changes…" › "Create a new branch for this commit and start a pull request" › "Propose changes" › "Create pull request".
Wait for the green tick, then merge.

The picture tests always show the old name "Billing ERP" on purpose, because they compare with the prototype.
No approved picture changes with a rename.

**(d) After the merge, check the live app** (about 5 minutes after the merge; press Ctrl+Shift+R to reload):
- the sign-in page: the name next to the logo, and the browser tab title;
- after signing in: the name at the top of the sidebar, and the browser tab title;
- `/privacy.html` and `/terms.html`: the name at the top, in the text and at the bottom;
- Settings › General › Backup & restore, if Google Drive is connected: the folder name **stays the old one**. This is expected (see below).

## Google Drive backups

- A shop that already backs up to Google Drive keeps its folder. For example, "Billing ERP Backup - Verma Traders" keeps that name.
- The app finds the folder by its id, not by its name, so backups keep going into it. No backup is lost or hidden.
- Only a new folder gets the new name, for example "BillinGo Backup - <shop>". A new folder is made when a shop connects Google Drive for the first time, connects a different Google account, or the old folder was deleted.
- You may rename an old folder in Google Drive yourself. The app keeps working, but Settings still shows the old name.

## Not affected by a rename

- File names, folder names in the code, package names, database names and passwords.
- Old backups: they open and restore as before.
- The live address `https://billing-erp-ynqf.onrender.com` stays the same.
- Your books and your customers' data.

## Things outside the code that you change yourself

1. **Google sign-in screen (needed for Google Drive backups).** Go to console.cloud.google.com › your project › **Google Auth Platform** › **Branding** › **App name**. Change it to the new name and save, on the same day.
   - The Privacy policy tells people to look for the app under this name at myaccount.google.com/permissions.
   - If Google asks to check the app again, follow its steps. Reviewing a name change is free.
2. **Render and Neon names** (`billing-erp`, `billing-erp-api`). Changing them is **not needed and not recommended**: the live address and the database stay the same either way.
3. **Your own web address or email address** (for example `billingo.in`). This **costs money**, so decide first. It also needs a few setup steps on Render and Google. Ask before starting.
4. **Logo or icon.** Today the logo is the first letter of the name, made by the app. A real logo picture would change how the screens look, so ask for it as its own task.
5. **Privacy policy and Terms wording.** The pages take the new name by themselves. Ask your adviser to read both pages with the new name before you use it with customers.
6. **Check the name itself.** Before using a name for other shops, check that nobody else already uses it for a similar product. For example, "Billingo" is already an invoicing service (billingo.hu).

## For developers

- `packages/shared/src/brand.ts`:
  - `BRAND.name` is the name.
  - `BRAND.backupFolder` is the start of new Drive folder names.
  - `OLD_APP` is the prototype's name. Never change it.
- HTML pages use `{{APP_NAME}}`, `{{APP_LETTER}}` and `{{BACKUP_FOLDER}}`. The brand plugin in `apps/web/vite.config.ts` fills them in.
- App code uses `APP_NAME` from `apps/web/src/lib/brand.ts`.
- **Test mode:** Playwright's app server sets `BRAND_TEST_MODE=old-name`, so the picture tests and the prototype flows show `OLD_APP`.
  - It works only on the dev server. `vite build`, used for the live app, ignores it.
  - `e2e/brand.flows.spec.ts` checks the normal build on its own server (port 5175).
- **Rename test:** `apps/web/src/brand.rename.test.ts` builds the app as "Test Name" into a temporary folder and checks no page or code still has the old name.
- Do **not** touch `apps/api/src/modules/backup/crypto.ts`. Its `billing-erp` labels are part of the backup lock: changing them would stop old backups from opening.
