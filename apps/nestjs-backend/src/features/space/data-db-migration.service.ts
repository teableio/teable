import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService, type DataDbConnection } from '@teable/db-main-prisma';
import { quoteDataDbIdentifier, resolveDataDbInternalSchema } from './data-db-internal-schema';
import {
  DATA_DB_PREFLIGHT_CLIENT_FACTORY,
  dataDbKnexClientFactory,
  type IDataDbPreflightClient,
  type IDataDbPreflightClientFactory,
} from './data-db-preflight.service';
import { decryptDataDbUrl } from './data-db-url-secret';

export interface IDataDbMigration {
  id: string;
  sql: string;
}

export const dataDbMigrationsToken = Symbol('DATA_DB_MIGRATIONS');

export const DATA_DB_MIGRATION_TABLE = '__teable_data_schema_migrations';

const migrationsRootCandidates = [
  join(process.cwd(), 'community/packages/db-data-prisma/prisma/migrations'),
  join(process.cwd(), '../../packages/db-data-prisma/prisma/migrations'),
  join(process.cwd(), '../../community/packages/db-data-prisma/prisma/migrations'),
];
const defaultMigrationStatementTimeoutMs = 300_000;
const defaultMigrationLockTimeoutMs = 30_000;

const readPositiveIntEnv = (key: string, fallback: number) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

const getMigrationsRoot = () => {
  const found = migrationsRootCandidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error('Data DB migrations directory not found');
  }
  return found;
};

const readDataDbMigrations = (): IDataDbMigration[] =>
  readdirSync(getMigrationsRoot(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sqlPath = join(getMigrationsRoot(), entry.name, 'migration.sql');
      return existsSync(sqlPath)
        ? {
            id: entry.name,
            sql: readFileSync(sqlPath, 'utf8'),
          }
        : null;
    })
    .filter((migration): migration is IDataDbMigration => Boolean(migration?.sql.trim()))
    .sort((left, right) => left.id.localeCompare(right.id));

const checksumSql = (sql: string) => createHash('sha256').update(sql).digest('hex');

