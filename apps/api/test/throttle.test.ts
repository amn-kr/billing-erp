import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, uniqueEmail } from './helpers';

let app: INestApplication;
beforeAll(async () => { process.env.TEST_THROTTLE = '1'; app = await startApp(); });
afterAll(async () => { delete process.env.TEST_THROTTLE; await app.close(); });

describe('sign-in rate limit', () => {
  it('blocks the 11th sign-in attempt within a minute', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await request(app.getHttpServer()).post('/api/auth/login').send({ email: uniqueEmail(), password: 'guess' });
      codes.push(r.status);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});
