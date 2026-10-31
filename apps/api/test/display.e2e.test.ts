/**
 * Density and text size (owner's request, 31 Oct 2026): each person's own choice, kept on their account.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, signUp, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

describe('display choices', () => {
  it('everyone starts on Comfortable + Normal text, the prototype’s look', async () => {
    const s = await signUp(app);
    const me = await http().get('/api/me').set(auth(s)).expect(200);
    expect(me.body.user).toMatchObject({ density: 'comfortable', textSize: 'normal' });
  });

  it('a person saves either choice or both; /me brings them back', async () => {
    const o = await owner(app);
    expect((await http().patch('/api/me/display').set(auth(o)).send({ density: 'compact' }).expect(200)).body).toEqual({ density: 'compact', textSize: 'normal' });
    expect((await http().patch('/api/me/display').set(auth(o)).send({ textSize: 'large' }).expect(200)).body).toEqual({ density: 'compact', textSize: 'large' });
    await http().patch('/api/me/display').set(auth(o)).send({ density: 'comfortable', textSize: 'small' }).expect(200);
    const me = await http().get('/api/me').set(auth(o)).expect(200);
    expect(me.body.user).toMatchObject({ density: 'comfortable', textSize: 'small' });
  });

  it('it is only for that person: staff choose their own, the owner’s stays', async () => {
    const o = await owner(app);
    const staff = await member(app, o, 'billing_staff');
    // billing staff can't change shop settings, but can change their own display
    await http().patch('/api/me/display').set(auth(staff)).send({ density: 'compact', textSize: 'large' }).expect(200);
    expect((await http().get('/api/me').set(auth(staff)).expect(200)).body.user).toMatchObject({ density: 'compact', textSize: 'large' });
    expect((await http().get('/api/me').set(auth(o)).expect(200)).body.user).toMatchObject({ density: 'comfortable', textSize: 'normal' });
  });

  it('works before the person has a shop', async () => {
    const s = await signUp(app);
    await http().patch('/api/me/display').set(auth(s)).send({ density: 'compact' }).expect(200);
    expect((await http().get('/api/me').set(auth(s)).expect(200)).body.user.density).toBe('compact');
  });

  it('refuses unknown values, unknown fields, an empty choice and no sign-in', async () => {
    const o = await owner(app);
    await http().patch('/api/me/display').set(auth(o)).send({ density: 'tiny' }).expect(400);
    await http().patch('/api/me/display').set(auth(o)).send({ textSize: 'huge' }).expect(400);
    await http().patch('/api/me/display').set(auth(o)).send({ density: 'compact', id: 'someone-else' }).expect(400);
    const r = await http().patch('/api/me/display').set(auth(o)).send({}).expect(400);
    expect(r.body.message).toBe('Choose a density or a text size.');
    await http().patch('/api/me/display').send({ density: 'compact' }).expect(401);
    expect((await http().get('/api/me').set(auth(o)).expect(200)).body.user).toMatchObject({ density: 'comfortable', textSize: 'normal' });
  });
});
