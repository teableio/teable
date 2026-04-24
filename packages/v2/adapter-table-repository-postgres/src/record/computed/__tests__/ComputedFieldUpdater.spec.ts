import {
  ActorId,
  BaseId,
  DbFieldName,
  FormulaExpression,
  FieldId,
  FieldName,
  LinkFieldConfig,
  LookupOptions,
  RecordId,
  createFormulaField,
  createNumberField,
  RollupExpression,
  RollupFieldConfig,
  Table,
  TableId,
  TableName,
  domainError,
  ok,
} from '@teable/v2-core';
import type { IExecutionContext, ILogger, ITableRepository } from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { IPgTypeValidationStrategy } from '@teable/v2-formula-sql-pg';
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
import { err } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { DynamicDB } from '../../query-builder';
import { ComputedFieldUpdater } from '../ComputedFieldUpdater';
import { COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE } from '../ComputedUpdateLock';
import type { ComputedUpdatePlan } from '../ComputedUpdatePlanner';

// =============================================================================
// Test utilities
// =============================================================================

class RecordingConnection implements DatabaseConnection {
  constructor(private readonly queries: CompiledQuery[]) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(compiledQuery);
    return { rows: [], numAffectedRows: BigInt(0) };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
}

class RecordingDriver implements Driver {
  readonly queries: CompiledQuery[] = [];

