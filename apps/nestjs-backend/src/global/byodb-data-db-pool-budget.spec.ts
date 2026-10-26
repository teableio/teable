import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BYODB_DATA_DB_POOL_MAX,
  DEFAULT_BYODB_DATA_DB_QUEUE_TIMEOUT_MS,
  DEFAULT_BYODB_SCHEMA_COORDINATION_CONNECTION_TIMEOUT_MS,
  TARGET_BYODB_SCHEMA_COORDINATION_MAX_CONNECTIONS,
  resolveByodbDataDbPoolSettings,
  resolveByodbSchemaCoordinationSettings,
} from './byodb-data-db-pool-budget';

const fullTopology = {
  BYODB_DATA_DB_PG_MAX_CONNECTIONS: '1702',
  BYODB_APP_NODES: '5',
  BYODB_DATA_DB_DATABASES_PER_SERVER: '1',
};

describe('resolveByodbDataDbPoolSettings', () => {
  it('keeps the legacy per-database default without server capacity evidence', () => {
    expect(resolveByodbDataDbPoolSettings({})).toEqual({
      max: DEFAULT_BYODB_DATA_DB_POOL_MAX,
      queueLimit: DEFAULT_BYODB_DATA_DB_POOL_MAX,
      queueTimeoutMillis: DEFAULT_BYODB_DATA_DB_QUEUE_TIMEOUT_MS,
      source: 'default',
    });
  });

  it('raises the default to the burst-headroom target when the budget allows it', () => {
    // 1361 / (5 pods × 1 database) = 272; minus the auxiliary reserve → 270,
    // capped at the 20-connection burst-headroom target.
    const settings = resolveByodbDataDbPoolSettings(fullTopology);

    expect(settings.max).toBe(20);
    expect(settings.queueLimit).toBe(20);
    expect(settings.source).toBe('formula');
    expect(settings.budget).toEqual({
      maxConnections: 1702,
      appNodes: 5,
      databasesPerServer: 1,
      connectionLimit: 1361,
      perPodDbBudget: 272,
      dataPoolMaxConnections: 270,
      belowMinimum: false,
    });
  });

  it('divides the 80% server budget across databases and app pods', () => {
    const settings = resolveByodbDataDbPoolSettings({
      BYODB_DATA_DB_PG_MAX_CONNECTIONS: '100',
      BYODB_DATA_DB_DATABASES_PER_SERVER: '20',
      BYODB_APP_NODES: '2',
    });

    // 80 / (2 × 20) = 2 per pod-database, exactly the two auxiliary connections.
    expect(settings.max).toBe(1);
    expect(settings.queueLimit).toBe(1);
    expect(settings.source).toBe('formula');
    expect(settings.budget).toMatchObject({
      connectionLimit: 80,
      perPodDbBudget: 2,
      dataPoolMaxConnections: 1,
      belowMinimum: true,
    });
  });

  it('does not guess a topology when capacity is declared only partially', () => {
    // Assuming one pod here would size every pod as if it owned the server.
    expect(resolveByodbDataDbPoolSettings({ BYODB_DATA_DB_PG_MAX_CONNECTIONS: '100' })).toEqual({
      max: DEFAULT_BYODB_DATA_DB_POOL_MAX,
      queueLimit: DEFAULT_BYODB_DATA_DB_POOL_MAX,
      queueTimeoutMillis: DEFAULT_BYODB_DATA_DB_QUEUE_TIMEOUT_MS,
      source: 'default',
    });
    expect(
      resolveByodbDataDbPoolSettings({
        BYODB_DATA_DB_PG_MAX_CONNECTIONS: '100',
        BYODB_APP_NODES: '2',
      }).budget
    ).toBeUndefined();
  });

  it('keeps an explicit per-database ceiling when it is below the formula', () => {
    expect(
      resolveByodbDataDbPoolSettings({
        ...fullTopology,
        BYODB_DATA_DB_POOL_MAX: '3',
      })
    ).toMatchObject({ max: 3, source: 'explicit' });
  });

  it('lowers an explicit ceiling when the formula is tighter', () => {
    expect(
      resolveByodbDataDbPoolSettings({
        BYODB_DATA_DB_POOL_MAX: '10',
        BYODB_DATA_DB_PG_MAX_CONNECTIONS: '100',
        BYODB_APP_NODES: '1',
        BYODB_DATA_DB_DATABASES_PER_SERVER: '20',
      })
      // 80 / 20 = 4 per pod-database minus two auxiliary connections.
    ).toMatchObject({ max: 2, explicitMax: 10, source: 'formula' });
  });

  it('keeps one connection and flags a budget that cannot carry the reserve', () => {
    const settings = resolveByodbDataDbPoolSettings({
      BYODB_DATA_DB_PG_MAX_CONNECTIONS: '2',
      BYODB_APP_NODES: '1',
      BYODB_DATA_DB_DATABASES_PER_SERVER: '1',
    });

    expect(settings.max).toBe(1);
    expect(settings.budget).toMatchObject({
      connectionLimit: 1,
      perPodDbBudget: 1,
      dataPoolMaxConnections: 1,
      belowMinimum: true,
    });
  });

  it('honours a zero queue limit and disabled queue timeout', () => {
    expect(
      resolveByodbDataDbPoolSettings({
        BYODB_DATA_DB_QUEUE_LIMIT: '0',
        BYODB_DATA_DB_QUEUE_TIMEOUT_MS: '0',
      })
    ).toMatchObject({ queueLimit: 0, queueTimeoutMillis: 0 });
  });

  it('ignores invalid numeric inputs instead of widening the budget', () => {
    expect(
      resolveByodbDataDbPoolSettings({
        BYODB_DATA_DB_POOL_MAX: 'not-a-number',
        BYODB_APP_NODES: '0',
        BYODB_DATA_DB_DATABASES_PER_SERVER: '-2',
        BYODB_DATA_DB_QUEUE_LIMIT: '-1',
        BYODB_DATA_DB_PG_MAX_CONNECTIONS: 'abc',
      })
    ).toEqual({
      max: DEFAULT_BYODB_DATA_DB_POOL_MAX,
      queueLimit: DEFAULT_BYODB_DATA_DB_POOL_MAX,
      queueTimeoutMillis: DEFAULT_BYODB_DATA_DB_QUEUE_TIMEOUT_MS,
      source: 'default',
    });
  });
});

