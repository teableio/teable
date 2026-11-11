import { describe, expect, it } from 'vitest';
import { envValidationSchema } from './env.validation.schema';

describe('envValidationSchema', () => {
  const createEnv = (overrides: Record<string, string | undefined> = {}) => ({
    PUBLIC_ORIGIN: 'http://localhost:3000',
    BACKEND_CACHE_REDIS_URI: 'redis://127.0.0.1:6379/0',
    ...overrides,
  });

  it.each<[string | undefined, boolean]>([
    [undefined, false],
    ['false', false],
    ['true', true],
    ['1', true],
    ['0', false],
    ['yes', true],
    ['no', false],
    ['on', true],
    ['off', false],
    [' TRUE ', true],
    [' OFF ', false],
  ])('requires explicit data-query opt-in: %s', (flag, enabled) => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
        V2_DATA_QUERY_ENABLED: flag,
      })
    );
    expect(error).toBeUndefined();
    expect(value.V2_DATA_QUERY_ENABLED).toBe(enabled);
  });

  it('rejects invalid data-query opt-in values', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
        V2_DATA_QUERY_ENABLED: 'enabled',
      })
    );
    expect(error).toBeDefined();
  });

  it.each<[string | undefined, boolean]>([
    [undefined, false],
    ['true', true],
    ['1', true],
    ['off', false],
    [' ON ', true],
  ])('parses the data-query runtime flag: %s', (flag, enabled) => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
        V2_DATA_QUERY_EXECUTE_ENABLED: flag,
      })
    );
    expect(error).toBeUndefined();
    expect(value.V2_DATA_QUERY_EXECUTE_ENABLED).toBe(enabled);
  });

  it('rejects invalid data-query runtime values', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
        V2_DATA_QUERY_EXECUTE_ENABLED: 'enabled',
      })
    );
    expect(error).toBeDefined();
  });

  it('accepts the table query ops settings a deployment can combine', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
        V2_TABLE_QUERY_OPS_SEARCH_MAINTENANCE_ENABLED: ' true ',
        V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME: ' AUTO ',
        V2_TABLE_QUERY_OPS_AUTO_ACCEPT: 'SHADOW',
        V2_TABLE_QUERY_OPS_ALLOWED_TASK_KINDS:
          'rebuild_search_access_path, drop_search_access_path',
        V2_TABLE_QUERY_OPS_STATEMENT_TIMEOUT_MS: '0',
        V2_TABLE_QUERY_OPS_ANALYZER_BATCH_SIZE: '50',
      })
    );
    expect(error).toBeUndefined();
    expect(value.V2_TABLE_QUERY_OPS_SEARCH_MAINTENANCE_ENABLED).toBe(true);
    expect(value.V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME).toBe('auto');
    expect(value.V2_TABLE_QUERY_OPS_AUTO_ACCEPT).toBe('shadow');
    expect(value.V2_TABLE_QUERY_OPS_STATEMENT_TIMEOUT_MS).toBe(0);
    expect(value.V2_TABLE_QUERY_OPS_ANALYZER_BATCH_SIZE).toBe(50);
  });

  it('keeps an unset table query ops switch unset', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({ PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable' })
    );
    expect(error).toBeUndefined();
    expect(value.V2_TABLE_QUERY_OPS_ENABLED).toBeUndefined();
    expect(value.V2_TABLE_QUERY_OPS_SEARCH_MAINTENANCE_ENABLED).toBeUndefined();
    expect(value.V2_TABLE_QUERY_OPS_TASK_WORKER_ENABLED).toBeUndefined();
  });

  it.each([
    ['V2_TABLE_QUERY_OPS_ENABLED', 'sometimes'],
    ['V2_TABLE_QUERY_OPS_SEARCH_MAINTENANCE_ENABLED', 'enabled'],
    ['V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME', 'maybe'],
    ['V2_TABLE_QUERY_OPS_AUTO_ACCEPT', 'automatic'],
    ['V2_TABLE_QUERY_OPS_ALLOWED_TASK_KINDS', 'rebuild_search_access_path,index_everything'],
    ['V2_TABLE_QUERY_OPS_ANALYZER_BATCH_SIZE', 'many'],
    ['V2_TABLE_QUERY_OPS_TASK_WORKER_INTERVAL_MS', '-1'],
  ])('rejects an invalid table query ops %s', (key, invalid) => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
        [key]: invalid,
      })
    );
    expect(error).toBeDefined();
  });

  it('defaults computed concurrency to two before config factories read validated env', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
      })
    );
    expect(error).toBeUndefined();
    expect(value.V2_COMPUTED_OUTBOX_TRIGGER_CONCURRENCY).toBe(2);
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
        BYODB_DATA_DB_PG_MAX_CONNECTIONS: '100',
        BYODB_DATA_DB_DATABASES_PER_SERVER: '20',
        BYODB_APP_NODES: '2',
        BYODB_DATA_DB_QUEUE_LIMIT: '0',
        BYODB_DATA_DB_QUEUE_TIMEOUT_MS: '2500',
        V2_SCHEMA_COORDINATION_MAX_CONNECTIONS: '4',
        V2_SCHEMA_COORDINATION_CONNECTION_TIMEOUT_MS: '5000',
      })
    );

    expect(error).toBeUndefined();
    expect(value.DATABASE_POOL_MAX).toBe(8);
    expect(value.BYODB_DATA_DB_POOL_MAX).toBe(4);
    expect(value.BYODB_DATA_DB_PG_MAX_CONNECTIONS).toBe(100);
    expect(value.BYODB_DATA_DB_DATABASES_PER_SERVER).toBe(20);
    expect(value.BYODB_APP_NODES).toBe(2);
    expect(value.BYODB_DATA_DB_QUEUE_LIMIT).toBe(0);
    expect(value.BYODB_DATA_DB_QUEUE_TIMEOUT_MS).toBe(2500);
    expect(value.V2_SCHEMA_COORDINATION_MAX_CONNECTIONS).toBe(4);
    expect(value.V2_SCHEMA_COORDINATION_CONNECTION_TIMEOUT_MS).toBe(5000);
  });

  it('rejects a non-positive BYODB server connection budget', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
        BYODB_DATA_DB_PG_MAX_CONNECTIONS: '0',
      })
    );

    expect(error?.message).toContain('BYODB_DATA_DB_PG_MAX_CONNECTIONS');
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
    expect(value.V2_COMPUTED_OUTBOX_MAX_CONCURRENT_PER_BASE).toBe(2);
    expect(value.V2_COMPUTED_OUTBOX_MAX_CONCURRENT_PER_SEED_TABLE).toBe(1);
    expect(value.V2_COMPUTED_OUTBOX_TASK_STATEMENT_TIMEOUT_MS).toBe(60_000);
    expect(value.V2_COMPUTED_INLINE_STATEMENT_TIMEOUT_MS).toBe(60_000);
    expect(value.V2_COMPUTED_OUTBOX_FIELD_BACKFILL_BATCH_SIZE).toBe(500);
    expect(value.V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_THRESHOLD).toBe(100);
    expect(value.V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_QUERY_LIMIT).toBe(50);
  });

  it('rejects non-positive per-base pending capacity settings', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
        V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_THRESHOLD: '0',
      })
    );

    expect(error?.message).toContain('V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_THRESHOLD');
  });

  it('rejects a non-positive per-base pending capacity query limit', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
        V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_QUERY_LIMIT: '0',
      })
    );

    expect(error?.message).toContain('V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_QUERY_LIMIT');
  });
  it('accepts computed task timeout, claim concurrency, and field-backfill overrides', () => {
    const { error, value } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
        V2_COMPUTED_OUTBOX_TASK_STATEMENT_TIMEOUT_MS: '0',
        V2_COMPUTED_INLINE_STATEMENT_TIMEOUT_MS: '15000',
        V2_COMPUTED_OUTBOX_MAX_CONCURRENT_PER_BASE: '4',
        V2_COMPUTED_OUTBOX_MAX_CONCURRENT_PER_SEED_TABLE: '2',
        V2_COMPUTED_OUTBOX_FIELD_BACKFILL_BATCH_SIZE: '250',
      })
    );

    expect(error).toBeUndefined();
    expect(value.V2_COMPUTED_OUTBOX_TASK_STATEMENT_TIMEOUT_MS).toBe(0);
    expect(value.V2_COMPUTED_INLINE_STATEMENT_TIMEOUT_MS).toBe(15_000);
    expect(value.V2_COMPUTED_OUTBOX_MAX_CONCURRENT_PER_BASE).toBe(4);
    expect(value.V2_COMPUTED_OUTBOX_MAX_CONCURRENT_PER_SEED_TABLE).toBe(2);
    expect(value.V2_COMPUTED_OUTBOX_FIELD_BACKFILL_BATCH_SIZE).toBe(250);
  });

  // Deployments upgraded from the memory/sqlite cache may still set these; the
  // cache always runs on Redis now, so they must not fail startup.
  it('ignores the retired cache provider variables', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
        BACKEND_CACHE_PROVIDER: 'sqlite',
        BACKEND_CACHE_SQLITE_URI: 'sqlite://.assets/.cache.db',
      }),
      { allowUnknown: true }
    );

    expect(error).toBeUndefined();
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

  it('accepts sign-in lockout overrides', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
        SIGNIN_ACCOUNT_LOCKOUT_ENABLED: 'false',
        SIGNIN_MAX_LOGIN_ATTEMPTS: '10',
        SIGNIN_ACCOUNT_LOCKOUT_MINUTES: '30',
      })
    );
    expect(error).toBeUndefined();
  });

  it.each([
    ['SIGNIN_ACCOUNT_LOCKOUT_ENABLED', 'off'],
    ['SIGNIN_MAX_LOGIN_ATTEMPTS', '0'],
    ['SIGNIN_ACCOUNT_LOCKOUT_MINUTES', '1.5'],
  ])('rejects an invalid %s', (name, value) => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
        [name]: value,
      })
    );
    expect(error?.message).toContain(name);
  });

  it('requires the Sign in with Apple credentials once the provider is enabled', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
        SOCIAL_AUTH_PROVIDERS: 'google,apple',
        BACKEND_APPLE_CLIENT: 'ai.teable.signin:ABCDE12345:FGHIJ67890',
      }),
      { allowUnknown: true }
    );

    expect(error?.message).toContain(
      'The `BACKEND_APPLE_PRIVATE_KEY` is required when `SOCIAL_AUTH_PROVIDERS` includes `apple`'
    );
  });

  it('spells out the BACKEND_APPLE_CLIENT format when it is not the id triple', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
        SOCIAL_AUTH_PROVIDERS: 'apple',
        BACKEND_APPLE_CLIENT: 'ai.teable.signin',
        BACKEND_APPLE_PRIVATE_KEY: 'key',
      }),
      { allowUnknown: true }
    );

    expect(error?.message).toContain('must be `<Services ID>:<Team ID>:<Key ID>`');
  });

  it('accepts a complete Sign in with Apple configuration', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
        SOCIAL_AUTH_PROVIDERS: 'apple',
        BACKEND_APPLE_CLIENT: 'ai.teable.signin:ABCDE12345:FGHIJ67890',
        BACKEND_APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----',
      }),
      { allowUnknown: true }
    );

    expect(error).toBeUndefined();
  });

  it('does not ask for Apple credentials while the provider is off', () => {
    const { error } = envValidationSchema.validate(
      createEnv({
        PRISMA_DATABASE_URL: 'postgresql://teable:teable@127.0.0.1:5432/teable',
        SOCIAL_AUTH_PROVIDERS: 'github,google',
        BACKEND_GITHUB_CLIENT_ID: 'github_client_id',
        BACKEND_GITHUB_CLIENT_SECRET: 'github_client_secret',
      }),
      { allowUnknown: true }
    );

    expect(error).toBeUndefined();
  });
});
