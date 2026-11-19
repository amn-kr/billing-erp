import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forgetAppVersion, newer, phoneReleasesInFeed } from '../src/modules/app-version/app-version.controller';
import { BRAND } from '@billing/shared';
import { startApp } from './helpers';

/**
 * Check For Update on the phone (step 8.1d): the newest phone version, read from the releases
 * page's public feed (GitHub's API without a key is limited to 60 questions an hour per address).
 */
let app: INestApplication;
let gh: Server;
let base = '';
let feed = '';
let apiList: unknown[] = [];
let feedCalls = 0;
let apiCalls = 0;
let down = false;
let auth = '';
const http = () => request(app.getHttpServer());

const entry = (tag: string, title: string, notes: string, updated = '2026-12-01T10:00:00Z') => `
  <entry>
    <id>tag:github.com,2008:Repository/1/${tag}</id>
    <updated>${updated}</updated>
    <link rel="alternate" type="text/html" href="${base}/amn-kr/billing-erp-releases/releases/tag/${tag}"/>
    <title>${title}</title>
    <content type="html">${notes}</content>
  </entry>`;
const atom = (...entries: string[]) => `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${entries.join('')}</feed>`;

beforeAll(async () => {
  gh = createServer((req, res) => {
    if (down) { res.writeHead(503).end(); return; }
    if (req.url === '/amn-kr/billing-erp-releases/releases.atom') { feedCalls++; res.writeHead(200, { 'Content-Type': 'application/atom+xml' }).end(feed); return; }
    if (req.url?.startsWith('/repos/amn-kr/billing-erp-releases/releases')) { apiCalls++; auth = String(req.headers.authorization ?? ''); res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(apiList)); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => gh.listen(0, ok));
  base = `http://127.0.0.1:${(gh.address() as AddressInfo).port}`;
  Object.assign(process.env, { RELEASES_WEB_URL: base, RELEASES_API_URL: base, ANDROID_MIN_VERSION: '1.0.0', RELEASES_READ_TOKEN: '' });
  app = await startApp();
});
afterAll(async () => {
  await app.close();
  gh.close();
  for (const k of ['RELEASES_WEB_URL', 'RELEASES_API_URL', 'ANDROID_MIN_VERSION', 'RELEASES_READ_TOKEN']) delete process.env[k];
});
beforeEach(() => {
  forgetAppVersion();
  feedCalls = 0;
  apiCalls = 0;
  down = false;
});

describe('GET /api/app-version', () => {
  it('nothing out yet: no version, and no sign-in needed to ask', async () => {
    feed = atom(entry('v0.1.1', 'v0.1.1', '&lt;p&gt;Windows installer&lt;/p&gt;'));
    expect((await http().get('/api/app-version?app=android').expect(200)).body).toEqual({ app: 'android', latest: null, date: null, download: null, notes: '', minimum: '1.0.0' });
  });

  it('the newest phone release in the feed, with its APK address and notes; Windows releases skipped', async () => {
    feed = atom(
      entry('v0.1.2', 'v0.1.2', 'Windows'),
      entry('android-v1.0.10', `${BRAND.name} phone app 1.0.10`, '&lt;p&gt;Faster &amp;amp; safer&lt;/p&gt;', '2026-12-05T08:00:00Z'),
      entry('android-v1.0.9', `${BRAND.name} phone app 1.0.9`, 'Older'),
    );
    expect((await http().get('/api/app-version?app=android').expect(200)).body).toEqual({
      app: 'android', latest: '1.0.10', date: '2026-12-05T08:00:00Z', minimum: '1.0.0', notes: 'Faster & safer',
      download: `${base}/amn-kr/billing-erp-releases/releases/download/android-v1.0.10/${BRAND.name}-1.0.10.apk`,
    });
  });

  it('asks at most every 10 minutes, and keeps the last answer when GitHub is down', async () => {
    feed = atom(entry('android-v1.0.1', `${BRAND.name} phone app 1.0.1`, 'x'));
    await http().get('/api/app-version?app=android').expect(200);
    await http().get('/api/app-version?app=android').expect(200);
    expect(feedCalls).toBe(1);
    forgetAppVersion();
    down = true;
    expect((await http().get('/api/app-version?app=android').expect(200)).body.latest).toBeNull();
    down = false;
    await http().get('/api/app-version?app=android').expect(200);
    down = true;
    expect((await http().get('/api/app-version?app=android').expect(200)).body.latest).toBe('1.0.1');
  });

  it('with a GitHub key it asks the API instead (drafts, test releases and ones without an .apk skipped)', async () => {
    process.env.RELEASES_READ_TOKEN = 'ghp_example_key';
    const { resetConfig } = await import('../src/config');
    resetConfig();
    try {
      const rel = (tag: string, more: object = {}) => ({ tag_name: tag, draft: false, prerelease: false, published_at: '2026-12-01T10:00:00Z', body: 'notes', assets: [{ name: `${BRAND.name}-${tag}.apk`, browser_download_url: `https://example.com/${tag}.apk` }], ...more });
      apiList = [rel('android-v1.2.0', { draft: true }), rel('android-v1.1.0', { prerelease: true }), rel('android-v1.0.11', { assets: [] }), rel('android-v1.0.10')];
      const b = (await http().get('/api/app-version?app=android').expect(200)).body;
      expect(b).toMatchObject({ latest: '1.0.10', download: 'https://example.com/android-v1.0.10.apk' });
      expect(apiCalls).toBe(1);
      expect(feedCalls).toBe(0);
      expect(auth).toBe('Bearer ghp_example_key');
    } finally {
      process.env.RELEASES_READ_TOKEN = '';
      resetConfig();
    }
  });

  it('only knows the phone app', async () => {
    await http().get('/api/app-version?app=ios').expect(400);
    await http().get('/api/app-version').expect(400);
  });

  it('reads the real feed shape and compares versions as numbers', () => {
    const real = `<feed><entry><id>tag:github.com,2008:Repository/1453079490/android-v1.0.1</id><updated>2026-11-19T13:51:01Z</updated>
      <link rel="alternate" type="text/html" href="https://github.com/amn-kr/billing-erp-releases/releases/tag/android-v1.0.1"/>
      <title>${BRAND.name} phone app 1.0.1</title><content type="html">&lt;p&gt;Phone app (Android 7.0 and newer).&lt;/p&gt;</content></entry>
      <entry><link rel="alternate" type="text/html" href="https://github.com/amn-kr/billing-erp-releases/releases/tag/v0.1.0"/><content>No content.</content></entry></feed>`;
    expect(phoneReleasesInFeed(real, 'https://github.com', 'amn-kr/billing-erp-releases')).toEqual([
      { app: 'android', latest: '1.0.1', date: '2026-11-19T13:51:01Z', notes: 'Phone app (Android 7.0 and newer).', download: `https://github.com/amn-kr/billing-erp-releases/releases/download/android-v1.0.1/${BRAND.name}-1.0.1.apk` },
    ]);
    expect(newer('1.0.10', '1.0.9')).toBe(true);
    expect(newer('1.10.0', '1.9.9')).toBe(true);
    expect(newer('1.0.0', '1.0.0')).toBe(false);
  });
});
