import type { ConfigService } from '@nestjs/config';
import knex from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { BaseSqlExecutorService } from './base-sql-executor.service';

const baseId = 'bsexxx';
const tableDbName = 'bsexxx.tblOrders';
const sql = 'SELECT count(*) FROM "bsexxx"."tblOrders"';

const createService = ({
  prismaService,
  databaseRouter,
  observationPublisher = { publish: vi.fn() },
  tableQueryOpsEnabled = false,
}: {
  prismaService: unknown;
  databaseRouter: unknown;
  observationPublisher?: unknown;
  tableQueryOpsEnabled?: boolean;
}) => {
  return new BaseSqlExecutorService(
    prismaService as never,
    databaseRouter as never,
    {
      get: vi.fn((key: string) =>
        key === 'V2_TABLE_QUERY_OPS_ENABLED'
          ? tableQueryOpsEnabled
            ? 'true'
            : 'false'
          : 'postgresql://teable:secret@localhost:5432/teable'
      ),
    } as unknown as ConfigService,
    knex({ client: 'pg' }) as never,
    observationPublisher as never
  );
};

const txTimeout = 20_000;

const createPrismaService = () => ({
  defaultTxTimeout: txTimeout,
  tableMeta: {
    findMany: vi.fn().mockResolvedValue([{ dbTableName: tableDbName }]),
  },
  field: { findMany: vi.fn().mockResolvedValue([]) },
});
it('observes custom SQL ordering by system created time without persisting literals', async () => {
  const prismaService = createPrismaService();
  prismaService.tableMeta.findMany.mockResolvedValueOnce([
    { dbTableName: tableDbName, id: 'tblOrders', baseId, base: { spaceId: 'spcNeutral' } },
  ]);
  const transactionPrisma = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ __id: 'recmNeutral' }]),
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
  const observationPublisher = { publish: vi.fn() };
  const service = createService({
    prismaService,
    databaseRouter,
    observationPublisher,
    tableQueryOpsEnabled: true,
  });
  const customerLiteral = 'customer-secret-must-not-persist';
  const customSql =
    `SELECT t."__id" FROM "bsexxx"."tblOrders" AS t ` +
    `WHERE t."status" = '${customerLiteral}' ` +
    'ORDER BY t."__created_time" ASC LIMIT 5000';

  await expect(service.executeQuerySql(baseId, customSql)).resolves.toEqual([
    { __id: 'recmNeutral' },
  ]);

  expect(observationPublisher.publish).toHaveBeenCalledTimes(1);
  const observation = observationPublisher.publish.mock.calls[0][1];
  const snapshot = observation.snapshot();
  expect(snapshot).toMatchObject({
    baseId,
    tableId: 'tblOrders',
    spaceId: 'spcNeutral',
    shape: {
      orderShape: {
        fields: [{ systemColumn: '__created_time', direction: 'asc', source: 'sort' }],
      },
    },
  });
  expect(JSON.stringify(snapshot)).not.toContain(customerLiteral);
});

const readStatementTimeout = (calls: unknown[][]) => {
  const call = calls.find(([query]) =>
    String(query).includes('SET LOCAL statement_timeout')
  ) as string[];
  return Number(call[0].split('=')[1].trim().replace(/'/g, ''));
};

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
    // Postgres must cancel the statement before Prisma abandons the transaction,
    // or the query keeps running on the server with nobody waiting for its result.
    expect(readStatementTimeout(transactionPrisma.$executeRawUnsafe.mock.calls)).toBeLessThan(
      txTimeout
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
