import {
  ActorId,
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  RecordId,
  Table,
  TableId,
  TableName,
  TableRecord,
  ok,
} from '@teable/v2-core';
import type { IHasher, ILogger, IRecordOrderCalculator } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import type {
  ComputedFieldUpdater,
  ComputedUpdatePlanner,
  IUpdateStrategy,
  IComputedUpdateOutbox,
} from '../computed';
import type { DynamicDB } from '../query-builder';
import { createNoopEventBus } from './__tests__/helpers/createNoopEventBus';
import { PostgresRecordMutationSnapshotCaptureService } from './PostgresRecordMutationSnapshotCaptureService';
import { PostgresTableRecordRepository } from './PostgresTableRecordRepository';

// =============================================================================
// Test utilities
// =============================================================================

type RowProvider = (compiledQuery: CompiledQuery) => unknown[];

type RecordingSessionState = {
  undoBatchId?: string;
};

class RecordingConnection implements DatabaseConnection {
  constructor(
    private readonly rowProvider?: RowProvider,
    private readonly sessionState: RecordingSessionState = {}
  ) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    if (compiledQuery.sql.includes("set_config('teable.undo_batch_id'")) {
      const batchId = compiledQuery.parameters[0];
      this.sessionState.undoBatchId =
        typeof batchId === 'string' && batchId.length > 0 ? batchId : undefined;
      return {
        rows: [{ set_config: this.sessionState.undoBatchId ?? '' }] as R[],
      };
    }

    if (compiledQuery.sql.includes("current_setting('teable.undo_batch_id', true)")) {
      return {
        rows: [{ batch_id: this.sessionState.undoBatchId ?? null }] as R[],
      };
    }

    const rows = (this.rowProvider?.(compiledQuery) ?? []) as R[];
    return { rows };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
}

class RecordingDriver implements Driver {
  private readonly sessionState: RecordingSessionState = {};

  constructor(private readonly rowProvider?: RowProvider) {}

  async init(): Promise<void> {
    return undefined;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new RecordingConnection(this.rowProvider, this.sessionState);
  }

  async beginTransaction(): Promise<void> {
    return undefined;
  }
  async commitTransaction(): Promise<void> {
    return undefined;
  }
  async rollbackTransaction(): Promise<void> {
    return undefined;
  }
  async releaseConnection(): Promise<void> {
    return undefined;
  }
  async destroy(): Promise<void> {
    return undefined;
  }
  async savepoint(): Promise<void> {
    return undefined;
  }
  async rollbackToSavepoint(): Promise<void> {
    return undefined;
  }
  async releaseSavepoint(): Promise<void> {
    return undefined;
  }
}

const createRecordingDb = (rowProvider?: RowProvider) => {
  const defaultUndoLogRowProvider: RowProvider = (compiledQuery) => {
    if (compiledQuery.sql.includes('FROM information_schema.tables')) {
      return [{ exists: true }];
    }
    if (compiledQuery.sql.includes('FROM information_schema.columns')) {
      return [{ exists: true }];
    }
    if (compiledQuery.sql.includes('FROM pg_proc')) {
      return [{ exists: true }];
    }
    if (compiledQuery.sql.includes('FROM pg_trigger AS t')) {
      return [{ exists: true }];
    }
    if (compiledQuery.sql.includes('FROM "__undo_log"')) {
      return [
        {
          record_id: RECORD_ID,
          operation: 'DELETE',
          old_row: {
            __id: RECORD_ID,
          },
          new_row: null,
        },
      ];
    }
    return [];
  };
  const driver = new RecordingDriver(
    rowProvider
      ? (compiledQuery) => {
          const providedRows = rowProvider(compiledQuery);
          return providedRows.length > 0 ? providedRows : defaultUndoLogRowProvider(compiledQuery);
        }
      : defaultUndoLogRowProvider
  );
  const db = new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db };
};

type MockLogger = ILogger & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

