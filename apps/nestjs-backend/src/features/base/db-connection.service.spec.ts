import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DriverClient, HttpErrorCode } from '@teable/core';
import knex from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { GlobalModule } from '../../global/global.module';
import { BaseModule } from './base.module';
import { DbConnectionService } from './db-connection.service';

const baseId = 'bsexxx';
const migrationInProgressMessage = 'Space data database migration is in progress';
const readOnlyRole = `read_only_role_${baseId}`;
const publicDatabaseProxy = 'db-proxy.example.com:15432';
const defaultMaxBaseDBConnections = 10;
const byodbHost = 'byodb.example.com';
const byodbDataUrl = `postgresql://teable:secret@${byodbHost}:5432/byodb_space?schema=internal_byodb`;
const defaultDataUrl = 'postgresql://teable:secret@default.example.com:5432/teable_data';
const sqlBuilder = knex({ client: 'pg' });

const createPrismaServiceMock = () => {
  const txPrisma = {
    base: {
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: baseId }),
      update: vi.fn().mockResolvedValue({ id: baseId }),
    },
  };
  const prismaService = {
    base: {
      findFirst: vi.fn().mockResolvedValue({ id: baseId, schemaPass: 'readonly-pass' }),
    },
    $tx: vi.fn((fn) => fn(txPrisma)),
  };

  return { prismaService, txPrisma };
};

const createDbConnectionService = ({
  prismaService,
  databaseRouter,
  baseConfigOverrides,
}: {
  prismaService: unknown;
  databaseRouter: unknown;
  baseConfigOverrides?: Partial<{
    publicDatabaseProxy?: string;
    defaultMaxBaseDBConnections: number;
  }>;
}) =>
  new DbConnectionService(
    prismaService as never,
    databaseRouter as never,
    {} as never,
    { driver: DriverClient.Pg } as never,
    sqlBuilder as never,
    {
      publicDatabaseProxy,
      defaultMaxBaseDBConnections,
      ...baseConfigOverrides,
    } as never
  );

