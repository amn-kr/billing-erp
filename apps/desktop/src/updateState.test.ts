import { describe, expect, it } from 'vitest';
import { label, nextState, type UpdateEvent, type UpdateState } from './updateState';

const run = (events: UpdateEvent[], manual: boolean, from: UpdateState = { kind: 'idle' }) => events.reduce((s, e) => nextState(s, e, manual), from);

describe('update button', () => {
  it('a click with nothing new: Checking…, then Up to date', () => {
    expect(nextState({ kind: 'idle' }, { type: 'checking' }, true)).toEqual({ kind: 'checking' });
    expect(run([{ type: 'checking' }, { type: 'none' }], true)).toEqual({ kind: 'latest' });
    expect(label({ kind: 'latest' }).text).toBe('Up to date');
  });

  it('a new version: downloads with progress, then offers a restart', () => {
    let s = run([{ type: 'checking' }, { type: 'available', version: '0.1.1' }], true);
    expect(s).toEqual({ kind: 'downloading', version: '0.1.1', percent: 0 });
    s = nextState(s, { type: 'progress', percent: 44.6 }, true);
    expect(label(s).text).toBe('Downloading v0.1.1… 45%');
    expect(label(s).action).toBe('none');
    s = nextState(s, { type: 'downloaded', version: '0.1.1' }, true);
    expect(s).toEqual({ kind: 'ready', version: '0.1.1' });
    expect(label(s)).toMatchObject({ text: 'Restart to update to v0.1.1', action: 'install' });
  });

  it('quiet checks (at start, every 4 hours) never show Checking, Up to date or errors', () => {
    expect(run([{ type: 'checking' }, { type: 'none' }], false)).toEqual({ kind: 'idle' });
    expect(run([{ type: 'checking' }, { type: 'error', message: 'offline' }], false)).toEqual({ kind: 'idle' });
    // but a new version found quietly still downloads and offers the restart
    expect(run([{ type: 'checking' }, { type: 'available', version: '0.2.0' }, { type: 'downloaded', version: '0.2.0' }], false)).toEqual({ kind: 'ready', version: '0.2.0' });
  });

  it('a click that fails says so, and the button can be clicked again', () => {
    const s = run([{ type: 'checking' }, { type: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' }], true);
    expect(s).toEqual({ kind: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });
    expect(label(s)).toMatchObject({ text: 'Couldn’t check — try again', action: 'check' });
  });

  it('a downloaded update stays ready until the restart', () => {
    const ready: UpdateState = { kind: 'ready', version: '0.1.1' };
    expect(run([{ type: 'checking' }, { type: 'none' }, { type: 'error', message: 'x' }], true, ready)).toEqual(ready);
  });

  it('a check during a download does not hide the progress', () => {
    const dl: UpdateState = { kind: 'downloading', version: '0.1.1', percent: 30 };
    expect(nextState(dl, { type: 'checking' }, true)).toEqual(dl);
  });

  it('progress stays between 0 and 100', () => {
    const dl: UpdateState = { kind: 'downloading', version: '1.0.0', percent: 0 };
    expect(nextState(dl, { type: 'progress', percent: 140 }, false)).toMatchObject({ percent: 100 });
    expect(nextState(dl, { type: 'progress', percent: -3 }, false)).toMatchObject({ percent: 0 });
  });

  it('a copy that is not installed says updates come to the installed app', () => {
    expect(label({ kind: 'unavailable' })).toMatchObject({ text: 'Updates: installed app only', action: 'none' });
  });
});
