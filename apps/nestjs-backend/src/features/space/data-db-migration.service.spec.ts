/* eslint-disable sonarjs/no-duplicate-string */
import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { DataDbBaselineService } from './data-db-baseline.service';
import { DataDbMigrationService, type IDataDbMigration } from './data-db-migration.service';
import type { IDataDbPreflightClient } from './data-db-preflight.service';
import { encryptDataDbUrl } from './data-db-url-secret';

class FakeMigrationClient implements IDataDbPreflightClient {
  readonly calls: Array<{ bindings?: unknown[]; sql: string }> = [];
  readonly executedMigrationSql: string[] = [];

  constructor(private readonly applied = new Map<string, string>()) {}

  async raw<T = unknown>(sql: string, bindings?: unknown[]) {
    this.calls.push({ sql, bindings });

    if (sql.includes('SELECT "id", "checksum" FROM "__teable_data_schema_migrations"')) {
      return {
        rows: Array.from(this.applied).map(([id, checksum]) => ({ id, checksum })) as T[],
      };
    }

    if (sql.includes('INSERT INTO "__teable_data_schema_migrations"')) {
      this.applied.set(String(bindings?.[0]), String(bindings?.[1]));
      return { rows: [] as T[] };
    }

    if (sql.includes('"fixture_table"')) {
      this.executedMigrationSql.push(sql);
    }

    return { rows: [] as T[] };
  }

  async destroy() {
    return undefined;
  }
}

const migrations: IDataDbMigration[] = [
  {
    id: '20260421000000_init_data_db_baseline',
    sql: 'CREATE TABLE "fixture_table" ("id" TEXT PRIMARY KEY);',
  },
  {
    id: '20260513000000_add_fixture_column',
    sql: 'ALTER TABLE "fixture_table" ADD COLUMN IF NOT EXISTS "name" TEXT;',
  },
];

const checksumSql = (sql: string) => createHash('sha256').update(sql).digest('hex');

