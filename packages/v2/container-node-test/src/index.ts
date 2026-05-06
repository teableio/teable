import { createHash } from 'crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, resolve as resolvePath } from 'node:path';
import * as fs from 'node:fs';
import { PapaparseCsvParser } from '@teable/v2-adapter-csv-parser-papaparse';
import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-pg';
import {
  PostgresUnitOfWork,
  registerV2PostgresDb,
  v2DataDbTokens,
  v2MetaDbTokens,
} from '@teable/v2-adapter-db-postgres-pg';
import { registerV2PostgresPgliteDb } from '@teable/v2-adapter-db-postgres-pglite';
import { ConsoleLogger } from '@teable/v2-adapter-logger-console';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-repository-postgres';
import {
  createTypeValidationStrategy,
  installUndoCaptureGlobals,
  registerV2TableRepositoryPostgresAdapter,
  startComputedUpdatePollingIfEnabled,
  v2RecordRepositoryPostgresTokens,
  type IV2TableRepositoryPostgresConfig,
  type ComputedUpdateWorker,
} from '@teable/v2-adapter-table-repository-postgres';
import { registerCommandExplainModule } from '@teable/v2-command-explain';
import type { IHasher, ILogger, ITableRepository, LogContext } from '@teable/v2-core';
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
  metaDb: Kysely<V1TeableDatabase>;
  dataDb: Kysely<V1TeableDatabase>;
  db: Kysely<V1TeableDatabase>;
  connectionString: string;
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
  computedUpdate?: IV2TableRepositoryPostgresConfig['computedUpdate'];
  logToConsole?: boolean;
  logLevel?: V2NodeTestContainerLogLevel;
}

export type V2NodeTestContainerLogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const isSetupTimingEnabled = () => process.env.TEABLE_V2_TEST_SETUP_TIMING === '1';

const createSetupTimer = (scope: string) => {
  if (!isSetupTimingEnabled()) {
    return <T>(_: string, run: () => Promise<T>) => run();
  }

  return async <T>(label: string, run: () => Promise<T>) => {
    const startedAt = Date.now();
    try {
      return await run();
    } finally {
      const elapsed = Date.now() - startedAt;
      console.info(`[v2-test-setup] ${scope}:${label} ${elapsed}ms`);
    }
  };
};

const testLogLevelPriority: Record<Exclude<V2NodeTestContainerLogLevel, 'silent'>, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const parseBooleanEnv = (value?: string): boolean | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
};

const resolveTestLogLevel = (value?: string): V2NodeTestContainerLogLevel | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'silent') return 'silent';
  if (normalized === 'error') return 'error';
  if (normalized === 'warn' || normalized === 'warning') return 'warn';
  if (normalized === 'info') return 'info';
  if (normalized === 'debug') return 'debug';
  return undefined;
};

class LevelFilteredLogger implements ILogger {
  constructor(
    private readonly delegate: ILogger,
    private readonly minLevel: Exclude<V2NodeTestContainerLogLevel, 'silent'>
  ) {}

  child(context: LogContext): ILogger {
    return new LevelFilteredLogger(this.delegate.child(context), this.minLevel);
  }

  scope(scope: string, context?: LogContext): ILogger {
    return new LevelFilteredLogger(this.delegate.scope(scope, context), this.minLevel);
  }

  private shouldLog(level: Exclude<V2NodeTestContainerLogLevel, 'silent'>): boolean {
    return testLogLevelPriority[level] <= testLogLevelPriority[this.minLevel];
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      this.delegate.debug(message, context);
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      this.delegate.info(message, context);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      this.delegate.warn(message, context);
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog('error')) {
      this.delegate.error(message, context);
    }
  }
}

const createTestConsoleLogger = (options: IV2NodeTestContainerOptions): ILogger | undefined => {
  const envLogToConsole = parseBooleanEnv(process.env.TEABLE_V2_TEST_LOG_TO_CONSOLE);
  const envLogLevel = resolveTestLogLevel(process.env.TEABLE_V2_TEST_LOG_LEVEL);

  const requestedLogLevel = options.logLevel ?? envLogLevel;
  const shouldLogToConsole =
    options.logToConsole ??
    envLogToConsole ??
    (requestedLogLevel !== undefined && requestedLogLevel !== 'silent');

  if (!shouldLogToConsole) {
    return undefined;
  }

  const minLevel = requestedLogLevel && requestedLogLevel !== 'silent' ? requestedLogLevel : 'info';

  return new LevelFilteredLogger(new ConsoleLogger(), minLevel);
};

