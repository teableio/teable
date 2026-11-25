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

    if (sql.includes('SELECT "id", "checksum" FROM')) {
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
  it('provisions the complete reliability ledger through actual data DB migrations', async () => {
    const client = new FakeMigrationClient();
    const service = new DataDbMigrationService(undefined, () => client);
    const applied = await service.migrate(
      'postgresql://teable:secret@example.com:5432/data',
      'teable_test'
    );
    expect(applied).toContain('20260905120000_computed_reliability');
    expect(applied).toContain('20260908120000_domain_event_delivery_lease_timestamptz');
    const executedSql = client.calls.map((call) => call.sql).join('\n');
    for (const table of ['issue', 'scope']) {
      expect(executedSql).toContain(`CREATE TABLE IF NOT EXISTS computed_reliability_${table}`);
    }
    expect(executedSql).toContain(
      'FROM computed_update_dead_letter ON CONFLICT(task_id) DO NOTHING'
    );
  });

  it('provisions Base VCS tables through actual data DB migrations', async () => {
    const client = new FakeMigrationClient();
    const service = new DataDbMigrationService(undefined, () => client);
    const applied = await service.migrate(
      'postgresql://teable:secret@example.com:5432/data',
      'teable_test'
    );
    expect(applied).toContain('20261118100000_add_base_vcs_tables');
    const executedSql = client.calls.map((call) => call.sql).join('\n');
    for (const table of ['base_vcs_head', 'base_vcs_change', 'base_vcs_commit']) {
      expect(executedSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('includes attachment support tables in the default data DB migrations', async () => {
    const client = new FakeMigrationClient();
    const service = new DataDbMigrationService(undefined, () => client);

    await service.migrate('postgresql://teable:secret@example.com:5432/data', 'teable_test');

    const executedSql = client.calls.map((call) => call.sql).join('\n');
    expect(executedSql).toContain('CREATE TABLE IF NOT EXISTS "attachments"');
    expect(executedSql).toContain('CREATE TABLE IF NOT EXISTS "attachments_table"');
    expect(executedSql).toContain(
      'CREATE INDEX IF NOT EXISTS "attachments_table_attachment_id_idx"'
    );
  });

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

  it('requires every bundled receipt and checksum before switching to a target schema', async () => {
    const applied = new Map([[migrations[1].id, checksumSql(migrations[1].sql)]]);
    const client = new FakeMigrationClient(applied);
    const service = new DataDbMigrationService(migrations);
    const validate = () => service.validateSchemaVersion(client, 'target_schema');
    const latest = service.getLatestSchemaVersion();
    await expect(validate()).resolves.toEqual({ latest, exists: false });
    applied.set(migrations[0].id, 'stale-checksum');
    await expect(validate()).resolves.toEqual({ latest, exists: false });
    applied.set(migrations[0].id, checksumSql(migrations[0].sql));
    await expect(validate()).resolves.toEqual({ latest, exists: true });
    expect(client.calls[0].sql).toContain('"target_schema"."__teable_data_schema_migrations"');
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
        schemaVersion: service.getLatestSchemaVersion(),
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

  it.each([
    ['legacy last ID', migrations[1].id],
    ['previous manifest', new DataDbMigrationService(migrations).getLatestSchemaVersion()],
  ])('upgrades a ready connection with a backfilled migration and %s', async (_, schemaVersion) => {
    const dataUrl = 'postgresql://teable:secret@example.com:5432/data';
    const backfill = {
      id: '20260501000000_backfill',
      sql: 'ALTER TABLE "fixture_table" ADD COLUMN "actor_id" TEXT;',
    };
    const client = new FakeMigrationClient(
      new Map(migrations.map(({ id, sql }) => [id, checksumSql(sql)]))
    );
    const prismaService = {
      dataDbConnection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'dcnxxx',
            encryptedUrl: encryptDataDbUrl(dataUrl),
            internalSchema: 'teable_test',
          },
        ]),
        findUnique: vi.fn().mockResolvedValue({ status: 'ready', schemaVersion }),
        update: vi.fn().mockResolvedValue({}),
      },
      spaceDataDbBinding: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new DataDbMigrationService(
      [migrations[0], backfill, migrations[1]],
      () => client,
      prismaService as never
    );

    await service.migrateExistingConnections();
    expect(client.executedMigrationSql).toEqual([backfill.sql]);

    expect(prismaService.dataDbConnection.findMany).toHaveBeenCalledWith({
      where: {
        status: { not: 'disabled' },
        OR: [
          { schemaVersion: null },
          { schemaVersion: { not: service.getLatestSchemaVersion() } },
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
        schemaVersion: service.getLatestSchemaVersion(),
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
