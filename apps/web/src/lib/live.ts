import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { refreshSession } from './api';
import { tokenOwner, useSession } from './session';

/**
 * Live numbers (owner, 18 Nov 2026): when a document is saved on any screen of the shop, every open
 * bill, quotation or entry shows the new next number by itself. The server sends a short "numbers"
 * message over one long-lived connection (GET /api/live); the screens then ask for their next number
 * again. If the connection is down, the numbers are asked for again every 15 seconds anyway.
 */
const FALLBACK_MS = 15_000;
const RETRY_MS = [1_000, 3_000, 10_000, 30_000];

const refreshNumbers = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: ['next-number'] });

/** Reads server-sent events from a fetch body: calls `on(event)` for each complete message. */
export async function readEvents(body: ReadableStream<Uint8Array>, on: (event: string, data: string) => void): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let event = 'message';
      const data: string[] = [];
      for (const ln of block.split('\n')) {
        if (ln.startsWith('event:')) event = ln.slice(6).trim();
        else if (ln.startsWith('data:')) data.push(ln.slice(5).trimStart());
      }
      on(event, data.join('\n'));
    }
  }
}

/** Keeps the shop's live connection open while someone is signed in to a shop. Mount once. */
export function useLiveNumbers(): void {
  const qc = useQueryClient();
  const who = useSession((s) => tokenOwner(s.accessToken));
  useEffect(() => {
    const bid = who.split('|')[1];
    if (!bid || bid === 'null' || bid === 'undefined' || typeof ReadableStream === 'undefined') return;
    let stop = false;
    let ctl: AbortController | null = null;
    let tries = 0;
    let wait: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      if (stop) return;
      ctl = new AbortController();
      try {
        const token = useSession.getState().accessToken;
        const r = await fetch('/api/live', { credentials: 'include', signal: ctl.signal, headers: { Accept: 'text/event-stream', ...(token && { Authorization: `Bearer ${token}` }) } });
        if (r.status === 401 && (await refreshSession())) return void connect();
        if (!r.ok || !r.body) throw new Error(String(r.status));
        tries = 0;
        refreshNumbers(qc); // anything saved while we were away
        await readEvents(r.body, (event) => {
          if (event === 'numbers') refreshNumbers(qc);
        });
      } catch {
        /* dropped or refused: try again below */
      }
      if (stop) return;
      wait = setTimeout(() => void connect(), RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)]);
    };
    void connect();

    // a safety net for a connection that is down or held up by a network in between
    const tick = setInterval(() => refreshNumbers(qc), FALLBACK_MS);
    const back = () => { if (document.visibilityState === 'visible') refreshNumbers(qc); };
    document.addEventListener('visibilitychange', back);
    return () => {
      stop = true;
      ctl?.abort();
      clearTimeout(wait);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', back);
    };
  }, [qc, who]);
}
