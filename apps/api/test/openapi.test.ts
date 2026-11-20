import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeApi } from '../src/openapi';

/** The server's description (step 8.1d): made from the code, kept in apps/api/openapi.json for the phone app. */
const FILE = path.resolve(__dirname, '../openapi.json');
type Op = { security?: unknown[]; requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown>; required?: string[] } }> }; parameters?: { name?: string; in?: string }[]; responses: Record<string, unknown> };
const api = describeApi() as { paths: Record<string, Record<string, Op>> };

describe('the server description (openapi.json)', () => {
  it('is up to date with the code (run: pnpm --filter @billing/api openapi)', () => {
    expect(JSON.parse(fs.readFileSync(FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(api)));
  });

  it('describes a new sale exactly, from the same rules that check it', () => {
    const op = api.paths['/api/sales']!.post!;
    const s = op.requestBody!.content['application/json']!.schema;
    expect(Object.keys(s.properties!)).toEqual(expect.arrayContaining(['date', 'partyId', 'lines', 'payments']));
    expect(op.responses['201']).toBeDefined();
    expect(op.security).toBeUndefined(); // needs sign-in
  });

  it('knows which addresses need no sign-in, path values and query values', () => {
    expect(api.paths['/api/auth/login']!.post!.security).toEqual([]);
    expect(api.paths['/api/app-version']!.get!.security).toEqual([]);
    expect(api.paths['/api/sales/{id}']!.get!.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'id', in: 'path' })]));
    expect(api.paths['/api/app-version']!.get!.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'app', in: 'query' })]));
    expect(api.paths['/api/live']!.get!.responses['200']).toMatchObject({ content: { 'text/event-stream': {} } });
  });
});
