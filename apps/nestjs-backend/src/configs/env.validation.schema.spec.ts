import { describe, expect, it } from 'vitest';
import { envValidationSchema } from './env.validation.schema';

describe('envValidationSchema', () => {
  const createEnv = (overrides: Record<string, string | undefined> = {}) => ({
    PUBLIC_ORIGIN: 'http://localhost:3000',
    ...overrides,
  });

  it('accepts legacy single-db env', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
      })
    );

    expect(error).toBeUndefined();
    expect(value.PRISMA_DATABASE_URL).toContain('/teable');
  });

  it('accepts split meta/data env without the legacy alias', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_META_DATABASE_URL:
          'postgresql://teable:teable@127.0.0.1:5432/teable-meta?schema=public',
        PRISMA_DATA_DATABASE_URL:
          'postgresql://teable:teable@127.0.0.1:5432/teable-data?schema=public',
      })
    );

    expect(error).toBeUndefined();
    expect(value.PRISMA_META_DATABASE_URL).toContain('/teable-meta');
    expect(value.PRISMA_DATA_DATABASE_URL).toContain('/teable-data');
  });

  it('accepts DATABASE_URL as the last-resort meta fallback', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
      })
    );

    expect(error).toBeUndefined();
    expect(value.DATABASE_URL).toContain('/teable');
  });

  it('rejects missing meta database envs', () => {
    const { error } = envValidationSchema.validate(createEnv());

    expect(error?.message).toContain('PRISMA_META_DATABASE_URL');
  });
});