  async init(): Promise<void> {
    return undefined;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new RecordingConnection(this.queries);
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

const createRecordingDb = () => {
  const driver = new RecordingDriver();
  const db = new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, driver };
};

const createLogger = (): ILogger => {
  const logger: ILogger = {
    child: () => logger,
    scope: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
};

type RecordedSpan = {
  name: string;
  attributes: Record<string, string | number>;
  setAttribute: (key: string, value: string | number) => void;
  setAttributes: (attrs: Record<string, string | number>) => void;
  end: () => void;
};

const createTracerRecorder = () => {
  const spans: RecordedSpan[] = [];
  const tracer = {
    startSpan: (name: string, attrs?: Record<string, string | number>) => {
      const span: RecordedSpan = {
        name,
        attributes: { ...(attrs ?? {}) },
        setAttribute: (key, value) => {
          span.attributes[key] = value;
        },
        setAttributes: (nextAttrs) => {
          Object.assign(span.attributes, nextAttrs);
        },
        end: () => undefined,
      };
      spans.push(span);
      return span;
    },
    withSpan: async <T>(_span: RecordedSpan, work: () => Promise<T>) => await work(),
  };

  return { tracer, spans };
};

const createTypeValidationStrategy = (): IPgTypeValidationStrategy =>
  new Pg16TypeValidationStrategy();

const createTableRepository = (tables: ReadonlyArray<Table>): ITableRepository => ({
  insert: async () =>
    err(domainError.notImplemented({ message: 'ITableRepository.insert not used in tests' })),
  insertMany: async () =>
    err(domainError.notImplemented({ message: 'ITableRepository.insertMany not used in tests' })),
  findOne: async () =>
    err(domainError.notImplemented({ message: 'ITableRepository.findOne not used in tests' })),
  find: async () => ok(tables),
  updateOne: async () =>
    err(domainError.notImplemented({ message: 'ITableRepository.updateOne not used in tests' })),
  delete: async () =>
    err(domainError.notImplemented({ message: 'ITableRepository.delete not used in tests' })),
});

const toSnapshot = (queries: ReadonlyArray<CompiledQuery>) =>
  queries.map((query) => ({ sql: query.sql, parameters: query.parameters }));

// Fixed IDs for stable snapshots
const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FOREIGN_TABLE_ID = `tbl${'c'.repeat(16)}`;
const LOOKUP_FIELD_ID = `fld${'d'.repeat(16)}`;
const LINK_FIELD_ID = `fld${'e'.repeat(16)}`;
const SYMMETRIC_FIELD_ID = `fld${'f'.repeat(16)}`;
const NAME_FIELD_ID = `fld${'g'.repeat(16)}`;
const RECORD_ID = `rec${'h'.repeat(16)}`;
const ACTOR_ID = 'usr_test';
const CASCADE_SOURCE_TABLE_ID = `tbl${'k'.repeat(16)}`;
const CASCADE_MIDDLE_TABLE_ID = `tbl${'l'.repeat(16)}`;
const CASCADE_TARGET_TABLE_ID = `tbl${'m'.repeat(16)}`;
const CASCADE_SOURCE_NAME_FIELD_ID = `fld${'n'.repeat(16)}`;
const CASCADE_SOURCE_SCORE_FIELD_ID = `fld${'o'.repeat(16)}`;
const CASCADE_MIDDLE_LINK_FIELD_ID = `fld${'p'.repeat(16)}`;
const CASCADE_MIDDLE_LOOKUP_FIELD_ID = `fld${'q'.repeat(16)}`;
const CASCADE_MIDDLE_ROLLUP_FIELD_ID = `fld${'r'.repeat(16)}`;
const CASCADE_MIDDLE_PRIMARY_FIELD_ID = `fld${'s'.repeat(16)}`;
const CASCADE_TARGET_LINK_FIELD_ID = `fld${'t'.repeat(16)}`;
const CASCADE_TARGET_LOOKUP_FIELD_ID = `fld${'u'.repeat(16)}`;
const CASCADE_TARGET_PRIMARY_FIELD_ID = `fld${'v'.repeat(16)}`;
const CASCADE_MIDDLE_SYMMETRIC_FIELD_ID = `fld${'w'.repeat(16)}`;
const CASCADE_TARGET_SYMMETRIC_FIELD_ID = `fld${'x'.repeat(16)}`;
const CASCADE_RECORD_ID = `rec${'y'.repeat(16)}`;
const SAME_TABLE_FORMULA_TABLE_ID = `tbl${'z'.repeat(16)}`;
const SAME_TABLE_VALUE_FIELD_ID = `fld${'i'.repeat(16)}`;
const SAME_TABLE_PLUS_ONE_FIELD_ID = `fld${'j'.repeat(16)}`;
const SAME_TABLE_DOUBLE_FIELD_ID = `fld${'k'.repeat(16)}`;
const CONDITIONAL_SOURCE_TABLE_ID = `tbl${'0'.repeat(16)}`;
const CONDITIONAL_TARGET_TABLE_ID = `tbl${'9'.repeat(16)}`;
const CONDITIONAL_NAME_FIELD_ID = `fld${'8'.repeat(16)}`;
const CONDITIONAL_STATUS_FIELD_ID = `fld${'7'.repeat(16)}`;
const CONDITIONAL_TARGET_FIELD_ID = `fld${'6'.repeat(16)}`;
const CONDITIONAL_RECORD_ID = `rec${'5'.repeat(16)}`;

const createLinkTables = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
  const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
  const lookupFieldId = FieldId.create(LOOKUP_FIELD_ID)._unsafeUnwrap();
  const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
  const symmetricFieldId = FieldId.create(SYMMETRIC_FIELD_ID)._unsafeUnwrap();
  const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();

  const foreignBuilder = Table.builder()
    .withId(foreignTableId)
    .withBaseId(baseId)
    .withName(TableName.create('ForeignTable')._unsafeUnwrap());
  foreignBuilder
    .field()
    .singleLineText()
    .withId(lookupFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  foreignBuilder.view().defaultGrid().done();

  const foreignTable = foreignBuilder.build()._unsafeUnwrap();
  foreignTable
    .getField((field) => field.id().equals(lookupFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
    ._unsafeUnwrap();

  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyMany',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
    symmetricFieldId: symmetricFieldId.toString(),
  })._unsafeUnwrap();

  const hostBuilder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('HostTable')._unsafeUnwrap());
  hostBuilder
    .field()
    .singleLineText()
    .withId(nameFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  hostBuilder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Links')._unsafeUnwrap())
    .withConfig(linkConfig)
    .done();
  hostBuilder.view().defaultGrid().done();

  const hostTable = hostBuilder.build()._unsafeUnwrap();
  hostTable
    .getField((field) => field.id().equals(linkFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
    ._unsafeUnwrap();

  return {
    baseId,
    foreignTable,
    hostTable,
    lookupFieldId,
    linkFieldId,
  };
};

const createLookupRollupCascadeTables = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const sourceTableId = TableId.create(CASCADE_SOURCE_TABLE_ID)._unsafeUnwrap();
  const middleTableId = TableId.create(CASCADE_MIDDLE_TABLE_ID)._unsafeUnwrap();
  const targetTableId = TableId.create(CASCADE_TARGET_TABLE_ID)._unsafeUnwrap();
  const sourceNameFieldId = FieldId.create(CASCADE_SOURCE_NAME_FIELD_ID)._unsafeUnwrap();
  const sourceScoreFieldId = FieldId.create(CASCADE_SOURCE_SCORE_FIELD_ID)._unsafeUnwrap();
  const middleLinkFieldId = FieldId.create(CASCADE_MIDDLE_LINK_FIELD_ID)._unsafeUnwrap();
  const middleLookupFieldId = FieldId.create(CASCADE_MIDDLE_LOOKUP_FIELD_ID)._unsafeUnwrap();
  const middleRollupFieldId = FieldId.create(CASCADE_MIDDLE_ROLLUP_FIELD_ID)._unsafeUnwrap();
  const middlePrimaryFieldId = FieldId.create(CASCADE_MIDDLE_PRIMARY_FIELD_ID)._unsafeUnwrap();
  const targetLinkFieldId = FieldId.create(CASCADE_TARGET_LINK_FIELD_ID)._unsafeUnwrap();
  const targetLookupFieldId = FieldId.create(CASCADE_TARGET_LOOKUP_FIELD_ID)._unsafeUnwrap();
  const targetPrimaryFieldId = FieldId.create(CASCADE_TARGET_PRIMARY_FIELD_ID)._unsafeUnwrap();
  const middleSymmetricFieldId = FieldId.create(CASCADE_MIDDLE_SYMMETRIC_FIELD_ID)._unsafeUnwrap();
  const targetSymmetricFieldId = FieldId.create(CASCADE_TARGET_SYMMETRIC_FIELD_ID)._unsafeUnwrap();

  const sourceBuilder = Table.builder()
    .withId(sourceTableId)
    .withBaseId(baseId)
    .withName(TableName.create('SourceTable')._unsafeUnwrap());
  sourceBuilder
    .field()
    .singleLineText()
    .withId(sourceNameFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  sourceBuilder
    .field()
    .number()
    .withId(sourceScoreFieldId)
    .withName(FieldName.create('Score')._unsafeUnwrap())
    .done();
  sourceBuilder.view().defaultGrid().done();

  const sourceTable = sourceBuilder.build()._unsafeUnwrap();
  sourceTable
    .getField((field) => field.id().equals(sourceNameFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_source_name')._unsafeUnwrap())
    ._unsafeUnwrap();
  sourceTable
    .getField((field) => field.id().equals(sourceScoreFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_source_score')._unsafeUnwrap())
    ._unsafeUnwrap();

  const middleLinkConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: sourceTableId.toString(),
    lookupFieldId: sourceNameFieldId.toString(),
    symmetricFieldId: middleSymmetricFieldId.toString(),
  })._unsafeUnwrap();

  const middleLookupOptions = LookupOptions.create({
    linkFieldId: middleLinkFieldId.toString(),
    lookupFieldId: sourceNameFieldId.toString(),
    foreignTableId: sourceTableId.toString(),
  })._unsafeUnwrap();

  const middleRollupConfig = RollupFieldConfig.create({
    linkFieldId: middleLinkFieldId.toString(),
    foreignTableId: sourceTableId.toString(),
    lookupFieldId: sourceScoreFieldId.toString(),
  })._unsafeUnwrap();

  const middleRollupExpression = RollupExpression.create('sum({values})')._unsafeUnwrap();

  const middleBuilder = Table.builder()
    .withId(middleTableId)
    .withBaseId(baseId)
    .withName(TableName.create('MiddleTable')._unsafeUnwrap());
  middleBuilder
    .field()
    .singleLineText()
    .withId(middlePrimaryFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  middleBuilder
    .field()
    .link()
    .withId(middleLinkFieldId)
    .withName(FieldName.create('SourceLink')._unsafeUnwrap())
    .withConfig(middleLinkConfig)
    .done();
  middleBuilder
    .field()
    .lookup()
    .withId(middleLookupFieldId)
    .withName(FieldName.create('SourceNames')._unsafeUnwrap())
    .withLookupOptions(middleLookupOptions)
    .withInnerField(
      sourceTable.getField((field) => field.id().equals(sourceNameFieldId))._unsafeUnwrap()
    )
    .done();
  middleBuilder
    .field()
    .rollup()
    .withId(middleRollupFieldId)
    .withName(FieldName.create('SourceScoreSum')._unsafeUnwrap())
    .withConfig(middleRollupConfig)
    .withExpression(middleRollupExpression)
    .withValuesField(
      sourceTable.getField((field) => field.id().equals(sourceScoreFieldId))._unsafeUnwrap()
    )
    .done();
  middleBuilder.view().defaultGrid().done();

  const middleTable = middleBuilder.build()._unsafeUnwrap();
  middleTable
    .getField((field) => field.id().equals(middleLookupFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_lookup_b')._unsafeUnwrap())
    ._unsafeUnwrap();
  middleTable
    .getField((field) => field.id().equals(middleRollupFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_rollup_b')._unsafeUnwrap())
    ._unsafeUnwrap();

  const targetLinkConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: middleTableId.toString(),
    lookupFieldId: middlePrimaryFieldId.toString(),
    symmetricFieldId: targetSymmetricFieldId.toString(),
  })._unsafeUnwrap();

  const targetLookupOptions = LookupOptions.create({
    linkFieldId: targetLinkFieldId.toString(),
    lookupFieldId: middleRollupFieldId.toString(),
    foreignTableId: middleTableId.toString(),
  })._unsafeUnwrap();

  const targetBuilder = Table.builder()
    .withId(targetTableId)
    .withBaseId(baseId)
    .withName(TableName.create('TargetTable')._unsafeUnwrap());
  targetBuilder
    .field()
    .singleLineText()
    .withId(targetPrimaryFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  targetBuilder
    .field()
    .link()
    .withId(targetLinkFieldId)
    .withName(FieldName.create('MiddleLink')._unsafeUnwrap())
    .withConfig(targetLinkConfig)
    .done();
  targetBuilder
    .field()
    .lookup()
    .withId(targetLookupFieldId)
    .withName(FieldName.create('RolledUpScores')._unsafeUnwrap())
    .withLookupOptions(targetLookupOptions)
    .withInnerField(
      middleTable.getField((field) => field.id().equals(middleRollupFieldId))._unsafeUnwrap()
    )
    .done();
  targetBuilder.view().defaultGrid().done();

  const targetTable = targetBuilder.build()._unsafeUnwrap();
  targetTable
    .getField((field) => field.id().equals(targetLookupFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_lookup_c')._unsafeUnwrap())
    ._unsafeUnwrap();

  return {
    baseId,
    sourceTable,
    middleTable,
    targetTable,
    sourceNameFieldId,
    sourceScoreFieldId,
    middleLinkFieldId,
    middleLookupFieldId,
    middleRollupFieldId,
    targetLinkFieldId,
    targetLookupFieldId,
  };
};

const createSameTableFormulaChainTable = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(SAME_TABLE_FORMULA_TABLE_ID)._unsafeUnwrap();
  const valueFieldId = FieldId.create(SAME_TABLE_VALUE_FIELD_ID)._unsafeUnwrap();
  const plusOneFieldId = FieldId.create(SAME_TABLE_PLUS_ONE_FIELD_ID)._unsafeUnwrap();
  const doubleFieldId = FieldId.create(SAME_TABLE_DOUBLE_FIELD_ID)._unsafeUnwrap();

  const valueFieldResult = createNumberField({
    id: valueFieldId,
    name: FieldName.create('Value')._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('col_value').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const plusOneFieldResult = createFormulaField({
    id: plusOneFieldId,
    name: FieldName.create('PlusOne')._unsafeUnwrap(),
    expression: FormulaExpression.create(`{${valueFieldId.toString()}} + 1`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('col_plus_one').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const doubleFieldResult = createFormulaField({
    id: doubleFieldId,
    name: FieldName.create('PlusOneDouble')._unsafeUnwrap(),
    expression: FormulaExpression.create(`{${plusOneFieldId.toString()}} * 2`)._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('col_plus_one_double').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const table = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('SameTableFormula')._unsafeUnwrap())
    .addFieldFromResult(valueFieldResult)
    .addFieldFromResult(plusOneFieldResult)
    .addFieldFromResult(doubleFieldResult)
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();

  return {
    baseId,
    table,
    plusOneFieldId,
    doubleFieldId,
  };
};

const createConditionalPropagationTables = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const sourceTableId = TableId.create(CONDITIONAL_SOURCE_TABLE_ID)._unsafeUnwrap();
  const targetTableId = TableId.create(CONDITIONAL_TARGET_TABLE_ID)._unsafeUnwrap();
  const nameFieldId = FieldId.create(CONDITIONAL_NAME_FIELD_ID)._unsafeUnwrap();
  const statusFieldId = FieldId.create(CONDITIONAL_STATUS_FIELD_ID)._unsafeUnwrap();
  const targetFieldId = FieldId.create(CONDITIONAL_TARGET_FIELD_ID)._unsafeUnwrap();

  const sourceBuilder = Table.builder()
    .withId(sourceTableId)
    .withBaseId(baseId)
    .withName(TableName.create('ConditionalSource')._unsafeUnwrap());
  sourceBuilder
    .field()
    .singleLineText()
    .withId(nameFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  sourceBuilder
    .field()
    .singleLineText()
    .withId(statusFieldId)
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .done();
  sourceBuilder.view().defaultGrid().done();

  const sourceTable = sourceBuilder.build()._unsafeUnwrap();
  sourceTable
    .getField((field) => field.id().equals(nameFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_source_name')._unsafeUnwrap())
    ._unsafeUnwrap();
  sourceTable
    .getField((field) => field.id().equals(statusFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())
    ._unsafeUnwrap();

  const targetBuilder = Table.builder()
    .withId(targetTableId)
    .withBaseId(baseId)
    .withName(TableName.create('ConditionalTarget')._unsafeUnwrap());
  targetBuilder
    .field()
    .singleLineText()
    .withId(targetFieldId)
    .withName(FieldName.create('FilteredValue')._unsafeUnwrap())
    .primary()
    .done();
  targetBuilder.view().defaultGrid().done();

  const targetTable = targetBuilder.build()._unsafeUnwrap();
  targetTable
    .getField((field) => field.id().equals(targetFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_filtered_value')._unsafeUnwrap())
    ._unsafeUnwrap();

  return { baseId, sourceTable, targetTable, statusFieldId, targetFieldId };
};

const createSequentialRecordIds = (count: number): RecordId[] =>
  Array.from({ length: count }, (_, index) =>
    RecordId.create(`rec${index.toString().padStart(16, '0')}`)._unsafeUnwrap()
  );

// =============================================================================
// Tests
// =============================================================================

describe('ComputedFieldUpdater', () => {
  it('uses try advisory locks when the caller requests non-blocking lock acquisition', async () => {
    const { baseId, table, plusOneFieldId } = createSameTableFormulaChainTable();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();
    const seedRecordIds = createSequentialRecordIds(51);

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: table.id(),
      seedRecordIds,
      extraSeedRecords: [],
      steps: [
        {
          tableId: table.id(),
          fieldIds: [plusOneFieldId],
          level: 0,
        },
      ],
      edges: [],
      estimatedComplexity: 1,
      changeType: 'update',
      sameTableBatches: [],
    };

    const { db, driver } = createRecordingDb();
    const updater = new ComputedFieldUpdater(
      createTableRepository([table]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy()
    );

    const result = await updater.acquireLocks(plan, { actorId }, { wait: false });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE);
    expect(driver.queries[0]?.sql).toContain('pg_try_advisory_xact_lock');
    expect(driver.queries[0]?.sql).not.toContain('pg_advisory_xact_lock');
  });

  it('generates SQL for link computed updates with dirty propagation', async () => {
    const { baseId, foreignTable, hostTable, lookupFieldId, linkFieldId } = createLinkTables();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: foreignTable.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      steps: [
        {
          tableId: hostTable.id(),
          fieldIds: [linkFieldId],
          level: 0,
        },
      ],
      edges: [
        {
          fromFieldId: lookupFieldId,
          toFieldId: linkFieldId,
          fromTableId: foreignTable.id(),
          toTableId: hostTable.id(),
          linkFieldId,
          order: 0,
        },
      ],
      estimatedComplexity: 1,
      changeType: 'update',
      sameTableBatches: [],
    };

    const { db, driver } = createRecordingDb();
    const tableRepository = createTableRepository([hostTable, foreignTable]);
    const logger = createLogger();
    const typeValidationStrategy = createTypeValidationStrategy();
    const updater = new ComputedFieldUpdater(
      tableRepository,
      logger,
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      typeValidationStrategy
    );

    const context: IExecutionContext = { actorId };
    const result = await updater.execute(plan, context);
    expect(result.isOk()).toBe(true);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [],
          "sql": "drop table if exists "tmp_computed_dirty"",
        },
        {
          "parameters": [],
          "sql": "create temporary table "tmp_computed_dirty" (
              table_id text not null,
              record_id text not null,
              primary key (table_id, record_id)
            ) on commit drop",
        },
        {
          "parameters": [],
          "sql": "drop table if exists "tmp_computed_before_image"",
        },
        {
          "parameters": [],
          "sql": "create temporary table "tmp_computed_before_image" (
              table_id text not null,
              record_id text not null,
              field_values jsonb not null,
              primary key (table_id, record_id)
            ) on commit drop",
        },
        {
          "parameters": [
            "tblcccccccccccccccc",
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "insert into "tmp_computed_dirty" ("table_id", "record_id") values ($1, $2) on conflict ("table_id", "record_id") do nothing",
        },
        {
          "parameters": [
            "tblcccccccccccccccc",
          ],
          "sql": "insert into "tmp_computed_dirty" ("table_id", "record_id") select distinct 'tblbbbbbbbbbbbbbbbb' as "table_id", "j"."__fk_fldffffffffffffffff" as "record_id" from "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" as "j" inner join "tmp_computed_dirty" as "d" on "d"."record_id" = "j"."__fk_fldeeeeeeeeeeeeeeee" where "d"."table_id" = $1 on conflict ("table_id", "record_id") do nothing",
        },
        {
          "parameters": [],
          "sql": "select "table_id" as "tableId", count(*) as "recordCount" from "tmp_computed_dirty" group by "table_id"",
        },
        {
          "parameters": [
            "tblbbbbbbbbbbbbbbbb",
          ],
          "sql": "select count(*) as "count" from "tmp_computed_dirty" where "table_id" = $1",
        },
        {
          "parameters": [
            "tblbbbbbbbbbbbbbbbb",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "u" set "__version" = "u"."__version" + 1, "col_link" = "c"."__set_col_link" from (select "c_src"."__id" as "__id", (CASE
          WHEN "c_src"."col_link" IS NULL THEN NULL::jsonb
          ELSE to_jsonb("c_src"."col_link")
        END) as "__set_col_link" from (select "t"."__id" as "__id", "t"."__version" as "__version", "lat_fldeeeeeeeeeeeeeeee_0"."col_link" as "col_link" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "t" inner join "tmp_computed_dirty" as "__dirty" on "t"."__id" = "__dirty"."record_id" and "__dirty"."table_id" = $1 inner join lateral (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', "f"."__id", 'title', ("f"."col_name")::text)) ORDER BY (SELECT "j"."__order" FROM "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" AS j WHERE "j"."__fk_fldffffffffffffffff" = "t"."__id" AND "j"."__fk_fldeeeeeeeeeeeeeeee" = "f"."__id"), (SELECT "j"."__id" FROM "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" AS j WHERE "j"."__fk_fldffffffffffffffff" = "t"."__id" AND "j"."__fk_fldeeeeeeeeeeeeeeee" = "f"."__id")) as "col_link" from "bseaaaaaaaaaaaaaaaa"."tblcccccccccccccccc" as "f" where "f"."__id" IN (SELECT "j"."__fk_fldeeeeeeeeeeeeeeee" FROM "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" AS j WHERE "j"."__fk_fldffffffffffffffff" = "t"."__id")) as "lat_fldeeeeeeeeeeeeeeee_0" on true) as "c_src") as "c" where "u"."__id" = "c"."__id" and ("u"."col_link" IS DISTINCT FROM "c"."__set_col_link")",
        },
      ]
    `);
  });

  it('deduplicates equivalent dirty propagation selects before building the batch SQL', async () => {
    const {
      baseId,
      sourceTable,
      middleTable,
      sourceNameFieldId,
      sourceScoreFieldId,
      middleLinkFieldId,
      middleLookupFieldId,
      middleRollupFieldId,
    } = createLookupRollupCascadeTables();
    const recordId = RecordId.create(CASCADE_RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: sourceTable.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      steps: [
        {
          tableId: middleTable.id(),
          fieldIds: [middleLookupFieldId, middleRollupFieldId],
          level: 0,
        },
      ],
      edges: [
        {
          fromFieldId: sourceNameFieldId,
          toFieldId: middleLookupFieldId,
          fromTableId: sourceTable.id(),
          toTableId: middleTable.id(),
          linkFieldId: middleLinkFieldId,
          order: 0,
        },
        {
          fromFieldId: sourceScoreFieldId,
          toFieldId: middleRollupFieldId,
          fromTableId: sourceTable.id(),
          toTableId: middleTable.id(),
          linkFieldId: middleLinkFieldId,
          order: 1,
        },
      ],
      estimatedComplexity: 2,
      changeType: 'update',
      sameTableBatches: [],
    };

    const { db, driver } = createRecordingDb();
    const tableRepository = createTableRepository([sourceTable, middleTable]);
    const logger = createLogger();
    const typeValidationStrategy = createTypeValidationStrategy();
    const updater = new ComputedFieldUpdater(
      tableRepository,
      logger,
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      typeValidationStrategy
    );

    const context: IExecutionContext = { actorId };
    const result = await updater.execute(plan, context);
    expect(result.isOk()).toBe(true);

    const propagationQuery = driver.queries.find((query) =>
      query.sql.includes(
        `insert into "tmp_computed_dirty" ("table_id", "record_id") select distinct '${CASCADE_MIDDLE_TABLE_ID}'`
      )
    );

    expect(propagationQuery).toBeDefined();
    expect(propagationQuery?.sql).not.toContain('union all');
  });

  it('records planned and runtime allTargetRecords reasons on tracing spans', async () => {
    const { baseId, foreignTable, hostTable, lookupFieldId, linkFieldId } = createLinkTables();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();
    const missingFieldId = `fld${'m'.repeat(16)}`;

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: foreignTable.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      steps: [
        {
          tableId: hostTable.id(),
          fieldIds: [linkFieldId],
          level: 0,
        },
      ],
      edges: [
        {
          fromFieldId: lookupFieldId,
          toFieldId: linkFieldId,
          fromTableId: foreignTable.id(),
          toTableId: hostTable.id(),
          propagationMode: 'allTargetRecords',
          allTargetRecordsReasons: ['conditional_delete'],
          order: 0,
        },
        {
          fromFieldId: lookupFieldId,
          toFieldId: linkFieldId,
          fromTableId: foreignTable.id(),
          toTableId: hostTable.id(),
          propagationMode: 'conditionalFiltered',
          filterCondition: {
            foreignTableId: foreignTable.id(),
            filterDto: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: missingFieldId,
                  operator: 'is',
                  value: 'x',
                },
              ],
            },
          },
          order: 1,
        },
      ],
      estimatedComplexity: 2,
      changeType: 'update',
      sameTableBatches: [],
    };

    const { db } = createRecordingDb();
    const tableRepository = createTableRepository([hostTable, foreignTable]);
    const logger = createLogger();
    const typeValidationStrategy = createTypeValidationStrategy();
    const updater = new ComputedFieldUpdater(
      tableRepository,
      logger,
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      typeValidationStrategy
    );
    const { tracer, spans } = createTracerRecorder();

    const context: IExecutionContext = { actorId, tracer: tracer as never };
    const result = await updater.execute(plan, context);
    expect(result.isOk()).toBe(true);

    const executeSpan = spans.find((span) => span.name === 'teable.ComputedFieldUpdater.execute');
    expect(executeSpan?.attributes['computed.plannedAllTargetReasons']).toBe(
      'conditional_delete:1'
    );
    expect(executeSpan?.attributes['computed.runtimeAllTargetFallbackReasons']).toBe(
      'conditional_runtime_invalid_condition_spec:1'
    );

    const batchSpan = spans.find(
      (span) => span.name === 'teable.ComputedFieldUpdater.propagateDirtyBatch'
    );
    expect(batchSpan?.attributes['batch.plannedAllTargetReasons']).toBe('conditional_delete:1');
    expect(batchSpan?.attributes['batch.runtimeAllTargetFallbackReasons']).toBe(
      'conditional_runtime_invalid_condition_spec:1'
    );
  });

  it('uses before-image snapshots in conditional propagation SQL when requested', async () => {
    const { baseId, sourceTable, targetTable, statusFieldId, targetFieldId } =
      createConditionalPropagationTables();
    const recordId = RecordId.create(CONDITIONAL_RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: sourceTable.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      beforeImageRecords: [
        {
          recordId,
          fieldValuesByDbName: {
            col_status: 'closed',
          },
        },
      ],
      steps: [
        {
          tableId: targetTable.id(),
          fieldIds: [targetFieldId],
          level: 0,
        },
      ],
      edges: [
        {
          fromFieldId: statusFieldId,
          toFieldId: targetFieldId,
          fromTableId: sourceTable.id(),
          toTableId: targetTable.id(),
          propagationMode: 'conditionalFiltered',
          filterCondition: {
            foreignTableId: sourceTable.id(),
            filterDto: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: statusFieldId.toString(),
                  operator: 'is',
                  value: 'open',
                },
              ],
            },
            includeBeforeImage: true,
          },
          order: 0,
        },
      ],
      estimatedComplexity: 1,
      changeType: 'update',
      sameTableBatches: [],
    };

    const { db, driver } = createRecordingDb();
    const tableRepository = createTableRepository([sourceTable, targetTable]);
    const logger = createLogger();
    const typeValidationStrategy = createTypeValidationStrategy();
    const updater = new ComputedFieldUpdater(
      tableRepository,
      logger,
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      typeValidationStrategy
    );

    const context: IExecutionContext = { actorId };
    const prepared = await updater.prepareDirtyState(plan, context);
    expect(prepared.isOk()).toBe(true);

    const beforeImageSeedQuery = driver.queries.find((query) =>
      query.sql.includes('insert into "tmp_computed_before_image"')
    );
    expect(beforeImageSeedQuery?.parameters).toEqual([
      CONDITIONAL_SOURCE_TABLE_ID,
      CONDITIONAL_RECORD_ID,
      JSON.stringify({ col_status: 'closed' }),
    ]);

    const propagationQuery = driver.queries.find((query) =>
      query.sql.includes('jsonb_populate_record')
    );
    expect(propagationQuery?.sql).toContain('"tmp_computed_before_image"');
    expect(propagationQuery?.sql).toContain('jsonb_populate_record');
    expect(propagationQuery?.sql).toContain('as s_before');
    expect(propagationQuery?.sql).toContain(`coalesce(to_jsonb("s_current"), '{}'::jsonb)`);
  });

  it('generates SQL for lookup/rollup cascade updates', async () => {
    const {
      baseId,
      sourceTable,
      middleTable,
      targetTable,
      sourceNameFieldId,
      sourceScoreFieldId,
      middleLinkFieldId,
      middleLookupFieldId,
      middleRollupFieldId,
      targetLinkFieldId,
      targetLookupFieldId,
    } = createLookupRollupCascadeTables();
    const recordId = RecordId.create(CASCADE_RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: sourceTable.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      steps: [
        {
          tableId: middleTable.id(),
          fieldIds: [middleLookupFieldId, middleRollupFieldId],
          level: 0,
        },
        {
          tableId: targetTable.id(),
          fieldIds: [targetLookupFieldId],
          level: 1,
        },
      ],
      edges: [
        {
          fromFieldId: sourceNameFieldId,
          toFieldId: middleLookupFieldId,
          fromTableId: sourceTable.id(),
          toTableId: middleTable.id(),
          linkFieldId: middleLinkFieldId,
          order: 0,
        },
        {
          fromFieldId: sourceScoreFieldId,
          toFieldId: middleRollupFieldId,
          fromTableId: sourceTable.id(),
          toTableId: middleTable.id(),
          linkFieldId: middleLinkFieldId,
          order: 1,
        },
        {
          fromFieldId: middleRollupFieldId,
          toFieldId: targetLookupFieldId,
          fromTableId: middleTable.id(),
          toTableId: targetTable.id(),
          linkFieldId: targetLinkFieldId,
          order: 2,
        },
      ],
      estimatedComplexity: 3,
      changeType: 'update',
      sameTableBatches: [],
    };

    const { db, driver } = createRecordingDb();
    const tableRepository = createTableRepository([sourceTable, middleTable, targetTable]);
    const logger = createLogger();
    const typeValidationStrategy = createTypeValidationStrategy();
    const updater = new ComputedFieldUpdater(
      tableRepository,
      logger,
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      typeValidationStrategy
    );

    const context: IExecutionContext = { actorId };
    const result = await updater.execute(plan, context);
    expect(result.isOk()).toBe(true);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [],
          "sql": "drop table if exists "tmp_computed_dirty"",
        },
        {
          "parameters": [],
          "sql": "create temporary table "tmp_computed_dirty" (
              table_id text not null,
              record_id text not null,
              primary key (table_id, record_id)
            ) on commit drop",
        },
        {
          "parameters": [],
          "sql": "drop table if exists "tmp_computed_before_image"",
        },
        {
          "parameters": [],
          "sql": "create temporary table "tmp_computed_before_image" (
              table_id text not null,
              record_id text not null,
              field_values jsonb not null,
              primary key (table_id, record_id)
            ) on commit drop",
        },
        {
          "parameters": [
            "tblkkkkkkkkkkkkkkkk",
            "recyyyyyyyyyyyyyyyy",
          ],
          "sql": "insert into "tmp_computed_dirty" ("table_id", "record_id") values ($1, $2) on conflict ("table_id", "record_id") do nothing",
        },
        {
          "parameters": [
            "tblkkkkkkkkkkkkkkkk",
            "tblllllllllllllllll",
          ],
          "sql": "insert into "tmp_computed_dirty" ("table_id", "record_id") select distinct 'tblllllllllllllllll' as "table_id", "t"."__id" as "record_id" from "bseaaaaaaaaaaaaaaaa"."tblllllllllllllllll" as "t" inner join "tmp_computed_dirty" as "d" on "d"."record_id" = "t"."__fk_fldpppppppppppppppp" where "d"."table_id" = $1 union all select distinct 'tblmmmmmmmmmmmmmmmm' as "table_id", "t"."__id" as "record_id" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join "tmp_computed_dirty" as "d" on "d"."record_id" = "t"."__fk_fldtttttttttttttttt" where "d"."table_id" = $2 on conflict ("table_id", "record_id") do nothing",
        },
        {
          "parameters": [],
          "sql": "select "table_id" as "tableId", count(*) as "recordCount" from "tmp_computed_dirty" group by "table_id"",
        },
        {
          "parameters": [
            "tblllllllllllllllll",
          ],
          "sql": "select count(*) as "count" from "tmp_computed_dirty" where "table_id" = $1",
        },
        {
          "parameters": [
            "tblllllllllllllllll",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblllllllllllllllll" as "u" set "__version" = "u"."__version" + 1, "col_lookup_b" = "c"."__set_col_lookup_b", "col_rollup_b" = "c"."__set_col_rollup_b" from (select "c_src"."__id" as "__id", (CASE
          WHEN "c_src"."col_lookup_b" IS NULL THEN NULL::jsonb
          ELSE ("c_src"."col_lookup_b")::jsonb
        END) as "__set_col_lookup_b", CASE
          WHEN ("c_src"."col_rollup_b") IS NULL THEN NULL
          WHEN BTRIM(("c_src"."col_rollup_b")::text) ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
            THEN BTRIM(("c_src"."col_rollup_b")::text)::double precision
          ELSE NULL
        END as "__set_col_rollup_b" from (select "t"."__id" as "__id", "t"."__version" as "__version", "lat_fldpppppppppppppppp_0"."col_lookup_b" as "col_lookup_b", "lat_fldpppppppppppppppp_0"."col_rollup_b" as "col_rollup_b" from "bseaaaaaaaaaaaaaaaa"."tblllllllllllllllll" as "t" inner join "tmp_computed_dirty" as "__dirty" on "t"."__id" = "__dirty"."record_id" and "__dirty"."table_id" = $1 inner join lateral (select jsonb_agg(to_jsonb("f"."col_source_name")) FILTER (WHERE "f"."col_source_name" IS NOT NULL) as "col_lookup_b", CAST(COALESCE(SUM("f"."col_source_score"), 0) AS DOUBLE PRECISION) as "col_rollup_b" from "bseaaaaaaaaaaaaaaaa"."tblkkkkkkkkkkkkkkkk" as "f" where "f"."__id" = "t"."__fk_fldpppppppppppppppp") as "lat_fldpppppppppppppppp_0" on true) as "c_src") as "c" where "u"."__id" = "c"."__id" and ("u"."col_lookup_b" IS DISTINCT FROM "c"."__set_col_lookup_b" OR "u"."col_rollup_b" IS DISTINCT FROM "c"."__set_col_rollup_b")",
        },
        {
          "parameters": [
            "tblmmmmmmmmmmmmmmmm",
          ],
          "sql": "select count(*) as "count" from "tmp_computed_dirty" where "table_id" = $1",
        },
        {
          "parameters": [
            "tblmmmmmmmmmmmmmmmm",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "u" set "__version" = "u"."__version" + 1, "col_lookup_c" = "c"."__set_col_lookup_c" from (select "c_src"."__id" as "__id", (CASE
          WHEN "c_src"."col_lookup_c" IS NULL THEN NULL::jsonb
          ELSE ("c_src"."col_lookup_c")::jsonb
        END) as "__set_col_lookup_c" from (select "t"."__id" as "__id", "t"."__version" as "__version", "lat_fldtttttttttttttttt_0"."col_lookup_c" as "col_lookup_c" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join "tmp_computed_dirty" as "__dirty" on "t"."__id" = "__dirty"."record_id" and "__dirty"."table_id" = $1 inner join lateral (select jsonb_agg(to_jsonb("f"."col_rollup_b")) FILTER (WHERE "f"."col_rollup_b" IS NOT NULL) as "col_lookup_c" from "bseaaaaaaaaaaaaaaaa"."tblllllllllllllllll" as "f" where "f"."__id" = "t"."__fk_fldtttttttttttttttt") as "lat_fldtttttttttttttttt_0" on true) as "c_src") as "c" where "u"."__id" = "c"."__id" and ("u"."col_lookup_c" IS DISTINCT FROM "c"."__set_col_lookup_c")",
        },
      ]
    `);
  });

  it('chunks same-table CTE batch updates when dirty records exceed threshold', async () => {
    const { baseId, table, plusOneFieldId, doubleFieldId } = createSameTableFormulaChainTable();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();
    const seedRecordIds = createSequentialRecordIds(1001);

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: table.id(),
      seedRecordIds,
      extraSeedRecords: [],
      steps: [
        {
          tableId: table.id(),
          fieldIds: [plusOneFieldId],
          level: 0,
        },
        {
          tableId: table.id(),
          fieldIds: [doubleFieldId],
          level: 1,
        },
      ],
      edges: [],
      estimatedComplexity: 2,
      changeType: 'update',
      sameTableBatches: [
        {
          tableId: table.id(),
          steps: [
            {
              tableId: table.id(),
              fieldIds: [plusOneFieldId],
              level: 0,
            },
            {
              tableId: table.id(),
              fieldIds: [doubleFieldId],
              level: 1,
            },
          ],
          minLevel: 0,
          maxLevel: 1,
        },
      ],
    };

    const { db, driver } = createRecordingDb();
    const tableRepository = createTableRepository([table]);
    const logger = createLogger();
    const typeValidationStrategy = createTypeValidationStrategy();
    const updater = new ComputedFieldUpdater(
      tableRepository,
      logger,
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      typeValidationStrategy
    );
    const updaterInternal = updater as unknown as {
      getDirtyCountForTable: () => Promise<number>;
      getDirtyRecordIdChunks: () => Promise<ReadonlyArray<ReadonlyArray<string>>>;
    };
    updaterInternal.getDirtyCountForTable = async () => 1001;
    updaterInternal.getDirtyRecordIdChunks = async () => [
      Array.from({ length: 500 }, (_, i) => `rec${i.toString().padStart(16, '0')}`),
      Array.from({ length: 500 }, (_, i) => `rec${(i + 500).toString().padStart(16, '0')}`),
      Array.from({ length: 1 }, (_, i) => `rec${(i + 1000).toString().padStart(16, '0')}`),
    ];

    const context: IExecutionContext = { actorId };
    const result = await updater.execute(plan, context);
    expect(result.isOk()).toBe(true);

    const updateQueries = driver.queries.filter((query) =>
      query.sql.startsWith('update "bseaaaaaaaaaaaaaaaa"."tblzzzzzzzzzzzzzzzz" as "u"')
    );

    expect(updateQueries).toHaveLength(3);
    for (const query of updateQueries) {
      expect(query.sql).toMatch(/with "level_0" as/i);
      expect(query.sql).toMatch(/join "level_1" on u\."__id" = "level_1"\."__id"/i);
      expect(query.sql).toContain(
        'AS "__record_ids"("__id") ON "t"."__id" = "__record_ids"."__id"'
      );
      expect(query.sql).not.toContain('from "level_0", "level_1"');
    }
  });
});
