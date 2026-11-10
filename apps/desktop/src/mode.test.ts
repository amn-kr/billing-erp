import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readMode, writeMode } from './mode';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'billing-mode-'));

describe('the first-start choice (mode.json)', () => {
  it('not chosen yet on a new computer', () => {
    expect(readMode(dir(), {})).toBeNull();
  });
  it('kept once chosen', () => {
    const d = dir();
    writeMode(d, 'local');
    expect(readMode(d, {})).toBe('local');
    writeMode(d, 'online');
    expect(readMode(d, {})).toBe('online');
    expect(fs.existsSync(path.join(d, 'mode.json.tmp'))).toBe(false);
  });
  it('BILLING_MODE wins (tests, support)', () => {
    const d = dir();
    writeMode(d, 'online');
    expect(readMode(d, { BILLING_MODE: 'local' })).toBe('local');
    expect(readMode(d, { BILLING_MODE: '' })).toBe('online');
  });
  it('a broken or unknown file asks again', () => {
    const d = dir();
    fs.writeFileSync(path.join(d, 'mode.json'), '{"mode":"phone"}');
    expect(readMode(d, {})).toBeNull();
    fs.writeFileSync(path.join(d, 'mode.json'), '{not json');
    expect(readMode(d, {})).toBeNull();
  });
  it('only the two modes can be written', () => {
    expect(() => writeMode(dir(), 'phone' as never)).toThrow();
  });
});
