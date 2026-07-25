import { describe, expect, it } from 'vitest';
import { envValidationSchema } from './env.validation.schema';

describe('envValidationSchema', () => {
  const createEnv = (overrides: Record<string, string | undefined> = {}) => ({
    PUBLIC_ORIGIN: 'http://localhost:3000',
    BACKEND_CACHE_REDIS_URI: 'redis://127.0.0.1:6379/0',
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

  it('accepts split meta env without the legacy alias', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_META_DATABASE_URL:
          'postgresql://teable:teable@127.0.0.1:5432/teable-meta?schema=public',
      })
    );

    expect(error).toBeUndefined();
    expect(value.PRISMA_META_DATABASE_URL).toContain('/teable-meta');
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

  it('requires Redis for the BullMQ computed outbox', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
        BACKEND_CACHE_REDIS_URI: undefined,
      })
    );

    expect(error?.message).toContain('BACKEND_CACHE_REDIS_URI');
  });

  it('accepts BullMQ computed outbox configuration with Redis', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
      })
    );

    expect(error).toBeUndefined();
    expect(value.V2_COMPUTED_OUTBOX_MONITOR_INTERVAL_MS).toBe(30_000);
  });

  it('rejects disabling both BullMQ roles', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
        V2_COMPUTED_OUTBOX_TRIGGER_PRODUCER_ENABLED: 'false',
        V2_COMPUTED_OUTBOX_TRIGGER_CONSUMER_ENABLED: 'false',
      })
    );

    expect(error?.message).toContain('requires a producer or consumer role');
  });
});
