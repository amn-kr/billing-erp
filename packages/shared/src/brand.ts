/**
 * THE APP'S NAME. Change the name here. Then run the brand check:  pnpm brand:check
 * (step by step: docs/RENAME.md)
 *
 * Everything people see reads it from here: the sidebar, the sign-in page, the page titles, the
 * Privacy policy and Terms pages, and the Google Drive backup folder. Package, folder, database and
 * file names are separate and never change with it.
 */
const name = 'Billing ERP';

export const BRAND = {
  /** the app's name, as people see it (keep it short: the brand check warns above 16 letters) */
  name,
  /**
   * Start of the Google Drive backup folder's name: "<this> - <shop name>". Only folders made from now
   * on get it; a shop's existing folder is found by its id and keeps its old name and its backups.
   */
  backupFolder: `${name} Backup`,
} as const;

/**
 * The old app's name (the prototype, reference/design/app.html, and the approved pictures). NEVER change it.
 * The picture tests show it (test mode, see apps/web/vite.config.ts), and messages about the old app's
 * backup files name it.
 */
export const OLD_APP = { name: 'Billing ERP', backupFolder: 'Billing ERP Backup' } as const;

export type Brand = { readonly name: string; readonly backupFolder: string };

/** Longest name that fits the sidebar title (about 167 px of room) without being cut off. */
export const BRAND_SAFE_LENGTH = 16;
