// @vitest-environment jsdom
/** The helper later screens use: off until the shop has loaded, and off unless the owner turned it on. */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFeature } from './features';
import { useSession } from './session';

function Probe() {
  return <p>{`batch ${useFeature('batch_expiry')} medical ${useFeature('medical')}`}</p>;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useSession.setState({ accessToken: null }); });

describe('useFeature', () => {
  it('is off before the shop has loaded, then says what is on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { name: 'Ravi' }, business: { name: 'Gupta Traders', features: ['batch_expiry'] } }), { status: 200, headers: { 'content-type': 'application/json' } })));
    useSession.setState({ accessToken: `h.${btoa(JSON.stringify({ sub: 'u', bid: 'b' }))}.s` });
    render(<QueryClientProvider client={new QueryClient()}><Probe /></QueryClientProvider>);
    expect(screen.getByText('batch false medical false')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('batch true medical false')).toBeTruthy());
  });
});
