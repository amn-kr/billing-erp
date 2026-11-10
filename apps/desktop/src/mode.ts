/**
 * How this computer uses the app (docs/ARCHITECTURE.md, Phase 6 step 5), chosen once on the first start
 * (static/welcome.html) and kept in <userData>/mode.json:
 *   - "local":  single-PC mode, the shop's books on this computer (works without internet);
 *   - "online": the live app (several computers and phones; needs internet).
 * BILLING_MODE overrides it (tests, support). null: not chosen yet, so ask.
 */
import fs from 'node:fs';
import path from 'node:path';

export type Mode = 'local' | 'online';
export const isMode = (m: unknown): m is Mode => m === 'local' || m === 'online';

export const modeFile = (userData: string) => path.join(userData, 'mode.json');

export function readMode(userData: string, env: NodeJS.ProcessEnv = process.env): Mode | null {
  if (isMode(env.BILLING_MODE)) return env.BILLING_MODE;
  try {
    const m = (JSON.parse(fs.readFileSync(modeFile(userData), 'utf8')) as { mode?: unknown }).mode;
    return isMode(m) ? m : null;
  } catch {
    return null;
  }
}

/**
 * Written whole, then swapped in, so a power cut never leaves half a file. `movedToCloud`: the single-PC
 * books were moved to the online app (step 7); the books stay on this computer, no longer used.
 */
export function writeMode(userData: string, mode: Mode, movedToCloud?: { code: string; email: string }): void {
  if (!isMode(mode)) throw new Error('Unknown mode');
  fs.mkdirSync(userData, { recursive: true });
  const file = modeFile(userData);
  fs.writeFileSync(file + '.tmp', JSON.stringify({ mode, chosenOn: new Date().toISOString(), ...(movedToCloud ? { movedToCloud: { ...movedToCloud, on: new Date().toISOString() } } : {}) }, null, 2));
  fs.renameSync(file + '.tmp', file);
}
