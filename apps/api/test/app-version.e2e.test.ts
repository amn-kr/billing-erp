import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forgetAppVersion, newer } from '../src/modules/app-version/app-version.controller';
import { startApp } from './helpers';

/** Check For Update on the phone (step 8.1d): the newest phone version, read from the releases page. */
let app: INestApplication;
let gh: Server;
let releases: unknown[] = [];
let calls = 0;
let down = false;
const http = () => request(app.getHttpServer());
const rel = (tag: string, more: object = {}) => ({
  tag_name: tag, draft: false, prerelease: false, published_at: '2026-12-01T10:00:00Z', body: `What's new in ${tag}`,
  assets: [{ name: `BillinGo-${tag}.apk`, browser_download_url: `https://example.com/${tag}.apk` }], ...more,
});

beforeAll(async () => {
  gh = createServer((req, res) => {
    calls++;
    if (down) { res.writeHead(503).end(); return; }
    if (req.url?.startsWith('/repos/amn-kr/billing-erp-releases/releases')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(releases)); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => gh.listen(0, ok));
  process.env.RELEASES_API_URL = `http://127.0.0.1:${(gh.address() as AddressInfo).port}`;
  process.env.ANDROID_MIN_VERSION = '1.0.0';
  app = await startApp();
});
afterAll(async () => {
  await app.close();
  gh.close();
  delete process.env.RELEASES_API_URL;
  delete process.env.ANDROID_MIN_VERSION;
});
beforeEach(() => {
  forgetAppVersion();
  calls = 0;
  down = false;
});

describe('GET /api/app-version', () => {
  it('nothing out yet: no version, and no sign-in needed to ask', async () => {
    releases = [rel('v0.1.1', { assets: [{ name: 'Setup.exe', browser_download_url: 'https://example.com/setup.exe' }] })];
    expect((await http().get('/api/app-version?app=android').expect(200)).body).toEqual({ app: 'android', latest: null, date: null, download: null, notes: '', minimum: '1.0.0' });
  });

  it('the newest phone release with an .apk; Windows releases, drafts, test releases and ones without an .apk are skipped', async () => {
    releases = [
      rel('v0.1.2'),
      rel('android-v1.2.0', { draft: true }),
      rel('android-v1.1.0', { prerelease: true }),
      rel('android-v1.0.10'),
      rel('android-v1.0.9'),
      rel('android-v1.0.11', { assets: [] }),
    ];
    expect((await http().get('/api/app-version?app=android').expect(200)).body).toEqual({
      app: 'android', latest: '1.0.10', date: '2026-12-01T10:00:00Z', download: 'https://example.com/android-v1.0.10.apk', notes: "What's new in android-v1.0.10", minimum: '1.0.0',
    });
  });

  it('asks GitHub at most every 10 minutes, and keeps the last answer when GitHub is down', async () => {
    releases = [rel('android-v1.0.0')];
    await http().get('/api/app-version?app=android').expect(200);
    await http().get('/api/app-version?app=android').expect(200);
    expect(calls).toBe(1);
    forgetAppVersion();
    down = true;
    expect((await http().get('/api/app-version?app=android').expect(200)).body.latest).toBeNull();
    down = false;
    await http().get('/api/app-version?app=android').expect(200);
    down = true;
    // remembered answer survives GitHub being down (after the 10 minutes it is asked again)
    expect((await http().get('/api/app-version?app=android').expect(200)).body.latest).toBe('1.0.0');
  });

  it('only knows the phone app', async () => {
    await http().get('/api/app-version?app=ios').expect(400);
    await http().get('/api/app-version').expect(400);
  });

  it('compares versions as numbers', () => {
    expect(newer('1.0.10', '1.0.9')).toBe(true);
    expect(newer('1.10.0', '1.9.9')).toBe(true);
    expect(newer('1.0.0', '1.0.0')).toBe(false);
    expect(newer('0.9.9', '1.0.0')).toBe(false);
  });
});
