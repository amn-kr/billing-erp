import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators';
import { config } from '../../config';

/**
 * GET /api/app-version?app=android — the answer behind Check For Update on the phone (step 8.1d,
 * owner 18 Nov 2026): the newest phone version on the releases page, where to download it, and the
 * oldest version still allowed ("Update Needed" below it). No sign-in needed: the phone may ask
 * before anyone has signed in.
 *
 * Read from GitHub's releases list at most every 10 minutes (GitHub allows 60 asks an hour without a
 * key). If GitHub can't be reached, the last answer is kept.
 */
export interface AppVersion {
  app: 'android';
  /** newest version, e.g. "1.0.1"; null when none is out yet */
  latest: string | null;
  /** when it came out (ISO time) */
  date: string | null;
  /** the .apk file */
  download: string | null;
  /** what's new, as written on the releases page */
  notes: string;
  /** oldest version still allowed; null: any */
  minimum: string | null;
}

interface GhRelease { tag_name: string; draft: boolean; prerelease: boolean; published_at: string | null; body: string | null; assets: { name: string; browser_download_url: string }[] }

const TTL_MS = 10 * 60_000;
const TAG = /^android-v(\d+\.\d+\.\d+)$/;
let cache: { at: number; key: string; v: Omit<AppVersion, 'minimum'> } | null = null;

/** Compares "1.2.10" with "1.10.0" as numbers. */
export const newer = (a: string, b: string): boolean => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/** Tests: forget the remembered answer. */
export const forgetAppVersion = () => (cache = null);

async function readReleases(): Promise<Omit<AppVersion, 'minimum'>> {
  const c = config();
  const key = `${c.RELEASES_API_URL}|${c.RELEASES_REPO}`;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.v;
  const none = { app: 'android' as const, latest: null, date: null, download: null, notes: '' };
  try {
    const r = await fetch(`${c.RELEASES_API_URL}/repos/${c.RELEASES_REPO}/releases?per_page=50`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'billing-app-server' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(String(r.status));
    const list = (await r.json()) as GhRelease[];
    let best: Omit<AppVersion, 'minimum'> = none;
    for (const g of list) {
      const m = TAG.exec(g.tag_name);
      const apk = g.assets.find((a) => a.name.toLowerCase().endsWith('.apk'));
      if (!m || g.draft || g.prerelease || !apk) continue;
      if (!best.latest || newer(m[1]!, best.latest)) best = { app: 'android', latest: m[1]!, date: g.published_at, download: apk.browser_download_url, notes: (g.body ?? '').trim() };
    }
    cache = { at: Date.now(), key, v: best };
    return best;
  } catch {
    // GitHub unreachable: keep the last answer (a phone must not see "no update" by mistake for long)
    if (cache && cache.key === key) return cache.v;
    return none;
  }
}

@Controller('app-version')
export class AppVersionController {
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get()
  async get(@Query('app') app: string): Promise<AppVersion> {
    if (app !== 'android') throw new BadRequestException({ message: 'Unknown app.' });
    return { ...(await readReleases()), minimum: config().ANDROID_MIN_VERSION ?? null };
  }
}
