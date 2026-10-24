import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  CreateBaseCommand,
  CreateRecordsCommand,
  ImportDotTeaStructureCommand,
  type ImportDotTeaStructureResult,
  ListTablesQuery,
  v2CoreTokens,
  type CreateBaseResult,
  type CreateRecordsResult,
  type IExecutionContext,
  type ListTablesResult,
  type IRealtimeEngine,
} from '@teable/v2-core';
import type { IHeadlessRuntime } from '@teable/v2-headless-runtime';
import { sql, type Kysely } from 'kysely';
import type { Result } from 'neverthrow';

import type { IAppBundleContents, IAppBundleMigration } from './bundle';
import { readAppBundle } from './bundle';
import { AppBundleError, type AppBundleErrorCode } from './errors';
import { splitSqlStatements } from './sql';

export interface IInstallAppBundleOptions {
  readonly actorId: string;
  /** Base name for a first install. Defaults to `manifest.name`. */
  readonly baseName?: string;
}

export interface IInstallAppBundleResult {
  readonly baseId: string;
  readonly appId: string;
  readonly version: string;
  readonly schemaVersion: number;
  readonly tables: Array<{ id: string; name: string }>;
}

interface IInstallRecordRow {
  readonly appId: string;
  readonly baseId: string;
  readonly version: string;
  readonly schemaVersion: number;
  readonly checksum: string;
  readonly installedAt: Date | string;
}

interface IInstallRecordInput {
  readonly appId: string;
  readonly baseId: string;
  readonly version: string;
  readonly schemaVersion: number;
  readonly checksum: string;
}

const unwrapResult = <T>(
  result: Result<T, { message: string }>,
  code: AppBundleErrorCode,
  message: string
): T => {
  if (result.isErr()) {
    throw new AppBundleError(code, `${message}: ${result.error.message}`);
  }
  return result.value;
};

/**
 * Installation delegates structure parsing to the container-registered
 * `IDotTeaParser`. The host composition root owns that registration; install
 * fails before creating a base rather than mutating the runtime container.
 */
const assertDotTeaParserRegistered = (runtime: IHeadlessRuntime<IRealtimeEngine>): void => {
  if (!runtime.container.isRegistered(v2CoreTokens.dotTeaParser)) {
    throw new AppBundleError(
      'install.dot_tea_parser_missing',
      'The runtime container has no v2CoreTokens.dotTeaParser. Register @teable/v2-dottea DotTeaParser in the host composition root before installing an app bundle.'
    );
  }
};

