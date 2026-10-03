import { describe, expect, it } from 'vitest';
import { createBusinessSchema, firstError, inviteSchema, loginSchema, registerSchema } from '../src/schemas';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, can } from '../src/permissions';

const shop = { name: 'Gupta Electricals', owner: 'Ravi Gupta', state: '09' };

describe('business form rules (same as the website)', () => {
  it('accepts a minimal shop', () => {
    const r = createBusinessSchema.parse(shop);
    expect(r.inv).toBe('1');
    expect(r.gstin).toBe('');
  });
  it('upper-cases and checks the GSTIN', () => {
    expect(createBusinessSchema.parse({ ...shop, gstin: '09abcps4821k1z6' }).gstin).toBe('09ABCPS4821K1Z6');
    const bad = createBusinessSchema.safeParse({ ...shop, gstin: '09ABC' });
    expect(!bad.success && firstError(bad.error)).toMatch(/GSTIN doesn’t look right/);
  });
  it('GSTIN state must match', () => {
    const r = createBusinessSchema.safeParse({ ...shop, state: '27', gstin: '09ABCPS4821K1Z6' });
    expect(!r.success && firstError(r.error)).toBe('GSTIN starts with 09 — choose that state.');
  });
  it('PIN code and invoice number', () => {
    expect(createBusinessSchema.safeParse({ ...shop, pin: '2260' }).success).toBe(false);
    expect(createBusinessSchema.safeParse({ ...shop, inv: 'A1' }).success).toBe(false);
    expect(createBusinessSchema.safeParse({ ...shop, pin: '226018', inv: '415' }).success).toBe(true);
  });
  it('needs a name and owner', () => {
    const r = createBusinessSchema.safeParse({ ...shop, name: ' ' });
    expect(!r.success && firstError(r.error)).toBe('Enter your business name.');
  });
});

describe('accounts', () => {
  it('normalises email', () => {
    expect(loginSchema.parse({ email: ' Aman@Sharma.Example.com ', password: 'x' }).email).toBe('aman@sharma.example.com');
  });
  it('requires 8+ character passwords', () => {
    expect(registerSchema.safeParse({ email: 'a@b.in', password: 'short' }).success).toBe(false);
  });
  it('cannot invite a second owner', () => {
    expect(inviteSchema.safeParse({ email: 'a@b.in', role: 'owner' }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: 'a@b.in', role: 'billing_staff' }).success).toBe(true);
  });
});

describe('roles', () => {
  it('owner can do everything', () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.owner].sort()).toEqual([...PERMISSIONS].sort());
  });
  it('billing staff cannot manage members or cancel', () => {
    const p = DEFAULT_ROLE_PERMISSIONS.billing_staff;
    expect(can(p, 'sales.create')).toBe(true);
    expect(can(p, 'members.manage')).toBe(false);
    expect(can(p, 'sales.cancel')).toBe(false);
  });
  it('only owner manages billing', () => {
    expect(can(DEFAULT_ROLE_PERMISSIONS.manager, 'billing.manage')).toBe(false);
    expect(can(DEFAULT_ROLE_PERMISSIONS.accountant, 'billing.manage')).toBe(false);
  });
});