@Injectable()
export class DataDbMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DataDbMigrationService.name);
  private readonly clientFactory: IDataDbPreflightClientFactory;
  private readonly runningConnections = new Map<string, Promise<string[]>>();

  constructor(
    @Optional()
    @Inject(dataDbMigrationsToken)
    private readonly migrations?: IDataDbMigration[],
    @Optional()
    @Inject(DATA_DB_PREFLIGHT_CLIENT_FACTORY)
    clientFactory?: IDataDbPreflightClientFactory,
    @Optional()
    private readonly prismaService?: PrismaService
  ) {
    this.clientFactory = clientFactory ?? dataDbKnexClientFactory;
  }

  async onApplicationBootstrap() {
    if (!this.prismaService) {
      return;
    }

    void this.migrateExistingConnections().catch((error) => {
      this.logger.error(`Failed to scan data database migrations: ${formatMigrationError(error)}`);
    });
  }

  async migrate(url: string, internalSchema?: string) {
    const migrations = this.resolveMigrations();
    if (migrations.length === 0) {
      return [];
    }

    const client = this.clientFactory(url);
    const resolvedInternalSchema = resolveDataDbInternalSchema(internalSchema, url);
    const quotedInternalSchema = quoteDataDbIdentifier(resolvedInternalSchema);
    const lockKey = `teable:data-db-migration:${resolvedInternalSchema}`;

    try {
      await client.raw(
        `SET statement_timeout TO ${readPositiveIntEnv(
          'BYODB_DATA_DB_MIGRATION_STATEMENT_TIMEOUT_MS',
          defaultMigrationStatementTimeoutMs
        )}`
      );
      await client.raw(
        `SET lock_timeout TO ${readPositiveIntEnv(
          'BYODB_DATA_DB_MIGRATION_LOCK_TIMEOUT_MS',
          defaultMigrationLockTimeoutMs
        )}`
      );
      await client.raw(`CREATE SCHEMA IF NOT EXISTS ${quotedInternalSchema}`);
      await client.raw(`SET search_path TO ${quotedInternalSchema}`);
      await client.raw('SELECT pg_advisory_lock(hashtext(?))', [lockKey]);

      try {
        await this.ensureMigrationTable(client);
        const applied = await this.getAppliedMigrations(client);
        const appliedNow: string[] = [];

        for (const migration of migrations) {
          const checksum = checksumSql(migration.sql);
          const appliedChecksum = applied.get(migration.id);
          if (appliedChecksum) {
            if (appliedChecksum !== checksum) {
              throw new Error(`Data DB migration ${migration.id} checksum mismatch`);
            }
            continue;
          }
          await client.raw(migration.sql);
          await this.recordMigration(client, migration, checksum);
          appliedNow.push(migration.id);
        }

        return appliedNow;
      } finally {
        await client
          .raw('SELECT pg_advisory_unlock(hashtext(?))', [lockKey])
          .catch(() => undefined);
      }
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  async ensureConnectionMigrated(input: {
    connectionId: string;
    internalSchema: string;
    url: string;
  }) {
    const existing = this.runningConnections.get(input.connectionId);
    if (existing) {
      return await existing;
    }

    const promise = this.migrateConnection(input).finally(() => {
      this.runningConnections.delete(input.connectionId);
    });
    this.runningConnections.set(input.connectionId, promise);
    return await promise;
  }

  async migrateExistingConnections() {
    if (!this.prismaService) {
      return;
    }

    const latestSchemaVersion = this.getLatestSchemaVersion();
    if (!latestSchemaVersion) {
      return;
    }

    const connections = await this.prismaService.dataDbConnection.findMany({
      where: {
        status: {
          not: 'disabled',
        },
        OR: [
          { schemaVersion: null },
          { schemaVersion: { not: latestSchemaVersion } },
          { status: { in: ['migrating', 'error'] } },
        ],
      },
      select: {
        id: true,
        encryptedUrl: true,
        internalSchema: true,
      },
    });

    for (const connection of connections) {
      await this.ensureConnectionMigrated({
        connectionId: connection.id,
        internalSchema: connection.internalSchema,
        url: decryptDataDbUrl(connection.encryptedUrl),
      }).catch((error) => {
        this.logger.warn(
          `Failed to migrate data database connection ${connection.id}: ${formatMigrationError(error)}`
        );
      });
    }
  }

  private async migrateConnection(input: {
    connectionId: string;
    internalSchema: string;
    url: string;
  }) {
    const latestSchemaVersion = this.getLatestSchemaVersion();
    if (!latestSchemaVersion) {
      return [];
    }

    const current = await this.prismaService?.dataDbConnection.findUnique({
      where: { id: input.connectionId },
      select: { status: true, schemaVersion: true },
    });

    if (current?.status === 'ready' && current.schemaVersion === latestSchemaVersion) {
      return [];
    }

    await this.updateConnectionState(input.connectionId, 'migrating');

    try {
      const applied = await this.migrate(input.url, input.internalSchema);
      await this.prismaService?.dataDbConnection.update({
        where: { id: input.connectionId },
        data: {
          status: 'ready',
          schemaVersion: latestSchemaVersion,
          lastValidatedAt: new Date(),
          lastError: null,
        },
      });
      await this.prismaService?.spaceDataDbBinding.updateMany({
        where: { dataDbConnectionId: input.connectionId, mode: 'byodb' },
        data: { state: 'ready' },
      });
      return applied;
    } catch (error) {
      const message = formatMigrationError(error);
      await this.prismaService?.dataDbConnection.update({
        where: { id: input.connectionId },
        data: {
          status: 'error',
          lastError: message,
        },
      });
      await this.prismaService?.spaceDataDbBinding.updateMany({
        where: { dataDbConnectionId: input.connectionId, mode: 'byodb' },
        data: { state: 'error' },
      });
      throw error;
    }
  }

  private async updateConnectionState(connectionId: DataDbConnection['id'], state: 'migrating') {
    await this.prismaService?.dataDbConnection.update({
      where: { id: connectionId },
      data: { status: state },
    });
    await this.prismaService?.spaceDataDbBinding.updateMany({
      where: { dataDbConnectionId: connectionId, mode: 'byodb' },
      data: { state },
    });
  }

  private resolveMigrations() {
    return this.migrations ?? readDataDbMigrations();
  }

  getLatestSchemaVersion() {
    return this.resolveMigrations().at(-1)?.id ?? null;
  }

  private async ensureMigrationTable(client: IDataDbPreflightClient) {
    await client.raw(`
      CREATE TABLE IF NOT EXISTS "${DATA_DB_MIGRATION_TABLE}" (
        "id" TEXT PRIMARY KEY,
        "checksum" TEXT NOT NULL,
        "applied_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  private async getAppliedMigrations(client: IDataDbPreflightClient) {
    const result = await client.raw<{ id: string; checksum: string }>(
      `SELECT "id", "checksum" FROM "${DATA_DB_MIGRATION_TABLE}" ORDER BY "id"`
    );
    const rows = Array.isArray(result) ? result : result.rows ?? [];
    return new Map(rows.map((row) => [row.id, row.checksum]));
  }

  private async recordMigration(
    client: IDataDbPreflightClient,
    migration: IDataDbMigration,
    checksum: string
  ) {
    await client.raw(
      `
        INSERT INTO "${DATA_DB_MIGRATION_TABLE}" ("id", "checksum")
        VALUES (?, ?)
        ON CONFLICT ("id") DO NOTHING
      `,
      [migration.id, checksum]
    );
  }
}

const formatMigrationError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 2000 ? `${message.slice(0, 1997)}...` : message;
};
