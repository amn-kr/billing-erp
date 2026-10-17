// @vitest-environment jsdom
/** The message strip: shown once, never again when the app is drawn again; green / red / black. */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';
import { useShell } from './store';

const el = () => document.getElementById('toast')!;

beforeEach(() => { vi.useFakeTimers(); useShell.setState({ toast: null }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Toast', () => {
  it('shows a message once, then clears it from the store', () => {
    render(<Toast />);
    act(() => useShell.getState().showToast('Invoice saved successfully', 'ok'));
    expect(el().textContent).toBe('Invoice saved successfully');
    expect(el().className).toBe('toast on ok');
    expect(useShell.getState().toast).toBeNull();
    act(() => vi.advanceTimersByTime(2200));
    expect(el().classList.contains('on')).toBe(false);
  });

  it('does not show an old message when it is drawn again', () => {
    const r = render(<Toast />);
    act(() => useShell.getState().showToast('INV-0012 saved'));
    act(() => vi.advanceTimersByTime(3000));
    r.unmount();
    render(<Toast />);
    expect(el().classList.contains('on')).toBe(false);
    expect(el().textContent).toBe('');
  });

  it('ignores a message left in the store before it was drawn', () => {
    useShell.setState({ toast: { text: 'old', n: 99, kind: 'info' } });
    render(<Toast />);
    expect(el().classList.contains('on')).toBe(false);
    expect(useShell.getState().toast).toBeNull();
  });

  it('red stays 4 seconds, black 2.2 seconds; the same text twice shows twice', () => {
    render(<Toast />);
    act(() => useShell.getState().showToast('Enter a quantity for “Item 1”.', 'error'));
    expect(el().className).toBe('toast on bad');
    act(() => vi.advanceTimersByTime(3900));
    expect(el().classList.contains('on')).toBe(true);
    act(() => vi.advanceTimersByTime(200));
    expect(el().classList.contains('on')).toBe(false);
    act(() => useShell.getState().showToast('Saved'));
    expect(el().className).toBe('toast on');
    act(() => vi.advanceTimersByTime(2100));
    act(() => useShell.getState().showToast('Saved'));
    act(() => vi.advanceTimersByTime(2100));
    expect(el().classList.contains('on')).toBe(true);
  });
});
