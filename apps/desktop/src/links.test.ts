import { describe, expect, it } from 'vitest';
import { appUrl, linkAction } from './links';

const APP = 'https://billing-erp-ynqf.onrender.com';

describe('linkAction', () => {
  it('keeps the app’s own pages inside the app', () => {
    expect(linkAction(APP + '/', APP)).toBe('app');
    expect(linkAction(APP + '/login?next=/sales', APP)).toBe('app');
    expect(linkAction(APP + '/privacy.html', APP)).toBe('app');
  });

  it('opens WhatsApp, e-mail, phone and other websites outside the app', () => {
    expect(linkAction('https://wa.me/919876543210?text=Hi', APP)).toBe('external');
    expect(linkAction('mailto:shop@example.com', APP)).toBe('external');
    expect(linkAction('tel:+919876543210', APP)).toBe('external');
    expect(linkAction('http://example.com', APP)).toBe('external');
  });

  it('treats a look-alike address as another website', () => {
    expect(linkAction('https://billing-erp-ynqf.onrender.com.evil.example/', APP)).toBe('external');
    expect(linkAction('http://billing-erp-ynqf.onrender.com/', APP)).toBe('external');
  });

  it('lets the app open an empty window it writes into (printing)', () => {
    expect(linkAction('about:blank', APP)).toBe('popup');
    expect(linkAction('', APP)).toBe('popup');
  });

  it('refuses files on the computer, scripts and unknown kinds', () => {
    expect(linkAction('file:///C:/Windows/system32/calc.exe', APP)).toBe('block');
    expect(linkAction('javascript:alert(1)', APP)).toBe('block');
    expect(linkAction('ms-settings:privacy', APP)).toBe('block');
    expect(linkAction('not a url', APP)).toBe('block');
  });
});

describe('appUrl', () => {
  it('is the live app by default', () => {
    expect(appUrl({})).toBe(APP);
    expect(appUrl({ BILLING_APP_URL: ' ' })).toBe(APP);
  });

  it('takes another https address, or http on this computer only', () => {
    expect(appUrl({ BILLING_APP_URL: 'https://staging.example.com/x/' })).toBe('https://staging.example.com');
    expect(appUrl({ BILLING_APP_URL: 'http://localhost:5174' })).toBe('http://localhost:5174');
    expect(() => appUrl({ BILLING_APP_URL: 'http://example.com' })).toThrow();
  });
});
