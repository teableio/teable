import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const ensureV1MetaSchema = vi.fn();
  const registerRecordWritePlugin = vi.fn();
  const StaticTableRowLimitPolicy = vi.fn().mockImplementation(function (
    this: { limit: unknown },
    limit
  ) {
    this.limit = limit;
  });
  const injectedTableRowLimitPolicy = {
    resolveMaxRowCount: vi.fn(),
  };
  const PostgresTableRowLimitPlugin = vi.fn().mockImplementation(function (
    this: {
      db: unknown;
      policy: unknown;
      name: string;
      supports: () => boolean;
    },
    db,
    policy
  ) {
    this.db = db;
    this.policy = policy;
    this.name = 'postgres-table-row-limit';
    this.supports = () => true;
  });

  return {
    ensureV1MetaSchema,
    registerRecordWritePlugin,
    injectedTableRowLimitPolicy,
    StaticTableRowLimitPolicy,
    PostgresTableRowLimitPlugin,
  };
});

vi.mock('../db/schema', () => ({
  ensureV1MetaSchema: mocks.ensureV1MetaSchema,
}));

vi.mock('../repositories/PostgresTableRowLimitPlugin', () => ({
  PostgresTableRowLimitPlugin: mocks.PostgresTableRowLimitPlugin,
  StaticTableRowLimitPolicy: mocks.StaticTableRowLimitPolicy,
}));

vi.mock('@teable/v2-core', async () => {
  const actual = await vi.importActual<typeof import('@teable/v2-core')>('@teable/v2-core');
  return {
    ...actual,
    registerRecordWritePlugin: mocks.registerRecordWritePlugin,
  };
});

describe('registerV2PostgresStateAdapter', () => {
  const createContainer = () => {
    const instances: Array<{ token: unknown; instance: unknown }> = [];

    return {
      instances,
      registerInstance(token: unknown, instance: unknown) {
        instances.push({ token, instance });
        return this;
      },
      register: vi.fn().mockReturnThis(),
    };
  };

  it('throws for invalid config', async () => {
    const { registerV2PostgresStateAdapter } = await import('./register');

    await expect(registerV2PostgresStateAdapter(createContainer() as never, {})).rejects.toThrow(
      'Invalid v2 postgres state adapter config'
    );
  });

  it('registers the row-limit plugin only for positive limits', async () => {
    vi.resetModules();
    mocks.ensureV1MetaSchema.mockReset();
    mocks.registerRecordWritePlugin.mockReset();
    mocks.PostgresTableRowLimitPlugin.mockClear();

    const { registerV2PostgresStateAdapter } = await import('./register');
    const { v2PostgresStateTokens } = await import('./tokens');
    const container = createContainer();
    const db = {
      selectFrom: vi.fn(),
      insertInto: vi.fn(),
      updateTable: vi.fn(),
      deleteFrom: vi.fn(),
    } as unknown as Kysely<V1TeableDatabase>;
    const recordCountDb = {
      selectFrom: vi.fn(),
      insertInto: vi.fn(),
      updateTable: vi.fn(),
      deleteFrom: vi.fn(),
    } as unknown as Kysely<V1TeableDatabase>;

    await registerV2PostgresStateAdapter(container as never, {
      db,
      recordCountDb,
      tableMaxRowLimit: 123,
    });

    expect(container.instances).toContainEqual({
      token: v2PostgresStateTokens.tableMaxRowLimit,
      instance: 123,
    });
    expect(container.instances).toContainEqual({
      token: v2PostgresStateTokens.maxFreeRowLimit,
      instance: 123,
    });
    expect(mocks.StaticTableRowLimitPolicy).toHaveBeenCalledWith(123);
    expect(mocks.PostgresTableRowLimitPlugin).toHaveBeenCalledWith(
      recordCountDb,
      mocks.StaticTableRowLimitPolicy.mock.instances[0]
    );
    expect(mocks.registerRecordWritePlugin).toHaveBeenCalledTimes(1);
    expect(mocks.registerRecordWritePlugin.mock.calls[0]?.[0]).toBe(container);
    expect(mocks.registerRecordWritePlugin.mock.calls[0]?.[1]).toBe(
      mocks.PostgresTableRowLimitPlugin.mock.instances[0]
    );
    expect(mocks.registerRecordWritePlugin.mock.calls[0]?.[2]).toEqual({
      source: 'registerV2PostgresStateAdapter',
    });

    const zeroLimitContainer = createContainer();
    mocks.registerRecordWritePlugin.mockClear();
    mocks.StaticTableRowLimitPolicy.mockClear();
    mocks.PostgresTableRowLimitPlugin.mockClear();

    await registerV2PostgresStateAdapter(zeroLimitContainer as never, {
      db,
      tableMaxRowLimit: 0,
    });

    expect(mocks.StaticTableRowLimitPolicy).not.toHaveBeenCalled();
    expect(mocks.PostgresTableRowLimitPlugin).not.toHaveBeenCalled();
    expect(mocks.registerRecordWritePlugin).not.toHaveBeenCalled();
  });

  it('uses an injected row-limit policy when one is provided', async () => {
    vi.resetModules();
    mocks.ensureV1MetaSchema.mockReset();
    mocks.registerRecordWritePlugin.mockReset();
    mocks.StaticTableRowLimitPolicy.mockClear();
    mocks.PostgresTableRowLimitPlugin.mockClear();

    const { registerV2PostgresStateAdapter } = await import('./register');
    const container = createContainer();
    const db = {
      selectFrom: vi.fn(),
      insertInto: vi.fn(),
      updateTable: vi.fn(),
      deleteFrom: vi.fn(),
    } as unknown as Kysely<V1TeableDatabase>;

    await registerV2PostgresStateAdapter(container as never, {
      db,
      tableMaxRowLimit: 123,
      tableRowLimitPolicy: mocks.injectedTableRowLimitPolicy,
    });

    expect(mocks.StaticTableRowLimitPolicy).not.toHaveBeenCalled();
    expect(mocks.PostgresTableRowLimitPlugin).toHaveBeenCalledWith(
      db,
      mocks.injectedTableRowLimitPolicy
    );
  });
});
