/**
 * Where a link or new window goes. The app's own pages stay inside the app; WhatsApp, e-mail and other
 * websites open in the computer's normal browser (or WhatsApp); anything else is refused.
 */
export type LinkAction = 'app' | 'popup' | 'external' | 'block';

/** Kinds of address that may be handed to the computer to open (browser, mail program, WhatsApp). */
const EXTERNAL = new Set(['https:', 'http:', 'mailto:', 'tel:', 'whatsapp:']);

export function linkAction(url: string, appOrigin: string): LinkAction {
  // an empty window the app writes into itself (e.g. printing the recovery codes)
  if (url === '' || url === 'about:blank') return 'popup';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'block';
  }
  if (u.origin === appOrigin) return 'app';
  if (EXTERNAL.has(u.protocol)) return 'external';
  return 'block';
}

/** The app's address: the live app unless BILLING_APP_URL says otherwise (tests, a staging copy). */
export function appUrl(env: Record<string, string | undefined>): string {
  const raw = env.BILLING_APP_URL?.trim() || 'https://billing-erp-ynqf.onrender.com';
  const u = new URL(raw);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) {
    throw new Error(`BILLING_APP_URL must be https (or http on this computer): ${raw}`);
  }
  return u.origin;
}
