import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldKeyType } from '@teable/core';
import type { ICreateTableRo, ITableVo } from '@teable/openapi';
import createKnex from 'knex';
import { PostgresProvider } from '../../db-provider/postgres.provider';
import { GlobalModule } from '../../global/global.module';
import { TableModule } from './table.module';
import { TableService } from './table.service';

describe('TableService', () => {
  let service: TableService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, TableModule],
    }).compile();

    service = module.get<TableService>(TableService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should convert table name to valid db table name', () => {
    const dbTableName = service.generateValidName('!@#$1_a ha3ha 中文');
    expect(dbTableName).toBe('t1_a_ha3ha_Zhong_Wen');
  });

  it('should limit table name to 40', () => {
    const dbTableName = service.generateValidName('t'.repeat(50));
    expect(dbTableName).toBe('t'.repeat(40));
  });

  it('should convert chinese to pin yin', () => {
    const dbTableName = service.generateValidName('中文');
    expect(dbTableName).toBe('Zhong_Wen');
  });

  it('should convert empty table name unnamed', () => {
    const dbTableName = service.generateValidName('');
    expect(dbTableName).toBe('unnamed');
  });
});

describe('TableService physical create capability', () => {
  const tableRo = {
    name: 'orders',
    description: null,
    icon: null,
    fieldKeyType: FieldKeyType.Id,
  } as ICreateTableRo;
  const setup = (options: { nested?: boolean; scoped?: boolean; commitError?: Error } = {}) => {
    const { nested, scoped, commitError } = options;
    const callbacks: Array<() => Promise<void>> = [];
    const rollbackCallbacks: Array<() => Promise<void>> = [];
    const events: string[] = [];
    const row = {
      id: 'tblTest',
      name: 'orders',
      dbTableName: 'bseTest.orders',
      version: 1,
      actorStorageVersion: 0,
      lastModifiedTime: null,
      provisionState: 'pending',
    };
    const dataTxClient = {
      $executeRawUnsafe: vi.fn(async (_query: string) => {
        events.push('ddl');
        return 0;
      }),
    };
    const dataRootClient = {
      $executeRawUnsafe: vi.fn(),
      $tx: vi.fn(async (fn: (client: typeof dataTxClient) => Promise<void>) => {
        let committed = false;
        try {
          await fn(dataTxClient);
          if (nested) return;
          if (commitError) throw commitError;
          events.push('commit');
          committed = true;
          for (const callback of callbacks.splice(0)) await callback();
        } finally {
          if (!nested && !committed) {
            for (const callback of rollbackCallbacks.splice(0)) await callback();
          }
        }
      }),
      ...(scoped
        ? {}
        : {
            afterCommit: vi.fn((callback: () => Promise<void>) => {
              callbacks.push(callback);
              return true;
            }),
            afterRollback: vi.fn((callback: () => Promise<void>) => {
              rollbackCallbacks.push(callback);
              return true;
            }),
          }),
    };
    const metaTxClient = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      tableMeta: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ ...row }),
        update: vi.fn(
          async ({
            data,
          }: {
            data: {
              actorStorageVersion?: number;
              provisionState?: string;
              version?: { increment: number };
            };
          }) => {
            if (data.actorStorageVersion === 1) {
              events.push('capability');
              row.actorStorageVersion = 1;
              row.version += data.version?.increment ?? 0;
            }
            if (data.provisionState) row.provisionState = data.provisionState;
            return { ...row };
          }
        ),
        updateMany: vi.fn(async ({ data }: { data: { provisionState: string } }) => {
          if (row.actorStorageVersion === 0) row.provisionState = data.provisionState;
          return { count: row.actorStorageVersion === 0 ? 1 : 0 };
        }),
      },
    };
    const saveRawOps = vi.fn();
    const knex = createKnex({ client: 'pg' });
    const service = new TableService(
      { get: vi.fn().mockReturnValue('usrTest') } as never,
      { txClient: vi.fn().mockReturnValue(metaTxClient) } as never,
      { dataPrismaForBase: vi.fn().mockResolvedValue(dataRootClient) } as never,
      { saveRawOps } as never,
      {} as never,
      new PostgresProvider(knex),
      knex
    );
    return {
      service,
      row,
      callbacks,
      events,
      dataTxClient,
      dataRootClient,
      metaTxClient,
      saveRawOps,
      commit: async () => {
        events.push('commit');
        for (const callback of callbacks.splice(0)) await callback();
      },
      rollback: async () => {
        callbacks.splice(0);
        for (const callback of rollbackCallbacks.splice(0)) await callback();
      },
    };
  };

  it('keeps a nested create at 0 until its outer commit and emits an optimistic capability edit', async () => {
    const harness = setup({ nested: true });
    const result = await harness.service.createTable('bseTest', tableRo);
    expect(result.actorStorageVersion).toBe(0);
    expect(harness.row.actorStorageVersion).toBe(0);
    expect(harness.row.provisionState).toBe('pending');
    expect(harness.saveRawOps.mock.calls[0][3][0].data.actorStorageVersion).toBe(0);
    await harness.commit();
    expect(result.actorStorageVersion).toBe(1);
    expect(harness.row.version).toBe(2);
    expect(harness.row.actorStorageVersion).toBe(1);
    expect(harness.saveRawOps).toHaveBeenCalledTimes(2);
    expect(harness.saveRawOps.mock.calls[1][3][0]).toMatchObject({
      version: 1,
      data: [
        { p: ['actorStorageVersion'], od: 0, oi: 1 },
        { p: ['version'], od: 1, oi: 2 },
      ],
    });
  });

  it('never publishes capability on outer rollback', async () => {
    const harness = setup({ nested: true });
    const result = await harness.service.createTable('bseTest', tableRo);
    await harness.rollback();
    expect(result.actorStorageVersion).toBe(0);
    expect(harness.row.actorStorageVersion).toBe(0);
    expect(harness.row.provisionState).toBe('error');
    expect(harness.events).not.toContain('capability');
    expect(harness.saveRawOps).toHaveBeenCalledTimes(1);
  });

  it('keeps authoritative capability 1 when the post-commit notification fails', async () => {
    const harness = setup({ nested: true });
    const result = await harness.service.createTable('bseTest', tableRo);
    harness.saveRawOps.mockImplementationOnce(() => {
      throw new Error('share db unavailable');
    });
    await harness.commit();
    expect(result.actorStorageVersion).toBe(1);
    expect(harness.row.actorStorageVersion).toBe(1);
    expect(harness.row.version).toBe(2);
  });

  it('does not infer capability or drop an existing table after CREATE failure', async () => {
    const harness = setup();
    harness.dataTxClient.$executeRawUnsafe.mockRejectedValueOnce(
      new Error('relation already exists')
    );
    await expect(harness.service.createTable('bseTest', tableRo)).rejects.toThrow(
      'relation already exists'
    );
    expect(harness.row.actorStorageVersion).toBe(0);
    expect(harness.dataTxClient.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(harness.events).not.toContain('capability');
  });

  it('keeps capability 0 after an unacknowledged physical commit', async () => {
    const harness = setup({ commitError: new Error('commit connection lost') });
    await expect(harness.service.createTable('bseTest', tableRo)).rejects.toThrow(
      'commit connection lost'
    );
    expect(harness.row.actorStorageVersion).toBe(0);
    expect(
      harness.dataTxClient.$executeRawUnsafe.mock.calls.every(([query]) => !query.includes('DROP'))
    ).toBe(true);
  });

  it('leaves capability 0 when metadata publication fails after physical commit', async () => {
    const harness = setup();
    harness.metaTxClient.tableMeta.update.mockRejectedValueOnce(new Error('metadata unavailable'));
    await expect(harness.service.createTable('bseTest', tableRo)).rejects.toThrow(
      'metadata unavailable'
    );
    expect(harness.events).toContain('commit');
    expect(harness.row.actorStorageVersion).toBe(0);
    expect(
      harness.dataTxClient.$executeRawUnsafe.mock.calls.every(([query]) => !query.includes('DROP'))
    ).toBe(true);
  });

  it('rejects a transaction adapter without commit and rollback ownership hooks', async () => {
    const harness = setup({ scoped: true });
    await expect(harness.service.createTable('bseTest', tableRo)).rejects.toThrow(
      'transaction commit and rollback hooks'
    );
    expect(harness.row.actorStorageVersion).toBe(0);
    expect(harness.row.provisionState).toBe('error');
  });

  it('does not enable an existing physical table when only metadata is created', async () => {
    const harness = setup();
    const result: ITableVo = await harness.service.createTable('bseTest', tableRo, false);
    expect(result.actorStorageVersion).toBe(0);
    expect(harness.dataRootClient.$tx).not.toHaveBeenCalled();
    expect(harness.metaTxClient.tableMeta.update).not.toHaveBeenCalled();
  });
});
