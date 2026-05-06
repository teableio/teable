import { Lifecycle } from '@teable/v2-di';
import {
  formulaSqlPgTokens,
  Pg16TypeValidationStrategy,
  PgLegacyTypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPgInputIsValid: vi.fn(),
  assertTypeValidationPolyfill: vi.fn(),
}));

type RecordedContainer = ReturnType<typeof createContainer>;

const createContainer = () => {
  const instances: Array<{ token: unknown; instance: unknown }> = [];
  const registrations: Array<{ token: unknown; implementation: unknown; options: unknown }> = [];

  return {
    instances,
    registrations,
    registerInstance(token: unknown, instance: unknown) {
      instances.push({ token, instance });
      return this;
    },
    register(token: unknown, implementation: unknown, options: unknown) {
      registrations.push({ token, implementation, options });
      return this;
    },
  };
};

const getInstance = (container: RecordedContainer, token: unknown) =>
  container.instances.find((entry) => entry.token === token)?.instance;

const getRegistration = (container: RecordedContainer, token: unknown) =>
  container.registrations.find((entry) => entry.token === token);

const createDb = () => ({
  selectFrom: vi.fn(),
  insertInto: vi.fn(),
  updateTable: vi.fn(),
  deleteFrom: vi.fn(),
});

const loadRegisterModule = async () => {
  vi.resetModules();
  vi.doMock('../utils', () => ({
    hasPgInputIsValid: mocks.hasPgInputIsValid,
    assertTypeValidationPolyfill: mocks.assertTypeValidationPolyfill,
  }));
  return import('./register');
};

