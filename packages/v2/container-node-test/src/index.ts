import { createHash } from 'crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, resolve as resolvePath } from 'node:path';
import * as fs from 'node:fs';
import { PapaparseCsvParser } from '@teable/v2-adapter-csv-parser-papaparse';
import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-pg';
import {
  PostgresUnitOfWork,
  registerV2PostgresDb,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-pg';
import { registerV2PostgresPgliteDb } from '@teable/v2-adapter-db-postgres-pglite';
import { ConsoleLogger } from '@teable/v2-adapter-logger-console';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-repository-postgres';
import {
  createTypeValidationStrategy,
  registerV2TableRepositoryPostgresAdapter,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
} from '@teable/v2-adapter-table-repository-postgres';
import { registerCommandExplainModule } from '@teable/v2-command-explain';
import type { IHasher, ITableRepository } from '@teable/v2-core';
import {
  BaseId,
  DefaultTableMapper,
  getRandomString,
  MemoryCommandBus,
  MemoryEventBus,
  MemoryQueryBus,
  MemoryTableRepository,
  NoopRealtimeEngine,
  NoopTracer,
  registerV2CoreServices,
  v2CoreTokens,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import { SpyLogger, type ComputedPlanLogEntry } from './SpyLogger';

/**
 * Node.js crypto-based hasher implementation for tests.
 */
class NodeCryptoHasher implements IHasher {
  sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }
}

const isPgliteConnection = (connectionString?: string): boolean => {
  if (!connectionString) return false;
  return connectionString.startsWith('pglite://') || connectionString === 'memory://';
};

const resolvePgliteDataDir = (connectionString: string): string => {
  if (connectionString === 'memory://') return connectionString;
  if (!connectionString.startsWith('pglite://')) return connectionString;
  const raw = connectionString.slice('pglite://'.length);
  if (!raw || raw === 'memory://') return 'memory://';
  const absolute = raw.startsWith('/') ? raw : resolvePath(process.cwd(), raw);
  const parentDir = dirname(absolute);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  return absolute;
};

export interface IV2NodeTestContainer {
  container: DependencyContainer;
  tableRepository: ITableRepository;
  eventBus: MemoryEventBus;
  baseId: BaseId;
  db: Kysely<V1TeableDatabase>;
  /**
   * Process all pending outbox tasks (for tests that need to wait for async computed updates).
   * Returns the number of tasks processed.
   */
  processOutbox(): Promise<number>;
  dispose(): Promise<void>;

  /**
   * SpyLogger instance that captures all log entries.
   * Use this to inspect logged data in tests.
   */
  spyLogger: SpyLogger;

  /**
   * Get all computed:plan log entries captured by the SpyLogger.
   * These are logged by ComputedFieldUpdater during execution.
   */
  getComputedPlans(): ComputedPlanLogEntry[];

  /**
   * Get the most recent computed:plan log entry.
   * Useful for verifying the last computed update operation.
   */
  getLastComputedPlan(): ComputedPlanLogEntry | undefined;

  /**
   * Clear all captured log entries.
   * Call this before an operation to capture only that operation's logs.
   */
  clearLogs(): void;
}

export interface IV2NodeTestContainerOptions {
  connectionString?: string;
  registerDb?: (
    container: DependencyContainer,
    config: IV2PostgresDbConfig
  ) => Promise<DependencyContainer | void>;
  ensureSchema?: boolean;
  seedBase?: boolean;
  maxFreeRowLimit?: number;
}

export const createV2NodeTestContainer = async (
  options: IV2NodeTestContainerOptions = {}
): Promise<IV2NodeTestContainer> => {
  const c = container.createChildContainer();

  const envConnectionString =
    options.connectionString ??
    process.env.TEABLE_V2_TEST_DATABASE_URL ??
    process.env.PRISMA_DATABASE_URL ??
    process.env.DATABASE_URL;
  const shouldUsePglite = isPgliteConnection(envConnectionString);
  const shouldStartContainer = !envConnectionString;
  let pgContainer: StartedPostgreSqlContainer | undefined;
  let connectionString = envConnectionString;
  const pgImage = process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine';

  if (shouldStartContainer && !shouldUsePglite) {
    pgContainer = await new PostgreSqlContainer(pgImage)
      .withDatabase('teable_v2_test')
      .withUsername('teable')
      .withPassword('teable')
      .start();
    connectionString = pgContainer.getConnectionUri();
  }

  if (!connectionString) {
    throw new Error('createV2NodeTestContainer requires a connection string');
  }

  if (shouldUsePglite) {
    connectionString = resolvePgliteDataDir(connectionString);
  }

  const dbConfig: IV2PostgresDbConfig = { pg: { connectionString } };

  if (options.registerDb) {
    await options.registerDb(c, dbConfig);
  }

  const ensureSchema = options.ensureSchema ?? true;

  if (!c.isRegistered(v2PostgresDbTokens.db)) {
    if (shouldUsePglite) {
      await registerV2PostgresPgliteDb(c, dbConfig);
    } else {
      await registerV2PostgresDb(c, dbConfig);
    }
  }

  const db = c.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);

  const maxFreeRowLimit = resolveMaxFreeRowLimit(options.maxFreeRowLimit);

  await registerV2PostgresStateAdapter(c, {
    db,
    ensureSchema,
    ...(maxFreeRowLimit ? { maxFreeRowLimit } : {}),
  });

  await ensureTypeValidationPolyfillMigrationApplied(db as unknown as Kysely<unknown>);

  // Register SpyLogger BEFORE other services so they get the spy instance
  const spyLogger = new SpyLogger(new ConsoleLogger());
  c.registerInstance(v2CoreTokens.logger, spyLogger);

  // Register table repository postgres adapter (schema + record repositories)
  const typeValidationStrategy = await createTypeValidationStrategy(
    db as unknown as Kysely<unknown>
  );
  registerV2TableRepositoryPostgresAdapter(c, {
    db,
    computedUpdate: {
      hybridConfig: { dispatchMode: 'external' },
      pollingConfig: { enabled: false },
    },
    typeValidationStrategy,
  });

  c.register(v2CoreTokens.unitOfWork, PostgresUnitOfWork, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.tracer, NoopTracer, {
    lifecycle: Lifecycle.Singleton,
  });
  if (!c.isRegistered(v2CoreTokens.realtimeEngine)) {
    c.register(v2CoreTokens.realtimeEngine, NoopRealtimeEngine, {
      lifecycle: Lifecycle.Singleton,
    });
  }
  if (!c.isRegistered(v2CoreTokens.tableMapper)) {
    c.register(v2CoreTokens.tableMapper, DefaultTableMapper, {
      lifecycle: Lifecycle.Singleton,
    });
  }
  if (!c.isRegistered(v2CoreTokens.csvParser)) {
    c.register(v2CoreTokens.csvParser, PapaparseCsvParser, {
      lifecycle: Lifecycle.Singleton,
    });
  }
  if (!c.isRegistered(v2CoreTokens.hasher)) {
    c.register(v2CoreTokens.hasher, NodeCryptoHasher, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  const commandBus = new MemoryCommandBus(c);
  const queryBus = new MemoryQueryBus(c);
  const eventBus = new MemoryEventBus(c);

  c.registerInstance(v2CoreTokens.commandBus, commandBus);
  c.registerInstance(v2CoreTokens.queryBus, queryBus);
  c.registerInstance(v2CoreTokens.eventBus, eventBus);

  // Register core services (uses defaults unless already registered)
  registerV2CoreServices(c, { lifecycle: Lifecycle.Singleton });

  // Register command explain module (used by explain endpoints in tests)
  registerCommandExplainModule(c);

  const baseIdResult = BaseId.generate();
  if (baseIdResult.isErr()) {
    throw new Error(baseIdResult.error.message);
  }
  const baseId = baseIdResult.value;
  const shouldSeedBase = options.seedBase ?? true;
  const shouldSeedSpace = shouldSeedBase;

  // Ensure users table exists in public schema for createdBy/lastModifiedBy formula references
  await db.schema
    .withSchema('public')
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.notNull().primaryKey())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('email', 'varchar(255)')
    .execute();

  // Insert system user for tests
  await db
    .withSchema('public')
    .insertInto('users')
    .values({ id: 'system', name: 'System', email: null })
    .onConflict((oc) => oc.columns(['id']).doNothing())
    .execute();

  if (shouldSeedBase) {
    const spaceId = `spc${getRandomString(16)}`;
    const actorId = 'system';

    if (shouldSeedSpace) {
      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Test Space', created_by: actorId })
        .execute();
    }

    await db
      .insertInto('base')
      .values({
        id: baseId.toString(),
        space_id: spaceId,
        name: 'Test Base',
        order: 1,
        created_by: actorId,
      })
      .execute();
  }

  const tableRepository = c.isRegistered(v2CoreTokens.tableRepository)
    ? c.resolve<ITableRepository>(v2CoreTokens.tableRepository)
    : new MemoryTableRepository();
  if (!c.isRegistered(v2CoreTokens.tableRepository)) {
    c.registerInstance(v2CoreTokens.tableRepository, tableRepository);
  }

  const processOutbox = async (): Promise<number> => {
    const worker = c.resolve<ComputedUpdateWorker>(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    );
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let totalProcessed = 0;
    const maxIterations = 100; // Prevent infinite loops
    const maxIdleRetries = 5;
    const idleDelayMs = 10;
    let iterations = 0;
    let idleRetries = 0;

    // Keep processing until no more tasks are pending
    while (iterations < maxIterations) {
      const result = await worker.runOnce({
        workerId: 'test-worker',
        limit: 100,
      });
      if (result.isErr()) {
        throw new Error(`Outbox processing failed: ${result.error.message}`);
      }
      const processed = result.value;
      totalProcessed += processed;
      iterations += 1;

      if (processed > 0) {
        idleRetries = 0;
        continue;
      }

      if (idleRetries >= maxIdleRetries) break;
      idleRetries += 1;
      await sleep(idleDelayMs);
    }

    return totalProcessed;
  };

  return {
    container: c,
    tableRepository,
    eventBus,
    baseId,
    db,
    processOutbox,
    dispose: async () => {
      try {
        await db.destroy();
      } finally {
        if (pgContainer) {
          await pgContainer.stop();
        }
      }
    },
    // SpyLogger integration for computed update testing
    spyLogger,
    getComputedPlans: () => spyLogger.getComputedPlans(),
    getLastComputedPlan: () => spyLogger.getLastComputedPlan(),
    clearLogs: () => spyLogger.clear(),
  };
};

const resolveMaxFreeRowLimit = (value?: number): number | undefined => {
  if (typeof value === 'number' && value > 0) return value;
  return undefined;
};

const ensureTypeValidationPolyfillMigrationApplied = async (db: Kysely<unknown>): Promise<void> => {
  // Apply the Prisma migration that installs `public.teable_try_cast_valid` for PG < 16.
  // It is safe to run on PG 16+ because the migration is guarded by `pg_input_is_valid` existence.
  const migrationSql = await loadTypeValidationPolyfillMigrationSql();
  await sql.raw(migrationSql).execute(db);
};

let cachedTypeValidationMigrationSql: string | null = null;

const loadTypeValidationPolyfillMigrationSql = async (): Promise<string> => {
  if (cachedTypeValidationMigrationSql) return cachedTypeValidationMigrationSql;

  const relativeMigrationPath =
    'packages/db-main-prisma/prisma/postgres/migrations/20260118010000_add_teable_try_cast_valid/migration.sql';
  let current = process.cwd();
  for (let i = 0; i < 50; i++) {
    const candidate = resolve(current, relativeMigrationPath);
    try {
      cachedTypeValidationMigrationSql = await readFile(candidate, 'utf8');
      return cachedTypeValidationMigrationSql;
    } catch (error) {
      const nodeError = error as { code?: string };
      if (nodeError?.code !== 'ENOENT') {
        throw error;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    `Failed to locate ${relativeMigrationPath} from cwd: ${process.cwd()} ` +
      `(make sure repo is checked out with /packages present)`
  );
};

// Re-export SpyLogger types
export { SpyLogger, type CapturedLogEntry, type ComputedPlanLogEntry } from './SpyLogger';

// Re-export snapshot utilities
export {
  printComputedSteps,
  formatComputedPlanSnapshot,
  buildNameMaps,
  buildMultiTableNameMaps,
  type ComputedStepsSnapshot,
  type ComputedPlanSnapshotOptions,
} from './ComputedPlanSnapshot';
