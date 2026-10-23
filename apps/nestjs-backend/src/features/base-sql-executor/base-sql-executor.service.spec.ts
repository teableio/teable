/* eslint-disable teable/naming-convention -- assertion literals are OTel span attribute keys, not object identifiers. */
import type { ConfigService } from '@nestjs/config';
import type { Span } from '@opentelemetry/api';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import knex from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import { CustomHttpException } from '../../custom.exception';
import { redactTeablePgQuerySpan } from '../../tracing-db-context';
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
  it.each(['validation', 'role', 'transaction', 'execution'] as const)(
    'redacts generated-query SQL and parameter secrets from %s failures',
    async (stage) => {
      const literal = 'private-sql-literal';
      const parameter = 'private-bound-value';
      const query = `SELECT * FROM "bsexxx"."tblOrders" WHERE "status" = '${literal}' AND "name" = $1`;
      const failure = new Error(`Failed query: ${query}; parameters: ${parameter}`);
      const prismaService = createPrismaService();
      const transactionPrisma = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        $queryRawUnsafe: vi.fn().mockRejectedValue(failure),
      };
      const databaseRouter = {
        getDataDatabaseForBase: vi.fn().mockResolvedValue({ isMetaFallback: false }),
        dataPrismaTransactionForBase: vi.fn(
          async (_baseId: string, fn: (prisma: never) => unknown) => fn(transactionPrisma as never)
        ),
      };
      if (stage === 'validation') prismaService.tableMeta.findMany.mockRejectedValue(failure);
      if (stage === 'role') databaseRouter.getDataDatabaseForBase.mockRejectedValue(failure);
      if (stage === 'transaction')
        databaseRouter.dataPrismaTransactionForBase.mockRejectedValue(failure);
      const service = createService({ prismaService, databaseRouter });

      const error = await service
        .executeQuerySql(baseId, query, { parameters: [parameter], redactErrors: true })
        .catch((error: unknown) => error);

      expect(error).toBeInstanceOf(CustomHttpException);
      if (!(error instanceof CustomHttpException)) throw error;
      expect(error.getStatus()).toBe(400);
      const response = JSON.stringify({
        message: error.message,
        response: error.getResponse(),
        data: error.data,
      });
      expect(response).toContain('PostgreSQL query failed');
      expect(response).not.toContain(query);
      expect(response).not.toContain(literal);
      expect(response).not.toContain(parameter);
    }
  );

  it('executes original bindings while redacting their values from PG spans', async () => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    try {
      const parameter = 'private-bound-value';
      const attributes: Record<string, string> = {};
      const span = mockDeep<Span>();
      span.setAttribute.mockImplementation((key, value) => {
        attributes[key] = String(value);
        return span;
      });
      const transactionPrisma = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        $queryRawUnsafe: vi.fn(async (_query: string, ...bindings: unknown[]) => {
          await Promise.resolve();
          attributes['db.postgresql.values'] = JSON.stringify(bindings);
          redactTeablePgQuerySpan(span);
          return [{ name: 'matched' }];
        }),
      };
      const databaseRouter = {
        getDataDatabaseForBase: vi.fn().mockResolvedValue({ isMetaFallback: false }),
        dataPrismaTransactionForBase: vi.fn(
          async (_baseId: string, fn: (prisma: never) => unknown) => fn(transactionPrisma as never)
        ),
      };
      const service = createService({ prismaService: createPrismaService(), databaseRouter });
      const query = 'SELECT * FROM "bsexxx"."tblOrders" WHERE "name" = $1';

      await expect(
        service.executeQuerySql(baseId, query, { parameters: [parameter] })
      ).resolves.toEqual([{ name: 'matched' }]);

      expect(transactionPrisma.$queryRawUnsafe).toHaveBeenCalledWith(query, parameter);
      expect(attributes['db.postgresql.values']).toBe('[REDACTED]');
      expect(JSON.stringify(attributes)).not.toContain(parameter);
      const unrelatedSpan = mockDeep<Span>();
      redactTeablePgQuerySpan(unrelatedSpan);
      expect(unrelatedSpan.setAttribute).not.toHaveBeenCalled();
    } finally {
      context.disable();
    }
  });

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

  it('records one structural-coverage span per opted-in execution, not per SQL validation', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const previous = trace.getTracerProvider();
    trace.setGlobalTracerProvider(provider);
    try {
      const transactionPrisma = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ count: 1n }]),
      };
      const databaseRouter = {
        getDataDatabaseForBase: vi.fn().mockResolvedValue({ isMetaFallback: false }),
        dataPrismaTransactionForBase: vi.fn(
          async (_baseId: string, fn: (prisma: never) => unknown) => fn(transactionPrisma as never)
        ),
      };
      const service = createService({ prismaService: createPrismaService(), databaseRouter });

      await service.validateQuerySql(baseId, sql);
      await service.executeQuerySql(baseId, sql, { structuredCoverage: true });
      // Direct service callers do not opt in; only the public route counts.
      await service.executeQuerySql(baseId, sql);

      const spans = exporter
        .getFinishedSpans()
        .filter((span) => span.name === 'teable.baseSqlExecutor.executeQuerySql');
      expect(spans).toHaveLength(1);
      expect(spans[0].attributes).toMatchObject({
        'teable.data_query.coverage.version': 2,
        'teable.data_query.coverage.candidate': 'aggregate',
        'teable.data_query.coverage.features': ['aggregate'],
        'teable.data_query.coverage.gaps': [],
        'teable.data_query.coverage.unknown': [],
      });
      expect(String(spans[0].attributes['teable.data_query.coverage.fingerprint'])).toMatch(
        /^[0-9a-f]{16}$/
      );
      expect(JSON.stringify(spans[0].attributes)).not.toContain(tableDbName);
    } finally {
      trace.setGlobalTracerProvider(previous as never);
      await provider.shutdown();
    }
  });
});
