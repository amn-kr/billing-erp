# Nightly database backup: separate private repository

The app's code repository is public. Anyone can download the files kept by a public repository's
runs, so the nightly backup of the live database runs from a separate **private** repository instead.
That repository holds just one file (`db-backup.yml` from this folder) and the three secrets.
The backup scripts themselves stay in the app's repository (`infra/db/backup/`) and are read from
`main` on every run, so they always match the app's current tables.

## Before you start
- The app repository `amn-kr/billing-erp` must already be **public**: the backup reads its scripts from there.
- Have ready: the two Neon connection strings and the backup passphrase (the same ones as the old
  repository's secrets `NEON_BACKUP_URL`, `NEON_APP_URL`, `BACKUP_PASSPHRASE`). GitHub never shows a
  saved secret again, so copy them from Neon and from where you wrote the passphrase down.

## Owner steps (about 10 minutes, free)
1. github.com › **+** › **New repository** › name `billing-erp-backups` › **Private** › tick *Add a README file* › **Create repository**.
2. In the new repository: **Add file › Create new file** › name `.github/workflows/db-backup.yml` ›
   paste the whole of `infra/backup-repo/db-backup.yml` › **Commit changes**.
3. **Settings › Secrets and variables › Actions › New repository secret**, three times:

   | Secret | Value |
   |---|---|
   | `NEON_BACKUP_URL` | Neon › Connect › role `neondb_owner`, pooling off |
   | `NEON_APP_URL` | Neon › Connect › role `erp_app` (the same as Render's `DATABASE_URL`) |
   | `BACKUP_PASSPHRASE` | the same passphrase as before, so old and new backups open the same way |

4. **Settings › Actions › General › Workflow permissions**: *Read repository contents and packages permissions*.
5. **Actions › Daily database backup › Run workflow**. Wait for green (about 3–5 minutes). The run's
   page shows a `db-backup-…` file under *Artifacts*.
6. After a green run, tell Claude. Then, in a pull request to the app repository: the old workflow
   (`.github/workflows/db-backup.yml`) is removed, and you delete the three secrets from
   `amn-kr/billing-erp` › Settings › Secrets and variables › Actions.

## Good to know
- **Cost:** free. A run takes about 3–5 minutes, so about 2 hours a month out of the 2,000 free
  private-repository minutes; 30 backups use about 5 MB of the 500 MB free storage. If this month's
  free minutes are already used up, runs start again when the allowance resets.
- **Restoring:** as in `docs/DEPLOY.md` › *Restoring*, but download the file from this private repository.
- **Safety:** each run uses the scripts on the app's `main` branch with these secrets, so only merge
  pull requests you trust into `main` (branch protection makes `main` change only through pull requests).
