// @vitest-environment jsdom
/** A renewed access token (every 15 minutes) must not leave the app without the signed-in person's data. */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMe } from './me';
import { useSettings } from './settings';
import { useSession } from './session';

const tok = (sub: string, bid: string, n: number) => `h.${btoa(JSON.stringify({ sub, bid, n }))}.s`;
let shop = 'Gupta Traders';
let drawn: string[] = [];

function Probe() {
  const me = useMe();
  const st = useSettings();
  drawn.push(`${me.data ? me.data.business?.name : '-'}/${st.data ? 'set' : '-'}`);
  return null;
}

beforeEach(() => {
  drawn = [];
  shop = 'Gupta Traders';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/me') ? { user: { name: 'Ravi' }, business: { name: shop } } : { gstEnabled: true, data: {}, taxes: [] }), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useSession.setState({ accessToken: null }); });

describe('useMe / useSettings', () => {
  it('keep their data when the token is renewed for the same person and shop', async () => {
    useSession.setState({ accessToken: tok('u1', 'b1', 1) });
    render(<QueryClientProvider client={new QueryClient()}><Probe /></QueryClientProvider>);
    await waitFor(() => expect(drawn.at(-1)).toBe('Gupta Traders/set'));
    const from = drawn.length;
    act(() => useSession.getState().setToken(tok('u1', 'b1', 2)));
    // not one drawing without the data (that was the whole app vanishing and coming back)
    expect(drawn.slice(from).every((d) => d === 'Gupta Traders/set')).toBe(true);
  });

  it('load the new shop after switching business', async () => {
    useSession.setState({ accessToken: tok('u1', 'b1', 1) });
    render(<QueryClientProvider client={new QueryClient()}><Probe /></QueryClientProvider>);
    await waitFor(() => expect(drawn.at(-1)).toBe('Gupta Traders/set'));
    shop = 'Sharma Lights';
    act(() => useSession.getState().setToken(tok('u1', 'b2', 2)));
    await waitFor(() => expect(drawn.at(-1)).toBe('Sharma Lights/set'));
  });
});