const createLogger = (): MockLogger => {
  const logger = {
    child: vi.fn(),
    scope: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as MockLogger;
  logger.child.mockReturnValue(logger);
  logger.scope.mockReturnValue(logger);
  return logger;
};

const createNoopComputedPlanner = (table: Table): ComputedUpdatePlanner => {
  return {
    plan: async () =>
      ok({
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [],
        extraSeedRecords: [],
        steps: [],
        edges: [],
        estimatedComplexity: 0,
        changeType: 'delete',
      }),
    planStage: async () =>
      ok({
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [],
        extraSeedRecords: [],
        steps: [],
        edges: [],
        estimatedComplexity: 0,
        changeType: 'delete',
      }),
    resolveBeforeImageRequirements: async () =>
      ok({
        needsBeforeImage: false,
        requiredFieldIds: [],
      }),
    hasWritableComputedWork: () => true,
  } as unknown as ComputedUpdatePlanner;
};

const createNoopStrategy = (): IUpdateStrategy => {
  return {
    mode: 'sync',
    name: 'noop',
    execute: async () => ok(undefined),
    scheduleDispatch: () => undefined,
  };
};

const createNoopOutbox = (): IComputedUpdateOutbox => {
  return {
    enqueueOrMerge: async () => ok({ taskId: 'test', merged: false }),
    enqueueSeedTask: async () => ok({ taskId: 'test', merged: false }),
    enqueueFieldBackfill: async () => ok({ taskId: 'test', merged: false }),
    claimBatch: async () => ok([]),
    claimById: async () => ok(null),
    renewLease: async () => ok([]),
    markDone: async () => ok(true),
    markFailed: async () => ok(true),
  };
};

const createNoopHasher = (): IHasher => {
  return {
    sha256: () => 'test-hash',
  };
};

const createNoopRecordOrderCalculator = (): IRecordOrderCalculator => {
  return {
    calculateOrders: async () => ok([]),
  };
};

const createRepository = (
  db: Kysely<DynamicDB>,
  table: Table,
  computedUpdatePlanner: ComputedUpdatePlanner = createNoopComputedPlanner(table),
  logger: MockLogger = createLogger()
) => {
  const computedFieldUpdater = {} as ComputedFieldUpdater;
  const computedUpdateStrategy = createNoopStrategy();
  const computedUpdateOutbox = createNoopOutbox();
  const hasher = createNoopHasher();

  return new PostgresTableRecordRepository(
    db as unknown as Kysely<V1TeableDatabase>,
    logger,
    createNoopRecordOrderCalculator(),
    computedUpdatePlanner,
    computedFieldUpdater,
    computedUpdateStrategy,
    computedUpdateOutbox,
    new PostgresRecordMutationSnapshotCaptureService(
      db as unknown as Kysely<V1TeableDatabase>,
      logger
    ),
    createNoopEventBus(),
    hasher
  );
};

const composeRowProviders =
  (...providers: RowProvider[]): RowProvider =>
  (compiledQuery) => {
    for (const provider of providers) {
      const rows = provider(compiledQuery);
      if (rows.length > 0) {
        return rows;
      }
    }
    return [];
  };

const createRecordIdRowProvider = (tableName: string, recordIds: string[]): RowProvider => {
  const target = `from ${tableName}`;
  return (compiledQuery) => {
    if (compiledQuery.sql.includes('select *') && compiledQuery.sql.includes(target)) {
      return recordIds.map((recordId) => ({
        __id: recordId,
        record_id: recordId,
      }));
    }
    if (
      compiledQuery.sql.includes('select "__id" as "record_id"') &&
      compiledQuery.sql.includes(target)
    ) {
      return recordIds.map((recordId) => ({ record_id: recordId }));
    }
    return [];
  };
};

const createUndoLogRowProvider = (
  rows: ReadonlyArray<{
    record_id: string;
    operation?: string;
    old_row: Record<string, unknown>;
    new_row?: Record<string, unknown> | null;
  }>
): RowProvider => {
  return (compiledQuery) => {
    if (compiledQuery.sql.includes('FROM "__undo_log"')) {
      return [...rows];
    }
    return [];
  };
};

const createSnapshotRowProvider = (
  tableName: string,
  rows: ReadonlyArray<Record<string, unknown>>
): RowProvider => {
  const target = `from ${tableName}`;
  return (compiledQuery) => {
    if (compiledQuery.sql.includes(target) && compiledQuery.sql.includes('select "__id"')) {
      return [...rows];
    }
    return [];
  };
};

// Fixed IDs for stable snapshots
const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;

const NAME_FIELD_ID = `fld${'g'.repeat(16)}`;
const RECORD_ID = `rec${'h'.repeat(16)}`;
const ACTOR_ID = 'usr_test';

// =============================================================================
// Tests
// =============================================================================

describe('PostgresTableRecordRepository.deleteMany', () => {
  it('maps required before-image values for delete propagation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('DeleteTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(nameFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();

    const specBuilder = TableRecord.specs('or');
    specBuilder.recordId(recordId);
    const deleteSpec = specBuilder.build()._unsafeUnwrap();

    const capturedPlanInputs: Array<Record<string, unknown>> = [];
    const mockPlan = {
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      steps: [],
      edges: [],
      estimatedComplexity: 0,
      changeType: 'delete' as const,
    };
    const computedUpdatePlanner = {
      plan: async () => ok(mockPlan),
      planStage: async (input: Record<string, unknown>) => {
        capturedPlanInputs.push(input);
        return ok({
          ...mockPlan,
          beforeImageRecords: input.beforeImageRecords as never,
        });
      },
      resolveBeforeImageRequirements: async () =>
        ok({
          needsBeforeImage: true,
          requiredFieldIds: [nameFieldId],
        }),
    } as unknown as ComputedUpdatePlanner;

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const { db } = createRecordingDb(
      createSnapshotRowProvider(tableName, [
        {
          record_id: recordId.toString(),
          [`old_${nameFieldId.toString()}`]: 'Alice',
        },
      ])
    );
    const repo = createRepository(db, table, computedUpdatePlanner);

    const result = await repo.deleteMany({ actorId }, table, deleteSpec);
    expect(result.isOk()).toBe(true);

    expect(capturedPlanInputs[0]?.beforeImageRecords).toEqual([
      {
        recordId,
        fieldValuesByDbName: {
          col_name: 'Alice',
        },
      },
    ]);

    vi.useRealTimers();
  });

  it('returns deleted record snapshots captured from the undo log', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('DeleteTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(nameFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();

    const specBuilder = TableRecord.specs('or');
    specBuilder.recordId(recordId);
    const deleteSpec = specBuilder.build()._unsafeUnwrap();

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const { db } = createRecordingDb(
      composeRowProviders(
        createRecordIdRowProvider(tableName, [recordId.toString()]),
        createUndoLogRowProvider([
          {
            record_id: recordId.toString(),
            old_row: {
              __id: recordId.toString(),
              col_name: 'Alice',
            },
          },
        ])
      )
    );
    const repo = createRepository(db, table);

    const result = await repo.deleteMany({ actorId }, table, deleteSpec);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      deletedRecords: [
        expect.objectContaining({
          recordId: recordId.toString(),
          fields: {
            [NAME_FIELD_ID]: 'Alice',
          },
        }),
      ],
    });

    vi.useRealTimers();
  });

  it('keeps delete successful when undo snapshot capture is incomplete', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const recordIdB = RecordId.create(`rec${'z'.repeat(16)}`)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('DeleteTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(nameFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();

    const specBuilder = TableRecord.specs('or');
    specBuilder.recordId(recordId);
    specBuilder.recordId(recordIdB);
    const deleteSpec = specBuilder.build()._unsafeUnwrap();

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const { db } = createRecordingDb(
      composeRowProviders(
        createRecordIdRowProvider(tableName, [recordId.toString(), recordIdB.toString()]),
        createUndoLogRowProvider([
          {
            record_id: recordId.toString(),
            old_row: {
              __id: recordId.toString(),
              col_name: 'Alice',
            },
          },
        ])
      )
    );
    const repo = createRepository(db, table);

    const result = await repo.deleteMany({ actorId }, table, deleteSpec);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().deletedRecords).toEqual([
      expect.objectContaining({
        recordId: recordId.toString(),
        fields: {
          [NAME_FIELD_ID]: 'Alice',
        },
      }),
    ]);

    vi.useRealTimers();
  });
});