export const createV2NodeTestContainer = async (
  options: IV2NodeTestContainerOptions = {}
): Promise<IV2NodeTestContainer> => {
  const c = container.createChildContainer();
  const time = createSetupTimer('container');

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

  if (!c.isRegistered(v2MetaDbTokens.db) || !c.isRegistered(v2DataDbTokens.db)) {
    await time('register-db', async () => {
      if (shouldUsePglite) {
        await registerV2PostgresPgliteDb(c, dbConfig);
      } else {
        await registerV2PostgresDb(c, dbConfig);
      }
    });
  }

  const metaDb = c.resolve<Kysely<V1TeableDatabase>>(v2MetaDbTokens.db);
  const dataDb = c.resolve<Kysely<V1TeableDatabase>>(v2DataDbTokens.db);
  const db = dataDb;

  const maxFreeRowLimit = resolveMaxFreeRowLimit(options.maxFreeRowLimit);

  await time('register-state-adapter', async () =>
    registerV2PostgresStateAdapter(c, {
      db: metaDb,
      ensureSchema,
      ...(maxFreeRowLimit ? { maxFreeRowLimit } : {}),
    })
  );

  await time('type-validation-polyfill', async () =>
    ensureTypeValidationPolyfillMigrationApplied(dataDb as unknown as Kysely<unknown>)
  );

  await time('undo-capture-globals', async () =>
    ensureUndoCaptureMigrationApplied(dataDb as unknown as Kysely<unknown>)
  );

  // Register SpyLogger BEFORE other services so they get the spy instance
  const spyLogger = new SpyLogger(createTestConsoleLogger(options));
  c.registerInstance(v2CoreTokens.logger, spyLogger);

  // Register table repository postgres adapter (schema + record repositories)
  const typeValidationStrategy = await time('create-type-validation-strategy', async () =>
    createTypeValidationStrategy(dataDb as unknown as Kysely<unknown>)
  );
  await time('register-table-repository-adapter', async () => {
    registerV2TableRepositoryPostgresAdapter(c, {
      db: dataDb,
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external' },
        pollingConfig: { enabled: false },
        ...options.computedUpdate,
      },
      typeValidationStrategy,
    });
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
  c.registerInstance(v2CoreTokens.internalCommandBus, commandBus);
  c.registerInstance(v2CoreTokens.queryBus, queryBus);
  c.registerInstance(v2CoreTokens.eventBus, eventBus);

  // Register core services (uses defaults unless already registered)
  await time('register-core-services', async () => {
    registerV2CoreServices(c, { lifecycle: Lifecycle.Singleton });
  });

  // Register command explain module (used by explain endpoints in tests)
  await time('register-command-explain', async () => {
    registerCommandExplainModule(c);
  });

  const computedUpdatePollingService = startComputedUpdatePollingIfEnabled(c);

  const baseIdResult = BaseId.generate();
  if (baseIdResult.isErr()) {
    throw new Error(baseIdResult.error.message);
  }
  const baseId = baseIdResult.value;
  const shouldSeedBase = options.seedBase ?? true;
  const shouldSeedSpace = shouldSeedBase;

  // Ensure users table exists in public schema for createdBy/lastModifiedBy formula references
  await time('ensure-users-table', async () =>
    metaDb.schema
      .withSchema('public')
      .createTable('users')
      .ifNotExists()
      .addColumn('id', 'varchar(255)', (col) => col.notNull().primaryKey())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('email', 'varchar(255)')
      .execute()
  );

  // Insert system user for tests
  await time('seed-system-user', async () =>
    metaDb
      .withSchema('public')
      .insertInto('users')
      .values({ id: 'system', name: 'System', email: null })
      .onConflict((oc) => oc.columns(['id']).doNothing())
      .execute()
  );

  if (shouldSeedBase) {
    const spaceId = `spc${getRandomString(16)}`;
    const actorId = 'system';

    if (shouldSeedSpace) {
      await time('seed-space', async () =>
        metaDb
          .insertInto('space')
          .values({ id: spaceId, name: 'Test Space', created_by: actorId })
          .execute()
      );
    }

    await time('seed-base', async () =>
      metaDb
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Test Base',
          order: 1,
          created_by: actorId,
        })
        .execute()
    );
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
    const getActiveOutboxState = async () => {
      const now = new Date();
      const rows = await dataDb
        .selectFrom('computed_update_outbox')
        .select(['run_id as runId', 'status'])
        .where((eb) =>
          eb.or([
            eb('status', '=', 'processing'),
            eb.and([eb('status', '=', 'pending'), eb('next_run_at', '<=', now)]),
          ])
        )
        .execute();

      let readyCount = 0;
      let processingCount = 0;
      const runIds = new Set<string>();
      for (const row of rows as Array<{ runId: string | null; status: string }>) {
        if (row.runId) {
          runIds.add(row.runId);
        }
        if (row.status === 'processing') {
          processingCount += 1;
        } else {
          readyCount += 1;
        }
      }

      return {
        readyCount,
        processingCount,
        runIds,
      };
    };

    let totalProcessed = 0;
    const maxIterations = 100; // Prevent infinite loops
    let iterations = 0;

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

      const outboxState = await getActiveOutboxState();
      if (processed > 0 || outboxState.readyCount > 0 || outboxState.processingCount > 0) {
        continue;
      }

      return totalProcessed;
    }

    const outboxState = await getActiveOutboxState();
    throw new Error(
      `Outbox processing did not quiesce after ${maxIterations} iterations: ` +
        `processed=${totalProcessed}, ready=${outboxState.readyCount}, processing=${outboxState.processingCount}, ` +
        `runIds=${[...outboxState.runIds].join(',')}`
    );
  };

  return {
    container: c,
    tableRepository,
    eventBus,
    baseId,
    metaDb,
    dataDb,
    db,
    connectionString,
    processOutbox,
    dispose: async () => {
      try {
        await computedUpdatePollingService?.stop();
        const closers = Array.from(new Set([metaDb, dataDb]));
        await Promise.all(closers.map((db) => db.destroy()));
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

const ensureUndoCaptureMigrationApplied = async (db: Kysely<unknown>): Promise<void> => {
  await installUndoCaptureGlobals(db);
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
