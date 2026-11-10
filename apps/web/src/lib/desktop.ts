/**
 * The Windows app (apps/desktop) adds `window.billingDesktop` to the app's pages. In a browser it is
 * missing, and everything works as before.
 */
export interface DesktopPrinter { name: string; displayName: string }
export type DesktopPrintResult = { ok: true; printer: string } | { ok: false; reason: 'none' | 'missing' | 'failed'; message?: string };

export interface Desktop {
  /** the printers Windows knows, and the one chosen on this PC (null: open the print window) */
  printers(): Promise<{ printers: DesktopPrinter[]; chosen: string | null }>;
  choosePrinter(name: string | null): Promise<{ chosen: string | null }>;
  /** print the page as it is now, straight to the chosen printer; page e.g. "A4 portrait" */
  print(page?: string): Promise<DesktopPrintResult>;
}

export const desktop = (): Desktop | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { billingDesktop?: Desktop }).billingDesktop;