const ensureInstallTable = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table if not exists public.app_bundle_install (
      app_id varchar(255) primary key,
      base_id varchar(255) not null,
      version varchar(128) not null,
      schema_version integer not null,
      checksum varchar(64) not null,
      installed_at timestamptz not null default now()
    )
  `.execute(db);
};

const findInstallRecord = async (
  db: Kysely<unknown>,
  appId: string
): Promise<IInstallRecordRow | undefined> => {
  const result = await sql<IInstallRecordRow>`
    select app_id as "appId",
           base_id as "baseId",
           version,
           schema_version as "schemaVersion",
           checksum,
           installed_at as "installedAt"
    from public.app_bundle_install
    where app_id = ${appId}
  `.execute(db);
  return result.rows[0];
};

const insertInstallRecord = async (
  db: Kysely<unknown>,
  record: IInstallRecordInput
): Promise<void> => {
  await sql`
    insert into public.app_bundle_install (app_id, base_id, version, schema_version, checksum)
    values (${record.appId}, ${record.baseId}, ${record.version}, ${record.schemaVersion}, ${record.checksum})
  `.execute(db);
};

const updateInstallRecord = async (
  db: Kysely<unknown>,
  record: Omit<IInstallRecordInput, 'baseId'>
): Promise<void> => {
  await sql`
    update public.app_bundle_install
    set version = ${record.version},
        schema_version = ${record.schemaVersion},
        checksum = ${record.checksum},
        installed_at = now()
    where app_id = ${record.appId}
  `.execute(db);
};

const applyMigrationStatements = async (
  db: Kysely<unknown>,
  migrations: ReadonlyArray<IAppBundleMigration>,
  fromVersion: number,
  toVersion: number
): Promise<void> => {
  const pending = migrations
    .filter(
      (migration) => migration.schemaVersion > fromVersion && migration.schemaVersion <= toVersion
    )
    .sort((left, right) => left.schemaVersion - right.schemaVersion);

  const covered = new Set(pending.map((migration) => migration.schemaVersion));
  for (let version = fromVersion + 1; version <= toVersion; version += 1) {
    if (!covered.has(version)) {
      throw new AppBundleError(
        'install.migration_missing',
        `Bundle does not contain migrations/${version}.sql required to upgrade from schema version ${fromVersion} to ${toVersion}`
      );
    }
  }

  for (const migration of pending) {
    for (const statement of splitSqlStatements(migration.sql)) {
      await sql.raw(statement).execute(db);
    }
  }
};

const listTables = async (
  runtime: IHeadlessRuntime<IRealtimeEngine>,
  context: IExecutionContext,
  baseId: string
): Promise<Array<{ id: string; name: string }>> => {
  const query = unwrapResult(
    ListTablesQuery.create({ baseId }),
    'install.query_failed',
    'Failed to build ListTablesQuery'
  );
  const listed = unwrapResult(
    await runtime.queryBus.execute<ListTablesQuery, ListTablesResult>(context, query),
    'install.query_failed',
    `Failed to list tables for base ${baseId}`
  );
  return listed.tables.map((table) => ({
    id: table.id().toString(),
    name: table.name().toString(),
  }));
};

const seedTables = async (
  runtime: IHeadlessRuntime<IRealtimeEngine>,
  context: IExecutionContext,
  contents: IAppBundleContents,
  tableIdMap: Record<string, string>,
  fieldIdMap: Record<string, string>
): Promise<void> => {
  for (const table of contents.seed) {
    if (table.records.length === 0) continue;

    const targetTableId = tableIdMap[table.tableId];
    if (!targetTableId) {
      throw new AppBundleError(
        'bundle.seed_table_unknown',
        `Imported structure did not expose a mapping for seed table "${table.tableId}"`
      );
    }

    const records = table.records.map((record) => ({
      fields: Object.fromEntries(
        Object.entries(record.fields).map(([fieldId, value]) => {
          const targetFieldId = fieldIdMap[fieldId];
          if (!targetFieldId) {
            throw new AppBundleError(
              'bundle.seed_field_unknown',
              `Imported structure did not expose a mapping for seed field "${fieldId}" in table "${table.tableId}"`
            );
          }
          return [targetFieldId, value];
        })
      ),
    }));

    const command = unwrapResult(
      CreateRecordsCommand.create({
        tableId: targetTableId,
        records,
        fieldKeyType: 'id',
        typecast: true,
      }),
      'install.command_failed',
      `Failed to build seed records for table "${table.tableId}"`
    );
    unwrapResult(
      await runtime.commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(context, command),
      'install.command_failed',
      `Failed to seed table "${table.tableId}"`
    );
  }
};

/**
 * Installs an application bundle into a headless runtime.
 *
 * - The first install creates a base and imports the DotTea structure.
 * - Same `version` + `schemaVersion` + content is idempotent.
 * - A lower `schemaVersion` is rejected; a higher one applies every authored
 *   `migrations/<schemaVersion>.sql` in order before updating the install row.
 * - Seed rows are written only during the first install, because they are
 *   snapshots rather than incremental changes.
 */
export const installAppBundle = async (
  runtime: IHeadlessRuntime<IRealtimeEngine>,
  bytes: Uint8Array,
  options: IInstallAppBundleOptions
): Promise<IInstallAppBundleResult> => {
  const contents = await readAppBundle(bytes);
  const { manifest } = contents;
  const context: IExecutionContext = {
    actorId: unwrapResult(
      ActorId.create(options.actorId),
      'install.command_failed',
      'Invalid actorId'
    ),
  };

  const db = runtime.container.resolve<Kysely<unknown>>(v2DataDbTokens.db);
  await ensureInstallTable(db);

  const existing = await findInstallRecord(db, manifest.appId);

  if (existing) {
    const installedSchemaVersion = Number(existing.schemaVersion);

    if (manifest.schemaVersion < installedSchemaVersion) {
      throw new AppBundleError(
        'install.schema_downgrade',
        `Bundle schemaVersion ${manifest.schemaVersion} is lower than installed schemaVersion ${installedSchemaVersion} for app "${manifest.appId}"`
      );
    }

    if (manifest.schemaVersion === installedSchemaVersion) {
      if (manifest.version === existing.version && contents.bundleChecksum !== existing.checksum) {
        throw new AppBundleError(
          'install.version_conflict',
          `Bundle version "${manifest.version}" is already installed with different content for app "${manifest.appId}"`
        );
      }
      if (manifest.version !== existing.version || contents.bundleChecksum !== existing.checksum) {
        await updateInstallRecord(db, {
          appId: manifest.appId,
          version: manifest.version,
          schemaVersion: manifest.schemaVersion,
          checksum: contents.bundleChecksum,
        });
      }
      return {
        baseId: existing.baseId,
        appId: manifest.appId,
        version: manifest.version,
        schemaVersion: manifest.schemaVersion,
        tables: await listTables(runtime, context, existing.baseId),
      };
    }

    await db.transaction().execute(async (transaction) => {
      await applyMigrationStatements(
        transaction,
        contents.migrations,
        installedSchemaVersion,
        manifest.schemaVersion
      );
      await updateInstallRecord(transaction, {
        appId: manifest.appId,
        version: manifest.version,
        schemaVersion: manifest.schemaVersion,
        checksum: contents.bundleChecksum,
      });
    });

    return {
      baseId: existing.baseId,
      appId: manifest.appId,
      version: manifest.version,
      schemaVersion: manifest.schemaVersion,
      tables: await listTables(runtime, context, existing.baseId),
    };
  }

  assertDotTeaParserRegistered(runtime);

  const createdBase = unwrapResult(
    await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
      context,
      unwrapResult(
        CreateBaseCommand.create({ name: options.baseName ?? manifest.name }),
        'install.command_failed',
        'Failed to build CreateBaseCommand'
      )
    ),
    'install.command_failed',
    'Failed to create the bundle base'
  );
  const baseId = createdBase.base.id().toString();

  const importCommand = unwrapResult(
    ImportDotTeaStructureCommand.createFromBuffer({ baseId, dotTeaData: bytes }),
    'install.command_failed',
    'Failed to build ImportDotTeaStructureCommand'
  );
  const imported = unwrapResult(
    await runtime.commandBus.execute<ImportDotTeaStructureCommand, ImportDotTeaStructureResult>(
      context,
      importCommand
    ),
    'install.command_failed',
    `Failed to import the bundle structure into base "${baseId}"`
  );

  await seedTables(runtime, context, contents, imported.tableIdMap, imported.fieldIdMap);

  await insertInstallRecord(db, {
    appId: manifest.appId,
    baseId,
    version: manifest.version,
    schemaVersion: manifest.schemaVersion,
    checksum: contents.bundleChecksum,
  });

  return {
    baseId,
    appId: manifest.appId,
    version: manifest.version,
    schemaVersion: manifest.schemaVersion,
    tables: imported.tables.map((table) => ({ id: table.id, name: table.name })),
  };
};
