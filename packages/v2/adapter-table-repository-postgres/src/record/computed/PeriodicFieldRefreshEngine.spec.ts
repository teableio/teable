import {
  BaseId,
  CellValueMultiplicity,
  CellValueType,
  DbTableName,
  FieldId,
  FieldName,
  FormulaExpression,
  Table,
  TableId,
  TableName,
  domainError,
  type Field,
  type IEventBus,
  type IExecutionContext,
  type IHasher,
  type ILogger,
  type ITableRepository,
  type IUnitOfWork,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
  type CompiledQuery,
  type QueryResult,
} from 'kysely';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { ComputedFieldBackfillService } from './ComputedFieldBackfillService';
import { ComputedUpdatePlanner } from './ComputedUpdatePlanner';
import type { FieldDependencyEdge, FieldDependencyGraph, FieldMeta } from './FieldDependencyGraph';
import type { IComputedUpdateOutbox } from './outbox/IComputedUpdateOutbox';
import { PeriodicFieldRefreshEngine } from './PeriodicFieldRefreshEngine';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_0_ID = `tbl${'b'.repeat(16)}`;
const TABLE_1_ID = `tbl${'c'.repeat(16)}`;
const FIELD_0_ID = `fld${'d'.repeat(16)}`;
const FIELD_1_ID = `fld${'e'.repeat(16)}`;

const makeTable = (tableIdStr: string, fieldIdStr: string, dbTable: string) => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(tableIdStr)._unsafeUnwrap();
  const fieldId = FieldId.create(fieldIdStr)._unsafeUnwrap();
  const field = { id: () => fieldId } as unknown as Field;
  const table = {
    id: () => tableId,
    baseId: () => baseId,
    dbTableName: () =>
      ok({
        split: () => ok({ schema: 'public', tableName: dbTable }),
      }),
    getField: (predicate: (f: Field) => boolean) => (predicate(field) ? ok(field) : errNotFound()),
  } as unknown as Table;
  return { tableId, fieldId, table, field };
};

const errNotFound = () => {
  throw domainError.notFound({ message: 'field not found' });
};

const createFakeDb = (rowCount: number): Kysely<V1TeableDatabase> => {
  const connection: DatabaseConnection = {
    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
      if (compiledQuery.sql.includes('pg_class')) {
        return { rows: [{ estimated_row_count: rowCount } as R] };
      }
      return { rows: [{ bounded_count: rowCount } as R] };
    },
    streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next: async () => ({ done: true as const, value: undefined }),
      };
    },
  };
  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
    releaseConnection: async () => {},
    destroy: async () => {},
  };
  return new Kysely<V1TeableDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
};