describe('resolveByodbSchemaCoordinationSettings', () => {
  it('sizes coordination above the legacy eight slots and fails fast', () => {
    expect(resolveByodbSchemaCoordinationSettings({})).toEqual({
      maxConnections: TARGET_BYODB_SCHEMA_COORDINATION_MAX_CONNECTIONS,
      connectionTimeoutMillis: DEFAULT_BYODB_SCHEMA_COORDINATION_CONNECTION_TIMEOUT_MS,
      source: 'default',
    });
  });

  it('does not shrink with the customer-database budget', () => {
    // The coordination pool uses the meta connection string, so the BYODB
    // customer budget must not change its size.
    expect(resolveByodbSchemaCoordinationSettings(fullTopology)).toMatchObject({
      maxConnections: TARGET_BYODB_SCHEMA_COORDINATION_MAX_CONNECTIONS,
      source: 'default',
    });
  });

  it('lets an explicit coordination size and timeout win', () => {
    expect(
      resolveByodbSchemaCoordinationSettings({
        V2_SCHEMA_COORDINATION_MAX_CONNECTIONS: '12',
        V2_SCHEMA_COORDINATION_CONNECTION_TIMEOUT_MS: '5000',
      })
    ).toMatchObject({
      maxConnections: 12,
      connectionTimeoutMillis: 5000,
      source: 'explicit',
    });
  });
});
