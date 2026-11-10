import { describe, expect, it } from 'vitest';
import { pageFor } from './pages';

describe('pageFor (the same rules as the live site)', () => {
  it('the sign-in page', () => {
    expect(pageFor('GET', '/login')).toBe('login.html');
  });
  it('every screen of the app', () => {
    for (const p of ['/', '/sales', '/settings', '/parties/123', '/reports/gstr-1']) expect(pageFor('GET', p)).toBe('index.html');
  });
  it('never the API, never a real file, never a form post', () => {
    expect(pageFor('GET', '/api/health')).toBeNull();
    expect(pageFor('GET', '/api')).toBeNull();
    expect(pageFor('GET', '/assets/index-abc.js')).toBeNull();
    expect(pageFor('GET', '/privacy.html')).toBeNull();
    expect(pageFor('POST', '/sales')).toBeNull();
  });
  it('an address that only starts like the API is a page', () => {
    expect(pageFor('GET', '/apiary')).toBe('index.html');
  });
});