describe('PeriodicFieldRefreshEngine', () => {
  it('executes sync backfill in dependency order when estimated rows <= threshold and publishes setField trigger only', async () => {
    const t0 = makeTable(TABLE_0_ID, FIELD_0_ID, 'tbl_0');
    const t1 = makeTable(TABLE_1_ID, FIELD_1_ID, 'tbl_1');
    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();

    const executedStages: Array<{ tableId: string; fieldIds: string[] }> = [];
    const backfillService = {
      executeSyncMany: vi.fn(
        async (_ctx, input: { table: Table; fields: ReadonlyArray<Field> }) => {
          executedStages.push({
            tableId: input.table.id().toString(),
            fieldIds: input.fields.map((f) => f.id().toString()),
          });
          return ok({ fields: input.fields });
        }
      ),
    } as unknown as ComputedFieldBackfillService;

    const planner = {
      plan: vi.fn().mockResolvedValue(
        ok({
          steps: [{ tableId: t1.tableId, fieldIds: [t1.fieldId], level: 1 }],
          edges: [],
        })
      ),
    } as unknown as ComputedUpdatePlanner;

    const published: unknown[] = [];
    const eventBus: IEventBus = {
      publish: vi.fn().mockResolvedValue(ok(undefined)),
      publishMany: vi.fn(async (_ctx, events) => {
        published.push(...events);
        return ok(undefined);
      }),
    } as unknown as IEventBus;

    const outbox = {
      enqueueFieldBackfill: vi.fn(),
    } as unknown as IComputedUpdateOutbox;

    const engine = new PeriodicFieldRefreshEngine(
      {
        findOne: vi.fn(async (_ctx, spec: { tableId?: () => TableId }) =>
          ok(spec.tableId?.().toString() === TABLE_1_ID ? t1.table : t0.table)
        ),
      } as unknown as ITableRepository,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger,
      { sha256: (s: string) => s } as IHasher,
      {
        withTransaction: async <T>(
          ctx: IExecutionContext,
          fn: (tx: IExecutionContext) => Promise<T>
        ) => fn({ ...ctx, transaction: { kind: 'unitOfWorkTransaction' } }),
      } as IUnitOfWork,
      eventBus,
      createFakeDb(150),
      planner,
      backfillService,
      outbox
    );

    const result = await engine.refreshField({} as IExecutionContext, {
      baseId,
      tableId: t0.tableId,
      fieldId: t0.fieldId,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      mode: 'sync',
      stageCount: 2,
      estimatedRowCount: 150,
      updatedTableIds: [TABLE_0_ID, TABLE_1_ID],
    });
    expect(executedStages).toEqual([
      { tableId: TABLE_0_ID, fieldIds: [FIELD_0_ID] },
      { tableId: TABLE_1_ID, fieldIds: [FIELD_1_ID] },
    ]);
    expect(outbox.enqueueFieldBackfill).not.toHaveBeenCalled();
    expect(published).toHaveLength(2);
    for (const ev of published as Array<{ name: { toString(): string }; actionKey?: string }>) {
      expect(ev.name.toString()).toBe('TableActionTriggerRequested');
      expect(ev.actionKey).toBe('setField');
    }
  });

  it('enqueues Stage 0 with downstream stageChain when estimated rows exceed threshold', async () => {
    const t0 = makeTable(TABLE_0_ID, FIELD_0_ID, 'tbl_0');
    const t1 = makeTable(TABLE_1_ID, FIELD_1_ID, 'tbl_1');
    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();

    const enqueueFieldBackfill = vi
      .fn()
      .mockResolvedValue(ok({ taskId: 'cuo-async-1', merged: false }));
    const engine = new PeriodicFieldRefreshEngine(
      {
        findOne: vi.fn(async (_ctx, spec: { tableId?: () => TableId }) =>
          ok(spec.tableId?.().toString() === TABLE_1_ID ? t1.table : t0.table)
        ),
      } as unknown as ITableRepository,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger,
      { sha256: (s: string) => s } as IHasher,
      { withTransaction: vi.fn() } as unknown as IUnitOfWork,
      { publish: vi.fn(), publishMany: vi.fn() } as unknown as IEventBus,
      createFakeDb(5000),
      {
        plan: vi.fn().mockResolvedValue(
          ok({
            steps: [{ tableId: t1.tableId, fieldIds: [t1.fieldId], level: 1 }],
            edges: [],
          })
        ),
      } as unknown as ComputedUpdatePlanner,
      { executeSyncMany: vi.fn() } as unknown as ComputedFieldBackfillService,
      { enqueueFieldBackfill } as unknown as IComputedUpdateOutbox
    );

    const result = await engine.refreshField({} as IExecutionContext, {
      baseId,
      tableId: t0.tableId,
      fieldId: t0.fieldId,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      mode: 'async',
      taskId: 'cuo-async-1',
      stageCount: 2,
      estimatedRowCount: 5000,
      updatedTableIds: [TABLE_0_ID, TABLE_1_ID],
    });
    expect(enqueueFieldBackfill).toHaveBeenCalledTimes(1);
    expect(enqueueFieldBackfill.mock.calls[0]![0]).toMatchObject({
      taskType: 'field-backfill',
      baseId: BASE_ID,
      tableId: TABLE_0_ID,
      fieldIds: [FIELD_0_ID],
      stageChain: {
        remainingStages: [{ tableId: TABLE_1_ID, fieldIds: [FIELD_1_ID] }],
        notifyTargets: [],
      },
    });
  });

  it('excludes unrelated context-free formulas when planning with a real ComputedUpdatePlanner', async () => {
    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const table0Id = TableId.create(TABLE_0_ID)._unsafeUnwrap();
    const table1Id = TableId.create(TABLE_1_ID)._unsafeUnwrap();

    const fieldAId = FieldId.create(`fld${'1'.repeat(16)}`)._unsafeUnwrap();
    const fieldADownId = FieldId.create(`fld${'2'.repeat(16)}`)._unsafeUnwrap();
    const fieldBId = FieldId.create(`fld${'3'.repeat(16)}`)._unsafeUnwrap();
    const fieldBDownId = FieldId.create(`fld${'4'.repeat(16)}`)._unsafeUnwrap();
    const fieldCId = FieldId.create(`fld${'5'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'6'.repeat(16)}`)._unsafeUnwrap();

    const t0Builder = Table.builder()
      .withId(table0Id)
      .withBaseId(baseId)
      .withName(TableName.create('Main')._unsafeUnwrap())
      .withDbTableName(DbTableName.rehydrate('public.tbl_main')._unsafeUnwrap());
    t0Builder
      .field()
      .formula()
      .withId(fieldAId)
      .withName(FieldName.create('TodayA')._unsafeUnwrap())
      .withExpression(FormulaExpression.create('TODAY()')._unsafeUnwrap())
      .withResultType({
        cellValueType: CellValueType.dateTime(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      })
      .done();
    t0Builder
      .field()
      .formula()
      .withId(fieldADownId)
      .withName(FieldName.create('TomorrowA')._unsafeUnwrap())
      .withExpression(
        FormulaExpression.create(`DATE_ADD({${fieldAId.toString()}}, 1, "day")`)._unsafeUnwrap()
      )
      .withResultType({
        cellValueType: CellValueType.dateTime(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      })
      .done();
    t0Builder
      .field()
      .formula()
      .withId(fieldBId)
      .withName(FieldName.create('NowB')._unsafeUnwrap())
      .withExpression(FormulaExpression.create('NOW()')._unsafeUnwrap())
      .withResultType({
        cellValueType: CellValueType.dateTime(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      })
      .done();
    t0Builder
      .field()
      .formula()
      .withId(fieldBDownId)
      .withName(FieldName.create('FormattedB')._unsafeUnwrap())
      .withExpression(
        FormulaExpression.create(
          `DATETIME_FORMAT({${fieldBId.toString()}}, "HH:mm")`
        )._unsafeUnwrap()
      )
      .withResultType({
        cellValueType: CellValueType.string(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      })
      .done();
    t0Builder.view().defaultGrid().done();
    const table0 = t0Builder.build()._unsafeUnwrap();

    const t1Builder = Table.builder()
      .withId(table1Id)
      .withBaseId(baseId)
      .withName(TableName.create('Child')._unsafeUnwrap())
      .withDbTableName(DbTableName.rehydrate('public.tbl_child')._unsafeUnwrap());
    t1Builder
      .field()
      .singleLineText()
      .withId(fieldCId)
      .withName(FieldName.create('LookupC')._unsafeUnwrap())
      .primary()
      .done();
    t1Builder.view().defaultGrid().done();
    const table1 = t1Builder.build()._unsafeUnwrap();

    const fieldsById = new Map<string, FieldMeta>([
      [
        fieldAId.toString(),
        {
          id: fieldAId,
          tableId: table0Id,
          type: 'formula',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
      ],
      [
        fieldADownId.toString(),
        {
          id: fieldADownId,
          tableId: table0Id,
          type: 'formula',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
      ],
      [
        fieldBId.toString(),
        {
          id: fieldBId,
          tableId: table0Id,
          type: 'formula',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
      ],
      [
        fieldBDownId.toString(),
        {
          id: fieldBDownId,
          tableId: table0Id,
          type: 'formula',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
      ],
      [
        fieldCId.toString(),
        {
          id: fieldCId,
          tableId: table1Id,
          type: 'lookup',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
      ],
    ]);

    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: fieldAId,
        toFieldId: fieldADownId,
        fromTableId: table0Id,
        toTableId: table0Id,
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: fieldBId,
        toFieldId: fieldBDownId,
        fromTableId: table0Id,
        toTableId: table0Id,
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: fieldADownId,
        toFieldId: fieldCId,
        fromTableId: table0Id,
        toTableId: table1Id,
        linkFieldId,
        kind: 'cross_record',
        semantic: 'lookup_source',
      },
    ];

    const graphStub = {
      hasComputedTargets: vi.fn().mockResolvedValue(ok(true)),
      load: vi.fn().mockResolvedValue(ok({ fieldsById, edges })),
    } as unknown as FieldDependencyGraph;
    const realPlanner = new ComputedUpdatePlanner(graphStub);

    // Control check: default planner behavior includes unrelated context-free formula B
    const defaultPlan = await realPlanner.plan({
      table: table0,
      changedFieldIds: [fieldAId],
      changedRecordIds: [],
      changeType: 'update',
      cyclePolicy: 'skip',
    });
    const defaultPlannedFieldIds = defaultPlan
      ._unsafeUnwrap()
      .steps.flatMap((s) => s.fieldIds.map((id) => id.toString()));
    expect(defaultPlannedFieldIds).toContain(fieldBId.toString());

    const executedStages: Array<{ tableId: string; fieldIds: string[] }> = [];
    const backfillService = {
      executeSyncMany: vi.fn(
        async (_ctx, input: { table: Table; fields: ReadonlyArray<Field> }) => {
          executedStages.push({
            tableId: input.table.id().toString(),
            fieldIds: input.fields.map((f) => f.id().toString()),
          });
          return ok({ fields: input.fields });
        }
      ),
    } as unknown as ComputedFieldBackfillService;

    const engine = new PeriodicFieldRefreshEngine(
      {
        findOne: vi.fn(async (_ctx, spec: { tableId?: () => TableId }) =>
          ok(spec.tableId?.().toString() === TABLE_1_ID ? table1 : table0)
        ),
      } as unknown as ITableRepository,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger,
      { sha256: (s: string) => s } as IHasher,
      {
        withTransaction: async <T>(
          ctx: IExecutionContext,
          fn: (tx: IExecutionContext) => Promise<T>
        ) => fn({ ...ctx, transaction: { kind: 'unitOfWorkTransaction' } }),
      } as IUnitOfWork,
      {
        publish: vi.fn(),
        publishMany: vi.fn().mockResolvedValue(ok(undefined)),
      } as unknown as IEventBus,
      createFakeDb(50),
      realPlanner,
      backfillService,
      { enqueueFieldBackfill: vi.fn() } as unknown as IComputedUpdateOutbox
    );

    const refreshResult = await engine.refreshField({} as IExecutionContext, {
      baseId,
      tableId: table0Id,
      fieldId: fieldAId,
    });

    expect(refreshResult.isOk()).toBe(true);
    expect(executedStages).toEqual([
      { tableId: TABLE_0_ID, fieldIds: [fieldAId.toString()] },
      { tableId: TABLE_0_ID, fieldIds: [fieldADownId.toString()] },
      { tableId: TABLE_1_ID, fieldIds: [fieldCId.toString()] },
    ]);
    const allExecutedFieldIds = executedStages.flatMap((s) => s.fieldIds);
    expect(allExecutedFieldIds).not.toContain(fieldBId.toString());
    expect(allExecutedFieldIds).not.toContain(fieldBDownId.toString());
  });
});
