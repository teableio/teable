import { createHash } from 'crypto';
import { PapaparseCsvParser } from '@teable/v2-adapter-csv-parser-papaparse';
import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-pg';
import {
  PostgresUnitOfWork,
  registerV2PostgresDb,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-pg';
import { ConsoleLogger } from '@teable/v2-adapter-logger-console';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-repository-postgres';
import {
  registerV2TableRepositoryPostgresAdapter,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
} from '@teable/v2-adapter-table-repository-postgres';
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

import { SpyLogger, type ComputedPlanLogEntry } from './SpyLogger';

/**
 * Node.js crypto-based hasher implementation for tests.
 */
class NodeCryptoHasher implements IHasher {
  sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }
}

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
}

export const createV2NodeTestContainer = async (
  options: IV2NodeTestContainerOptions = {}
): Promise<IV2NodeTestContainer> => {
  const c = container.createChildContainer();

  const shouldStartContainer = !options.connectionString;
  let pgContainer: StartedPostgreSqlContainer | undefined;
  let connectionString = options.connectionString;

  if (shouldStartContainer) {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('teable_v2_test')
      .withUsername('teable')
      .withPassword('teable')
      .start();
    connectionString = pgContainer.getConnectionUri();
  }

  if (!connectionString) {
    throw new Error('createV2NodeTestContainer requires a connection string');
  }

  const dbConfig: IV2PostgresDbConfig = { pg: { connectionString } };

  if (options.registerDb) {
    await options.registerDb(c, dbConfig);
  }

  const ensureSchema = options.ensureSchema ?? true;

  if (!c.isRegistered(v2PostgresDbTokens.db)) {
    await registerV2PostgresDb(c, dbConfig);
  }

  const db = c.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);

  await registerV2PostgresStateAdapter(c, {
    db,
    ensureSchema,
  });

  // Register SpyLogger BEFORE other services so they get the spy instance
  const spyLogger = new SpyLogger(new ConsoleLogger());
  c.registerInstance(v2CoreTokens.logger, spyLogger);

  // Register table repository postgres adapter (schema + record repositories)
  registerV2TableRepositoryPostgresAdapter(c, { db });

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

  const baseIdResult = BaseId.generate();
  if (baseIdResult.isErr()) {
    throw new Error(baseIdResult.error.message);
  }
  const baseId = baseIdResult.value;
  const shouldSeedBase = options.seedBase ?? true;
  const shouldSeedSpace = shouldSeedBase;
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
    let totalProcessed = 0;
    let processed = 0;
    const maxIterations = 100; // Prevent infinite loops
    let iterations = 0;

    // Keep processing until no more tasks are pending
    do {
      const result = await worker.runOnce({
        workerId: 'test-worker',
        limit: 100,
      });
      if (result.isErr()) {
        throw new Error(`Outbox processing failed: ${result.error.message}`);
      }
      processed = result.value;
      totalProcessed += processed;
      iterations += 1;
    } while (processed > 0 && iterations < maxIterations);

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
