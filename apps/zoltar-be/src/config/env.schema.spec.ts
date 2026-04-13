import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const validEnv = {
    DATABASE_URL: 'postgresql://zoltar:zoltar_dev@db:5432/zoltar',
    NODE_ENV: 'development',
    PORT: '3000',
  };

  it('parses a fully valid env', () => {
    const result = validateEnv(validEnv);
    expect(result.DATABASE_URL).toBe(
      'postgresql://zoltar:zoltar_dev@db:5432/zoltar',
    );
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
  });

  it('coerces PORT from string to number', () => {
    const result = validateEnv({ ...validEnv, PORT: '8080' });
    expect(result.PORT).toBe(8080);
    expect(typeof result.PORT).toBe('number');
  });

  it('defaults PORT to 3000 when omitted', () => {
    const { PORT: _omitted, ...withoutPort } = validEnv;
    const result = validateEnv(withoutPort);
    expect(result.PORT).toBe(3000);
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = validEnv;
    expect(() => validateEnv(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL is not a URL', () => {
    expect(() =>
      validateEnv({ ...validEnv, DATABASE_URL: 'not-a-url' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('throws when NODE_ENV is not one of the allowed values', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('throws when PORT is not numeric', () => {
    expect(() => validateEnv({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('throws when PORT is negative', () => {
    expect(() => validateEnv({ ...validEnv, PORT: '-1' })).toThrow(/PORT/);
  });
});