describe('DataDbMigrationService', () => {
  it('creates the internal schema, locks, runs pending migrations, and records them', async () => {
    const client = new FakeMigrationClient();
    const service = new DataDbMigrationService(migrations, () => client);

    await expect(
      service.migrate('postgresql://teable:secret@example.com:5432/data', 'teable_test')
    ).resolves.toEqual(migrations.map((migration) => migration.id));

    expect(client.calls.map((call) => call.sql)).toEqual(
      expect.arrayContaining([
        'SET statement_timeout TO 300000',
        'SET lock_timeout TO 30000',
        'CREATE SCHEMA IF NOT EXISTS "teable_test"',
        'SET search_path TO "teable_test"',
        'SELECT pg_advisory_lock(hashtext(?))',
        'SELECT pg_advisory_unlock(hashtext(?))',
      ])
    );
    expect(client.executedMigrationSql).toEqual(migrations.map((migration) => migration.sql));
    expect(client.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sql: expect.stringContaining('INSERT INTO "__teable_data_schema_migrations"'),
          bindings: [migrations[0].id, expect.any(String)],
        }),
        expect.objectContaining({
          sql: expect.stringContaining('INSERT INTO "__teable_data_schema_migrations"'),
          bindings: [migrations[1].id, expect.any(String)],
        }),
      ])
    );
  });

  it('skips already applied migrations', async () => {
    const client = new FakeMigrationClient(
      new Map([[migrations[0].id, checksumSql(migrations[0].sql)]])
    );
    const service = new DataDbMigrationService(migrations, () => client);

    await expect(
      service.migrate('postgresql://teable:secret@example.com:5432/data', 'teable_test')
    ).resolves.toEqual([migrations[1].id]);

    expect(client.calls).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sql: expect.stringContaining('INSERT INTO "__teable_data_schema_migrations"'),
          bindings: [migrations[0].id, expect.any(String)],
        }),
      ])
    );
  });

  it('marks the connection and bindings ready after a successful ensure', async () => {
    const client = new FakeMigrationClient();
    const prismaService = {
      dataDbConnection: {
        findUnique: vi.fn().mockResolvedValue({ status: 'ready', schemaVersion: null }),
        update: vi.fn().mockResolvedValue({}),
      },
      spaceDataDbBinding: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new DataDbMigrationService(migrations, () => client, prismaService as never);

    await expect(
      service.ensureConnectionMigrated({
        connectionId: 'dcnxxx',
        internalSchema: 'teable_test',
        url: 'postgresql://teable:secret@example.com:5432/data',
      })
    ).resolves.toEqual(migrations.map((migration) => migration.id));

    expect(prismaService.dataDbConnection.update).toHaveBeenCalledWith({
      where: { id: 'dcnxxx' },
      data: { status: 'migrating' },
    });
    expect(prismaService.dataDbConnection.update).toHaveBeenCalledWith({
      where: { id: 'dcnxxx' },
      data: expect.objectContaining({
        status: 'ready',
        schemaVersion: migrations[1].id,
        lastError: null,
      }),
    });
    expect(prismaService.spaceDataDbBinding.updateMany).toHaveBeenLastCalledWith({
      where: { dataDbConnectionId: 'dcnxxx', mode: 'byodb' },
      data: { state: 'ready' },
    });
  });

  it('stores a visible error when ensure fails', async () => {
    const client = new FakeMigrationClient();
    const prismaService = {
      dataDbConnection: {
        findUnique: vi.fn().mockResolvedValue({ status: 'ready', schemaVersion: null }),
        update: vi.fn().mockResolvedValue({}),
      },
      spaceDataDbBinding: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const brokenClient: IDataDbPreflightClient = {
      destroy: () => client.destroy(),
      raw: async <T = unknown>(sql: string, bindings?: unknown[]) => {
        if (sql === 'SELECT broken') {
          throw new Error('ECONNREFUSED');
        }
        return await client.raw<T>(sql, bindings);
      },
    };
    const service = new DataDbMigrationService(
      [{ id: migrations[0].id, sql: 'SELECT broken' }],
      () => brokenClient,
      prismaService as never
    );

    await expect(
      service.ensureConnectionMigrated({
        connectionId: 'dcnxxx',
        internalSchema: 'teable_test',
        url: 'postgresql://teable:secret@example.com:5432/data',
      })
    ).rejects.toThrow('ECONNREFUSED');

    expect(prismaService.dataDbConnection.update).toHaveBeenLastCalledWith({
      where: { id: 'dcnxxx' },
      data: {
        status: 'error',
        lastError: 'ECONNREFUSED',
      },
    });
    expect(prismaService.spaceDataDbBinding.updateMany).toHaveBeenLastCalledWith({
      where: { dataDbConnectionId: 'dcnxxx', mode: 'byodb' },
      data: { state: 'error' },
    });
  });

  it('scans existing connections that need schema upgrades', async () => {
    const dataUrl = 'postgresql://teable:secret@example.com:5432/data';
    const client = new FakeMigrationClient();
    const prismaService = {
      dataDbConnection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'dcnxxx',
            encryptedUrl: encryptDataDbUrl(dataUrl),
            internalSchema: 'teable_test',
          },
        ]),
        findUnique: vi.fn().mockResolvedValue({ status: 'ready', schemaVersion: null }),
        update: vi.fn().mockResolvedValue({}),
      },
      spaceDataDbBinding: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new DataDbMigrationService(migrations, () => client, prismaService as never);

    await service.migrateExistingConnections();

    expect(prismaService.dataDbConnection.findMany).toHaveBeenCalledWith({
      where: {
        status: { not: 'disabled' },
        OR: [
          { schemaVersion: null },
          { schemaVersion: { not: migrations[1].id } },
          { status: { in: ['migrating', 'error'] } },
        ],
      },
      select: {
        id: true,
        encryptedUrl: true,
        internalSchema: true,
      },
    });
    expect(prismaService.dataDbConnection.update).toHaveBeenCalledWith({
      where: { id: 'dcnxxx' },
      data: expect.objectContaining({
        status: 'ready',
        schemaVersion: migrations[1].id,
      }),
    });
  });
});

describe('DataDbBaselineService', () => {
  it('delegates baseline initialization to the migration service', async () => {
    const migrationService = {
      migrate: vi.fn().mockResolvedValue([]),
      getLatestSchemaVersion: vi.fn().mockReturnValue(migrations[1].id),
    };
    const service = new DataDbBaselineService(migrationService as never);

    await expect(
      service.initialize('postgresql://teable:secret@example.com:5432/data', 'teable_test')
    ).resolves.toBe(migrations[1].id);

    expect(migrationService.migrate).toHaveBeenCalledWith(
      'postgresql://teable:secret@example.com:5432/data',
      'teable_test'
    );
  });
});
