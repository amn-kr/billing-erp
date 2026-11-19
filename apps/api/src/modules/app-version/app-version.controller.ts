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

/** The phone APK's download address: the release workflow always names it BillinGo-<version>.apk. */
export const apkUrl = (web: string, repo: string, version: string) => `${web}/${repo}/releases/download/android-v${version}/BillinGo-${version}.apk`;

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/**
 * The phone releases in the releases page's public feed (releases.atom): newest first, drafts never
 * appear in it. Read instead of GitHub's API, which allows only 60 questions an hour per internet
 * address without a key, and a free server shares its address with many others (found 19 Nov 2026:
 * the live server kept answering "no phone version" after 1.0.1 was published).
 */
export function phoneReleasesInFeed(xml: string, web: string, repo: string): Omit<AppVersion, 'minimum'>[] {
  const out: Omit<AppVersion, 'minimum'>[] = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const tag = /\/releases\/tag\/([^"<\s]+)"/.exec(e)?.[1] ?? '';
    const m = TAG.exec(decodeURIComponent(tag));
    if (!m) continue;
    const html = unescape(/<content[^>]*>([\s\S]*?)<\/content>/.exec(e)?.[1] ?? '');
    const notes = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().replace(/^No content\.$/, '');
    out.push({ app: 'android', latest: m[1]!, date: /<updated>([^<]+)<\/updated>/.exec(e)?.[1] ?? null, download: apkUrl(web, repo, m[1]!), notes: unescape(notes) });
  }
  return out;
}

async function readReleases(): Promise<Omit<AppVersion, 'minimum'>> {
  const c = config();
  const key = `${c.RELEASES_WEB_URL}|${c.RELEASES_API_URL}|${c.RELEASES_REPO}`;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.v;
  const none = { app: 'android' as const, latest: null, date: null, download: null, notes: '' };
  try {
    let found: Omit<AppVersion, 'minimum'>[];
    if (c.RELEASES_READ_TOKEN) {
      // with a key, GitHub's API (5,000 questions an hour); it also says which releases have an .apk
      const r = await fetch(`${c.RELEASES_API_URL}/repos/${c.RELEASES_REPO}/releases?per_page=50`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'billing-app-server', Authorization: `Bearer ${c.RELEASES_READ_TOKEN}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(String(r.status));
      found = ((await r.json()) as GhRelease[]).flatMap((g) => {
        const m = TAG.exec(g.tag_name);
        const apk = g.assets.find((a) => a.name.toLowerCase().endsWith('.apk'));
        return m && !g.draft && !g.prerelease && apk ? [{ app: 'android' as const, latest: m[1]!, date: g.published_at, download: apk.browser_download_url, notes: (g.body ?? '').trim() }] : [];
      });
    } else {
      const r = await fetch(`${c.RELEASES_WEB_URL}/${c.RELEASES_REPO}/releases.atom`, { headers: { 'User-Agent': 'billing-app-server' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(String(r.status));
      found = phoneReleasesInFeed(await r.text(), c.RELEASES_WEB_URL, c.RELEASES_REPO);
    }
    const best = found.reduce<Omit<AppVersion, 'minimum'>>((b, x) => (!b.latest || newer(x.latest!, b.latest) ? x : b), none);
    cache = { at: Date.now(), key, v: best };
    return best;
  } catch {
    // GitHub unreachable: keep the last answer for now, and ask again in a minute (not 10)
    if (cache && cache.key === key) { cache.at = Date.now() - TTL_MS + 60_000; return cache.v; }
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
