import { ConfigService } from '@nestjs/config';
import knex from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { BaseSqlExecutorService } from './base-sql-executor.service';

const baseId = 'bsexxx';
const tableDbName = 'bsexxx.tblOrders';
const sql = 'SELECT count(*) FROM "bsexxx"."tblOrders"';

const createService = ({
  prismaService,
  databaseRouter,
}: {
  prismaService: unknown;
  databaseRouter: unknown;
}) =>
  new BaseSqlExecutorService(
    prismaService as never,
    databaseRouter as never,
    {
      get: vi.fn().mockReturnValue('postgresql://teable:secret@localhost:5432/teable'),
    } as unknown as ConfigService,
    knex({ client: 'pg' }) as never,
    { searchTimeout: 30_000 } as never
  );

const createPrismaService = () => ({
  tableMeta: {
    findMany: vi.fn().mockResolvedValue([{ dbTableName: tableDbName }]),
  },
});

describe('BaseSqlExecutorService', () => {
  it('executes BYODB sql-query without creating or setting a read-only role', async () => {
    const prismaService = createPrismaService();
    const transactionPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ count: 1n }]),
    };
    const databaseRouter = {
      getDataDatabaseForBase: vi.fn().mockResolvedValue({
        isMetaFallback: false,
        url: 'postgresql://teable:secret@byodb.example.com:5432/teable',
      }),
      dataPrismaExecutorForBase: vi.fn(),
      dataPrismaTransactionForBase: vi.fn(async (_baseId: string, fn: (prisma: never) => unknown) =>
        fn(transactionPrisma as never)
      ),
    };
    const service = createService({ prismaService, databaseRouter });

    await expect(service.executeQuerySql(baseId, sql)).resolves.toEqual([{ count: 1n }]);

    expect(databaseRouter.getDataDatabaseForBase).toHaveBeenCalledWith(baseId);
    expect(databaseRouter.dataPrismaExecutorForBase).not.toHaveBeenCalled();
    expect(transactionPrisma.$executeRawUnsafe).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(transactionPrisma.$executeRawUnsafe.mock.calls).toEqual(
      expect.not.arrayContaining([[expect.stringContaining('SET LOCAL ROLE')]])
    );
  });

  it('keeps using the read-only role for default data storage', async () => {
    const prismaService = createPrismaService();
    const rolePrisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ count: 1n }]),
    };
    const transactionPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ count: 1n }]),
    };
    const databaseRouter = {
      getDataDatabaseForBase: vi.fn().mockResolvedValue({
        isMetaFallback: true,
        url: 'postgresql://teable:secret@default.example.com:5432/teable',
      }),
      dataPrismaExecutorForBase: vi.fn().mockResolvedValue(rolePrisma),
      dataPrismaTransactionForBase: vi.fn(async (_baseId: string, fn: (prisma: never) => unknown) =>
        fn(transactionPrisma as never)
      ),
    };
    const service = createService({ prismaService, databaseRouter });

    await expect(service.executeQuerySql(baseId, sql)).resolves.toEqual([{ count: 1n }]);

    expect(databaseRouter.dataPrismaExecutorForBase).toHaveBeenCalledWith(baseId);
    expect(transactionPrisma.$executeRawUnsafe.mock.calls).toEqual(
      expect.arrayContaining([[expect.stringContaining('SET LOCAL ROLE')]])
    );
  });
});