describe('registerV2TableRepositoryPostgresAdapter', () => {
  it('creates the correct type validation strategy for PG16 and legacy setups', async () => {
    const { createTypeValidationStrategy } = await loadRegisterModule();
    const db = createDb();

    mocks.hasPgInputIsValid.mockResolvedValueOnce(true);
    const pg16Strategy = await createTypeValidationStrategy(db as never);

    mocks.hasPgInputIsValid.mockResolvedValueOnce(false);
    const legacyStrategy = await createTypeValidationStrategy(db as never);

    expect(mocks.hasPgInputIsValid).toHaveBeenNthCalledWith(1, db);
    expect(mocks.hasPgInputIsValid).toHaveBeenNthCalledWith(2, db);
    expect(pg16Strategy.constructor.name).toBe(Pg16TypeValidationStrategy.name);
    expect(legacyStrategy.constructor.name).toBe(PgLegacyTypeValidationStrategy.name);
  });

  it('throws when the ddl config is invalid', async () => {
    const { registerV2TableRepositoryPostgresAdapter } = await loadRegisterModule();

    expect(() =>
      registerV2TableRepositoryPostgresAdapter(createContainer() as never, {} as never)
    ).toThrow('Invalid v2 postgres ddl adapter config');
  });

  it('registers default schema, record, strategy, and polling dependencies', async () => {
    const {
      registerV2TableRepositoryPostgresAdapter,
      registerV2RecordRepositoryPostgresAdapter,
      registerV2PostgresDdlAdapter,
    } = await loadRegisterModule();
    const { v2CoreTokens } = await import('@teable/v2-core');
    const { v2PostgresDdlTokens } = await import('../schema/di/tokens');
    const { v2RecordRepositoryPostgresTokens } = await import('../record/di/tokens');
    const { PostgresTableSchemaRepository } = await import(
      '../schema/repositories/PostgresTableSchemaRepository'
    );
    const { TableRecordQueryBuilderManager } = await import('../record/query-builder');
    const {
      HybridWithOutboxStrategy,
      defaultFieldBackfillConfig,
      defaultHybridWithOutboxStrategyConfig,
    } = await import('../record/computed');

    const container = createContainer();
    const db = createDb();

    const result = registerV2TableRepositoryPostgresAdapter(container as never, { db } as never);

    expect(result).toBe(container);
    expect(registerV2RecordRepositoryPostgresAdapter).toBe(
      registerV2TableRepositoryPostgresAdapter
    );
    expect(registerV2PostgresDdlAdapter).toBe(registerV2TableRepositoryPostgresAdapter);
    expect(getInstance(container, v2PostgresDdlTokens.config)).toEqual({ db });
    expect(getInstance(container, v2PostgresDdlTokens.db)).toBe(db);
    expect(getInstance(container, v2RecordRepositoryPostgresTokens.db)).toBe(db);
    expect(getInstance(container, v2RecordRepositoryPostgresTokens.metaDb)).toBe(db);
    expect(
      getInstance(container, formulaSqlPgTokens.typeValidationStrategy)?.constructor?.name
    ).toBe(Pg16TypeValidationStrategy.name);
    expect(
      getInstance(container, v2RecordRepositoryPostgresTokens.computedUpdateHybridConfig)
    ).toEqual(defaultHybridWithOutboxStrategyConfig);
    expect(getInstance(container, v2RecordRepositoryPostgresTokens.fieldBackfillConfig)).toEqual(
      defaultFieldBackfillConfig
    );
    expect(
      getInstance(container, v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig)
    ).toMatchObject({
      enabled: true,
      pollIntervalMs: 500,
    });
    expect(getRegistration(container, v2CoreTokens.tableSchemaRepository)).toEqual({
      token: v2CoreTokens.tableSchemaRepository,
      implementation: PostgresTableSchemaRepository,
      options: { lifecycle: Lifecycle.Singleton },
    });
    expect(
      getRegistration(container, v2RecordRepositoryPostgresTokens.tableRecordQueryBuilderManager)
    ).toEqual({
      token: v2RecordRepositoryPostgresTokens.tableRecordQueryBuilderManager,
      implementation: TableRecordQueryBuilderManager,
      options: { lifecycle: Lifecycle.Singleton },
    });
    expect(
      getRegistration(container, v2RecordRepositoryPostgresTokens.computedUpdateStrategy)
    ).toEqual({
      token: v2RecordRepositoryPostgresTokens.computedUpdateStrategy,
      implementation: HybridWithOutboxStrategy,
      options: { lifecycle: Lifecycle.Singleton },
    });
  });

  it('normalizes config overrides and registers the async strategy', async () => {
    const { registerV2TableRepositoryPostgresAdapter } = await loadRegisterModule();
    const { v2RecordRepositoryPostgresTokens } = await import('../record/di/tokens');
    const { AsyncWithRetryStrategy } = await import('../record/computed');

    const container = createContainer();
    const db = createDb();
    const metaDb = createDb();
    const customStrategy = new PgLegacyTypeValidationStrategy();

    registerV2TableRepositoryPostgresAdapter(container as never, {
      db,
      metaDb,
      typeValidationStrategy: customStrategy,
      computedUpdate: {
        mode: 'async',
        hybridConfig: {
          dispatchMode: 'push',
        },
        outboxConfig: {
          processingLeaseMs: 6001,
          heartbeatIntervalMs: 99999,
          reclaimBatchSize: 0,
        },
        lockConfig: {
          enabled: false,
        },
        pollingConfig: {
          enabled: false,
          pollIntervalMs: 250,
        },
        fieldBackfillConfig: {
          mode: 'hybrid',
        },
      },
    });

    expect(getInstance(container, formulaSqlPgTokens.typeValidationStrategy)).toBe(customStrategy);
    expect(getInstance(container, v2RecordRepositoryPostgresTokens.metaDb)).toBe(metaDb);
    expect(
      getInstance(container, v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig)
    ).toMatchObject({
      processingLeaseMs: 6001,
      heartbeatIntervalMs: 2000,
      reclaimBatchSize: 1,
    });
    expect(
      getInstance(container, v2RecordRepositoryPostgresTokens.computedUpdateLockConfig)
    ).toMatchObject({
      enabled: false,
      maxRecordLocks: 50,
      batchShardCount: 64,
    });
    expect(
      getInstance(container, v2RecordRepositoryPostgresTokens.fieldBackfillConfig)
    ).toMatchObject({
      mode: 'hybrid',
      hybridThreshold: 10000,
    });
    expect(
      getInstance(container, v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig)
    ).toMatchObject({
      enabled: false,
      pollIntervalMs: 250,
    });
    expect(
      getRegistration(container, v2RecordRepositoryPostgresTokens.computedUpdateStrategy)
    ).toEqual({
      token: v2RecordRepositoryPostgresTokens.computedUpdateStrategy,
      implementation: AsyncWithRetryStrategy,
      options: { lifecycle: Lifecycle.Singleton },
    });
  });

  it('registers the sync strategy and disables polling for push-only dispatch', async () => {
    const { registerV2TableRepositoryPostgresAdapter } = await loadRegisterModule();
    const { v2RecordRepositoryPostgresTokens } = await import('../record/di/tokens');
    const { SyncInTransactionStrategy } = await import('../record/computed');

    const container = createContainer();
    const db = createDb();

    registerV2TableRepositoryPostgresAdapter(container as never, {
      db,
      computedUpdate: {
        mode: 'sync',
        hybridConfig: {
          dispatchMode: 'push',
        },
      },
    });

    expect(
      getInstance(container, v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig)
    ).toMatchObject({
      enabled: false,
      pollIntervalMs: 1000,
    });
    expect(
      getRegistration(container, v2RecordRepositoryPostgresTokens.computedUpdateStrategy)
    ).toEqual({
      token: v2RecordRepositoryPostgresTokens.computedUpdateStrategy,
      implementation: SyncInTransactionStrategy,
      options: { lifecycle: Lifecycle.Singleton },
    });
  });
});
