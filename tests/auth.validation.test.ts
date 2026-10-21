import { describe, expect, it } from 'vitest';

import { initialAdminSeedSchema, passwordPolicySchema } from '../src/modules/auth/auth.schema.js';

describe('passwordPolicySchema', () => {
  it('accepts a strong password', () => {
    expect(passwordPolicySchema.parse('StrongPass1!')).toBe('StrongPass1!');
  });

  it('rejects passwords shorter than 10 characters', () => {
    expect(() => passwordPolicySchema.parse('Short1!')).toThrow();
  });

  it('rejects passwords longer than bcrypt safely supports', () => {
    expect(() => passwordPolicySchema.parse(`${'A'.repeat(70)}a1!`)).toThrow();
  });

  it('requires uppercase, lowercase, number and special characters', () => {
    expect(() => passwordPolicySchema.parse('strongpass1!')).toThrow();
    expect(() => passwordPolicySchema.parse('STRONGPASS1!')).toThrow();
    expect(() => passwordPolicySchema.parse('StrongPass!!')).toThrow();
    expect(() => passwordPolicySchema.parse('StrongPass11')).toThrow();
  });

  it('rejects leading or trailing spaces', () => {
    expect(() => passwordPolicySchema.parse(' StrongPass1!')).toThrow();
    expect(() => passwordPolicySchema.parse('StrongPass1! ')).toThrow();
  });
});

describe('initialAdminSeedSchema', () => {
  it('validates initial administrator seed data', () => {
    expect(
      initialAdminSeedSchema.parse({
        name: ' Buminex Administrator ',
        email: 'Admin@Example.com',
        username: 'Admin_User-1',
        password: 'StrongPass1!',
      }),
    ).toEqual({
      name: 'Buminex Administrator',
      email: 'Admin@Example.com',
      username: 'Admin_User-1',
      password: 'StrongPass1!',
    });
  });

  it('rejects invalid email, username and password values', () => {
    expect(() =>
      initialAdminSeedSchema.parse({
        name: 'Admin',
        email: 'invalid-email',
        username: 'admin user',
        password: 'weak',
      }),
    ).toThrow();
  });
});
