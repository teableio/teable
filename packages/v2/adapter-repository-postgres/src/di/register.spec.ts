import { DefaultTableMapper, v2CoreTokens } from '@teable/v2-core';
import { Lifecycle } from '@teable/v2-di';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const ensureV1MetaSchema = vi.fn();
  const registerRecordWritePlugin = vi.fn();
  const PostgresTableRowLimitPlugin = vi.fn().mockImplementation(function (db, limit) {
    this.db = db;
    this.limit = limit;
    this.name = 'postgres-table-row-limit';
    this.supports = () => true;
  });

  return {
    ensureV1MetaSchema,
    registerRecordWritePlugin,
    PostgresTableRowLimitPlugin,
  };
});

vi.mock('../db/schema', () => ({
  ensureV1MetaSchema: mocks.ensureV1MetaSchema,
}));

vi.mock('../repositories/PostgresTableRowLimitPlugin', () => ({
  PostgresTableRowLimitPlugin: mocks.PostgresTableRowLimitPlugin,
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

  it('throws for invalid config', async () => {
    const { registerV2PostgresStateAdapter } = await import('./register');

    await expect(registerV2PostgresStateAdapter(createContainer() as never, {})).rejects.toThrow(
      'Invalid v2 postgres state adapter config'
    );
  });

  it('registers db, config and repositories, and ensures schema on demand', async () => {
    vi.resetModules();
    mocks.ensureV1MetaSchema.mockReset();
    mocks.registerRecordWritePlugin.mockReset();
    mocks.PostgresTableRowLimitPlugin.mockClear();

    const { registerV2PostgresStateAdapter } = await import('./register');
    const { v2PostgresStateTokens } = await import('./tokens');
    const { PostgresTableRepository } = await import('../repositories/PostgresTableRepository');
    const { PostgresSchemaOperationRepository } = await import(
      '../repositories/PostgresSchemaOperationRepository'
    );
    const { PostgresBaseRepository } = await import('../repositories/PostgresBaseRepository');

    const container = createContainer();
    const db = {
      selectFrom: vi.fn(),
      insertInto: vi.fn(),
      updateTable: vi.fn(),
      deleteFrom: vi.fn(),
    };

    const result = await registerV2PostgresStateAdapter(container as never, {
      db,
      ensureSchema: true,
    });

    expect(result).toBe(container);
    expect(mocks.ensureV1MetaSchema).toHaveBeenCalledWith(db);
    expect(container.instances).toEqual([
      {
        token: v2PostgresStateTokens.config,
        instance: expect.objectContaining({ db, ensureSchema: true }),
      },
      {
        token: v2PostgresStateTokens.db,
        instance: db,
      },
    ]);
    expect(container.registrations).toEqual([
      {
        token: v2PostgresStateTokens.tableMapper,
        implementation: DefaultTableMapper,
        options: { lifecycle: Lifecycle.Singleton },
      },
      {
        token: v2CoreTokens.tableMapper,
        implementation: DefaultTableMapper,
        options: { lifecycle: Lifecycle.Singleton },
      },
      {
        token: v2CoreTokens.tableRepository,
        implementation: PostgresTableRepository,
        options: { lifecycle: Lifecycle.Singleton },
      },
      {
        token: v2CoreTokens.schemaOperationRepository,
        implementation: PostgresSchemaOperationRepository,
        options: { lifecycle: Lifecycle.Singleton },
      },
      {
        token: v2CoreTokens.baseRepository,
        implementation: PostgresBaseRepository,
        options: { lifecycle: Lifecycle.Singleton },
      },
    ]);
    expect(mocks.registerRecordWritePlugin).not.toHaveBeenCalled();
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
    };

    await registerV2PostgresStateAdapter(container as never, {
      db,
      maxFreeRowLimit: 123,
    });

    expect(container.instances).toContainEqual({
      token: v2PostgresStateTokens.maxFreeRowLimit,
      instance: 123,
    });
    expect(mocks.PostgresTableRowLimitPlugin).toHaveBeenCalledWith(db, 123);
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
    mocks.PostgresTableRowLimitPlugin.mockClear();

    await registerV2PostgresStateAdapter(zeroLimitContainer as never, {
      db,
      maxFreeRowLimit: 0,
    });

    expect(mocks.PostgresTableRowLimitPlugin).not.toHaveBeenCalled();
    expect(mocks.registerRecordWritePlugin).not.toHaveBeenCalled();
  });
});
