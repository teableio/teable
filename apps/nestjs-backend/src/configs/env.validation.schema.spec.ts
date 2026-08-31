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

  it('accepts a positive process-level database pool limit', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
        DATABASE_POOL_MAX: '8',
        BYODB_DATA_DB_POOL_MAX: '4',
      })
    );

    expect(error).toBeUndefined();
    expect(value.DATABASE_POOL_MAX).toBe(8);
    expect(value.BYODB_DATA_DB_POOL_MAX).toBe(4);
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
    expect(value.V2_COMPUTED_OUTBOX_TASK_STATEMENT_TIMEOUT_MS).toBe(60_000);
    expect(value.V2_COMPUTED_INLINE_STATEMENT_TIMEOUT_MS).toBe(60_000);
    expect(value.V2_COMPUTED_OUTBOX_FIELD_BACKFILL_BATCH_SIZE).toBe(500);
  });

  it('accepts computed task timeout and field-backfill batch overrides', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
        V2_COMPUTED_OUTBOX_TASK_STATEMENT_TIMEOUT_MS: '0',
        V2_COMPUTED_INLINE_STATEMENT_TIMEOUT_MS: '15000',
        V2_COMPUTED_OUTBOX_FIELD_BACKFILL_BATCH_SIZE: '250',
      })
    );

    expect(error).toBeUndefined();
    expect(value.V2_COMPUTED_OUTBOX_TASK_STATEMENT_TIMEOUT_MS).toBe(0);
    expect(value.V2_COMPUTED_INLINE_STATEMENT_TIMEOUT_MS).toBe(15_000);
    expect(value.V2_COMPUTED_OUTBOX_FIELD_BACKFILL_BATCH_SIZE).toBe(250);
  });

  // A Joi default on BACKEND_CACHE_PROVIDER is written back into process.env by
  // ConfigModule.forRoot before the registerAs factories run, which would shadow
  // the URI-aware provider resolution in cache.config.ts and silently downgrade
  // Redis deployments to the sqlite cache.
  it('leaves the cache provider unset so cache.config can derive it', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
      })
    );

    expect(error).toBeUndefined();
    expect(value.BACKEND_CACHE_PROVIDER).toBeUndefined();
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

  it('accepts integer space scheduling limits', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
        SPACE_AI_FIELD_GENERATION_DEFAULT_LIMIT: '20',
      })
    );

    expect(error).toBeUndefined();
    expect(value.SPACE_AI_FIELD_GENERATION_DEFAULT_LIMIT).toBe(20);
  });

  it.each([
    ['SPACE_AI_FIELD_GENERATION_DEFAULT_LIMIT', 'abc'],
    ['SPACE_WORKFLOW_RUN_DEFAULT_LIMIT', '2.5'],
    ['SPACE_WORKFLOW_RUN_DEFAULT_LIMIT', '0'],
  ])('rejects invalid space scheduling limit %s=%s', (key, value) => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
        [key]: value,
      })
    );

    expect(error?.message).toContain(key);
  });
});