describe('DbConnectionService', () => {
  let service: DbConnectionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, BaseModule],
    }).compile();

    service = module.get<DbConnectionService>(DbConnectionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.each([
    ['default data DB', defaultDataUrl, 'teable_data', 'db-proxy.example.com', 15432, true],
    ['BYODB scoped data DB', byodbDataUrl, 'byodb_space', byodbHost, 5432, false],
  ])(
    'retrieves an existing %s readonly connection through scoped routing',
    async (_, dataUrl, db, host, port, isMetaFallback) => {
      const { prismaService } = createPrismaServiceMock();
      const dataPrisma = {
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([{ count: 1n }])
          .mockResolvedValueOnce([{ count: 3n }]),
      };
      const databaseRouter = {
        dataPrismaForBase: vi.fn().mockResolvedValue(dataPrisma),
        getDataDatabaseForBase: vi.fn().mockResolvedValue({
          url: dataUrl,
          isMetaFallback,
        }),
      };
      const scopedService = createDbConnectionService({ prismaService, databaseRouter });

      await expect(scopedService.retrieve(baseId)).resolves.toMatchObject({
        dsn: {
          driver: DriverClient.Pg,
          host,
          port,
          db,
          user: readOnlyRole,
          pass: 'readonly-pass',
          params: { schema: baseId },
        },
        connection: {
          max: defaultMaxBaseDBConnections,
          current: 3,
        },
      });

      expect(databaseRouter.dataPrismaForBase).toHaveBeenCalledTimes(2);
      expect(databaseRouter.dataPrismaForBase).toHaveBeenNthCalledWith(1, baseId);
      expect(databaseRouter.dataPrismaForBase).toHaveBeenNthCalledWith(2, baseId);
      expect(databaseRouter.getDataDatabaseForBase).toHaveBeenCalledWith(baseId);
    }
  );

  it('creates a BYODB readonly connection on the scoped data DB', async () => {
    const { prismaService, txPrisma } = createPrismaServiceMock();
    const dataPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    };
    const databaseRouter = {
      getDataDatabaseForBase: vi.fn().mockResolvedValue({
        url: byodbDataUrl,
        isMetaFallback: false,
      }),
      dataPrismaExecutorForBase: vi.fn().mockResolvedValue(dataPrisma),
    };
    const scopedService = createDbConnectionService({ prismaService, databaseRouter });

    const result = await scopedService.create(baseId);

    expect(result).toMatchObject({
      dsn: {
        driver: DriverClient.Pg,
        host: byodbHost,
        port: 5432,
        db: 'byodb_space',
        user: readOnlyRole,
        params: { schema: baseId },
      },
      connection: {
        max: defaultMaxBaseDBConnections,
        current: 0,
      },
    });
    expect(result?.url).toContain(`postgresql://${readOnlyRole}:`);
    expect(result?.url).toContain(`@${byodbHost}:5432/byodb_space?schema=bsexxx`);
    expect(databaseRouter.getDataDatabaseForBase).toHaveBeenCalledWith(baseId);
    expect(databaseRouter.dataPrismaExecutorForBase).toHaveBeenCalledWith(baseId, {
      useTransaction: true,
    });
    expect(txPrisma.base.update).toHaveBeenCalledWith({
      where: { id: baseId },
      data: { schemaPass: expect.any(String) },
    });

    const executedSql = dataPrisma.$executeRawUnsafe.mock.calls.map(([sql]) => sql).join('\n');
    expect(executedSql).toContain(`CREATE ROLE "${readOnlyRole}"`);
    expect(executedSql).toContain(`GRANT USAGE ON SCHEMA "${baseId}" TO "${readOnlyRole}"`);
    expect(executedSql).toContain(
      `GRANT SELECT ON ALL TABLES IN SCHEMA "${baseId}" TO "${readOnlyRole}"`
    );
    expect(executedSql).toContain(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "${baseId}" GRANT SELECT ON TABLES TO "${readOnlyRole}"`
    );
  });

  it('creates a BYODB readonly connection with the direct scoped database host when no global proxy is configured', async () => {
    const { prismaService } = createPrismaServiceMock();
    const databaseRouter = {
      getDataDatabaseForBase: vi.fn().mockResolvedValue({
        url: byodbDataUrl,
        isMetaFallback: false,
      }),
      dataPrismaExecutorForBase: vi.fn().mockResolvedValue({
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      }),
    };
    const scopedService = createDbConnectionService({
      prismaService,
      databaseRouter,
      baseConfigOverrides: { publicDatabaseProxy: undefined },
    });

    await expect(scopedService.create(baseId)).resolves.toMatchObject({
      dsn: {
        host: byodbHost,
        port: 5432,
        db: 'byodb_space',
      },
    });
  });

  it('removes a BYODB readonly connection from the scoped data DB only', async () => {
    const { prismaService, txPrisma } = createPrismaServiceMock();
    const dataPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    };
    const databaseRouter = {
      getDataDatabaseForBase: vi.fn(),
      dataPrismaExecutorForBase: vi.fn().mockResolvedValue(dataPrisma),
    };
    const scopedService = createDbConnectionService({ prismaService, databaseRouter });

    await expect(scopedService.remove(baseId)).resolves.toBeUndefined();

    expect(databaseRouter.dataPrismaExecutorForBase).toHaveBeenCalledWith(baseId, {
      useTransaction: true,
    });
    expect(databaseRouter.getDataDatabaseForBase).not.toHaveBeenCalled();
    expect(txPrisma.base.update).toHaveBeenCalledWith({
      where: { id: baseId },
      data: { schemaPass: null },
    });

    const executedSql = dataPrisma.$executeRawUnsafe.mock.calls.map(([sql]) => sql).join('\n');
    expect(executedSql).toContain(`REVOKE USAGE ON SCHEMA "${baseId}" FROM "${readOnlyRole}"`);
    expect(executedSql).toContain(`DROP ROLE IF EXISTS "${readOnlyRole}"`);
  });

  it('returns an explicit unavailable error when the scoped data DB cannot create readonly roles', async () => {
    const { prismaService } = createPrismaServiceMock();
    const dataPrisma = {
      $executeRawUnsafe: vi.fn().mockRejectedValue(
        Object.assign(new Error('permission denied to create role'), {
          code: '42501',
        })
      ),
    };
    const databaseRouter = {
      getDataDatabaseForBase: vi.fn().mockResolvedValue({
        url: byodbDataUrl,
        isMetaFallback: false,
      }),
      dataPrismaExecutorForBase: vi.fn().mockResolvedValue(dataPrisma),
    };
    const scopedService = createDbConnectionService({ prismaService, databaseRouter });

    await expect(scopedService.create(baseId)).rejects.toMatchObject({
      code: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
      data: {
        action: 'create',
        reason: 'readonly_role_privilege_unavailable',
      },
    });
  });

  it('rejects readonly connection creation while the base space is migrating', async () => {
    const migrationError = new Error(migrationInProgressMessage);
    const prismaService = { $tx: vi.fn() };
    const databaseRouter = {
      getDataDatabaseForBase: vi.fn(),
      dataPrismaExecutorForBase: vi.fn(),
    };
    const migrationGuard = {
      assertBaseWritable: vi.fn().mockRejectedValue(migrationError),
    };
    const guardedService = new DbConnectionService(
      prismaService as never,
      databaseRouter as never,
      {} as never,
      { driver: DriverClient.Pg } as never,
      {} as never,
      {
        publicDatabaseProxy: 'db.example.com:5432',
        defaultMaxBaseDBConnections: 10,
      } as never,
      migrationGuard as never
    );

    await expect(guardedService.create(baseId)).rejects.toThrow(migrationInProgressMessage);

    expect(migrationGuard.assertBaseWritable).toHaveBeenCalledWith(baseId);
    expect(databaseRouter.getDataDatabaseForBase).not.toHaveBeenCalled();
    expect(databaseRouter.dataPrismaExecutorForBase).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
  });

  it('rejects readonly connection removal while the base space is migrating', async () => {
    const migrationError = new Error(migrationInProgressMessage);
    const prismaService = { $tx: vi.fn() };
    const databaseRouter = {
      dataPrismaExecutorForBase: vi.fn(),
    };
    const migrationGuard = {
      assertBaseWritable: vi.fn().mockRejectedValue(migrationError),
    };
    const guardedService = new DbConnectionService(
      prismaService as never,
      databaseRouter as never,
      {} as never,
      { driver: DriverClient.Pg } as never,
      {} as never,
      {
        publicDatabaseProxy: 'db.example.com:5432',
        defaultMaxBaseDBConnections: 10,
      } as never,
      migrationGuard as never
    );

    await expect(guardedService.remove(baseId)).rejects.toThrow(migrationInProgressMessage);

    expect(migrationGuard.assertBaseWritable).toHaveBeenCalledWith(baseId);
    expect(databaseRouter.dataPrismaExecutorForBase).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
  });
});
