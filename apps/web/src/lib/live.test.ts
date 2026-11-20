import { describe, expect, it } from 'vitest';
import { readEvents } from './live';

const stream = (parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });

describe('live numbers: reading the server’s messages', () => {
  it('reads messages even when they arrive in pieces', async () => {
    const got: [string, string][] = [];
    await readEvents(stream(['event: numbers\ndata: {"docType":"inv', 'oice"}\n\nevent: ping\r\n', 'data: {}\r\n\r\n']), (e, d) => got.push([e, d]));
    expect(got).toEqual([['numbers', '{"docType":"invoice"}'], ['ping', '{}']]);
  });

  it('ignores a half message at the end', async () => {
    const got: string[] = [];
    await readEvents(stream(['event: numbers\ndata: {}\n\nevent: numb']), (e) => got.push(e));
    expect(got).toEqual(['numbers']);
  });
});
