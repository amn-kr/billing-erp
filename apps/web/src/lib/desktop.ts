/**
 * The Windows app (apps/desktop) adds `window.billingDesktop` to the app's pages. In a browser it is
 * missing, and everything works as before.
 */
export interface DesktopPrinter { name: string; displayName: string }
export type DesktopPrintResult = { ok: true; printer: string } | { ok: false; reason: 'none' | 'missing' | 'failed'; message?: string };

export interface Desktop {
  /** single-PC mode: the shop's books are on this computer (no demo shop, works without internet) */
  local?: boolean;
  /** single-PC mode only: Windows' folder picker for the backup folder or pen drive (null: cancelled) */
  chooseFolder?(title?: string): Promise<string | null>;
  /** single-PC mode only: this PC's recovery key ("ABCD-EFGH-…") and when it was last printed */
  recoveryKey?(): Promise<{ key: string; printedAt: string | null }>;
  /** single-PC mode only: prints the recovery key on its own page (Windows' print window) */
  printRecoveryKey?(): Promise<{ ok: boolean }>;
  /** single-PC mode only, after Move to cloud: this computer works online from now on (opens the online app) */
  useCloud?(moved: { code: string; email: string }): Promise<void>;
  /** the printers Windows knows, and the one chosen on this PC (null: open the print window) */
  printers(): Promise<{ printers: DesktopPrinter[]; chosen: string | null }>;
  choosePrinter(name: string | null): Promise<{ chosen: string | null }>;
  /** print the page as it is now, straight to the chosen printer; page e.g. "A4 portrait" */
  print(page?: string): Promise<DesktopPrintResult>;
}

export const desktop = (): Desktop | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { billingDesktop?: Desktop }).billingDesktop;
