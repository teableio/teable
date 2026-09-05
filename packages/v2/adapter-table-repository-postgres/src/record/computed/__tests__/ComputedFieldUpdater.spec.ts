import {
  ActorId,
  BaseId,
  DbFieldName,
  DbFieldType,
  FormulaExpression,
  FieldId,
  FieldName,
  ConditionalLookupOptions,
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
  StaticTableDataSafetyLimitPlugin,
  TableDataSafetyLimitComposer,
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

import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import type { DynamicDB } from '../../query-builder';
import { ComputedFieldUpdater } from '../ComputedFieldUpdater';
import { COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE } from '../ComputedUpdateLock';
import type { ComputedUpdatePlan } from '../ComputedUpdatePlanner';

// =============================================================================
// Test utilities
// =============================================================================

class RecordingConnection implements DatabaseConnection {
  constructor(
    private readonly queries: CompiledQuery[],
    private readonly returningRows: unknown[][],
    private readonly propagationAffectedRows: bigint[],
    private readonly dirtyCounts: number[]
  ) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(compiledQuery);
    if (
      compiledQuery.sql.startsWith(
        'select count(*) as "count" from "pg_temp"."tmp_computed_dirty"'
      ) &&
      this.dirtyCounts.length
    ) {
      return { rows: [{ count: this.dirtyCounts.shift() }] as R[] };
    }
    if (compiledQuery.sql.includes(' RETURNING ') && this.returningRows.length > 0) {
      return { rows: this.returningRows.shift() as R[], numAffectedRows: BigInt(0) };
    }
    if (
      compiledQuery.sql.includes('insert into "pg_temp"."tmp_computed_dirty"') &&
      compiledQuery.sql.includes(' select ') &&
      this.propagationAffectedRows.length > 0
    ) {
      return { rows: [], numAffectedRows: this.propagationAffectedRows.shift() };
    }
    return { rows: [], numAffectedRows: BigInt(0) };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
}

class RecordingDriver implements Driver {
  readonly queries: CompiledQuery[] = [];
  readonly dirtyCounts: number[] = [];

  constructor(
    private readonly returningRows: unknown[][] = [],
    private readonly propagationAffectedRows: bigint[] = []
  ) {}

  async init(): Promise<void> {
    return undefined;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new RecordingConnection(
      this.queries,
      this.returningRows,
      this.propagationAffectedRows,
      this.dirtyCounts
    );
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

const createRecordingDb = (
  returningRows: unknown[][] = [],
  propagationAffectedRows: bigint[] = []
) => {
  const driver = new RecordingDriver(returningRows, propagationAffectedRows);
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

const createFilteringTableRepository = (tables: ReadonlyArray<Table>): ITableRepository => ({
  ...createTableRepository(tables),
  find: async (_context, spec) => ok(tables.filter((table) => spec.isSatisfiedBy(table))),
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
const SELF_CONDITIONAL_TABLE_ID = `tbl${'s'.repeat(16)}`;
const SELF_CONDITIONAL_COMMENT_FIELD_ID = `fld${'1'.repeat(16)}`;
const SELF_CONDITIONAL_PARENT_FIELD_ID = `fld${'2'.repeat(16)}`;
const SELF_CONDITIONAL_LOOKUP_FIELD_ID = `fld${'3'.repeat(16)}`;

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

const createWideSameLevelFormulaTable = (formulaFieldCount: number) => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'r'.repeat(16)}`)._unsafeUnwrap();
  const valueFieldId = FieldId.create(`fld${'v'.repeat(16)}`)._unsafeUnwrap();

  const valueFieldResult = createNumberField({
    id: valueFieldId,
    name: FieldName.create('Value')._unsafeUnwrap(),
  }).andThen((field) =>
    DbFieldName.rehydrate('col_value').andThen((dbName) =>
      field.setDbFieldName(dbName).map(() => field)
    )
  );

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('WideSameLevelFormula')._unsafeUnwrap())
    .addFieldFromResult(valueFieldResult);

  const formulaFieldIds: FieldId[] = [];
  for (let index = 0; index < formulaFieldCount; index += 1) {
    const fieldId = FieldId.create(`fld${index.toString().padStart(16, '0')}`)._unsafeUnwrap();
    formulaFieldIds.push(fieldId);

    const formulaFieldResult = createFormulaField({
      id: fieldId,
      name: FieldName.create(`Formula${index}`)._unsafeUnwrap(),
      expression: FormulaExpression.create(
        `{${valueFieldId.toString()}} + ${index}`
      )._unsafeUnwrap(),
    }).andThen((field) =>
      DbFieldName.rehydrate(`col_formula_${index}`).andThen((dbName) =>
        field.setDbFieldName(dbName).map(() => field)
      )
    );
    builder.addFieldFromResult(formulaFieldResult);
  }

  const table = builder.view().defaultGrid().done().build()._unsafeUnwrap();

  return {
    baseId,
    table,
    valueFieldId,
    formulaFieldIds,
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

const createSelfReferencingConditionalTable = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(SELF_CONDITIONAL_TABLE_ID)._unsafeUnwrap();
  const commentFieldId = FieldId.create(SELF_CONDITIONAL_COMMENT_FIELD_ID)._unsafeUnwrap();
  const parentFieldId = FieldId.create(SELF_CONDITIONAL_PARENT_FIELD_ID)._unsafeUnwrap();
  const lookupFieldId = FieldId.create(SELF_CONDITIONAL_LOOKUP_FIELD_ID)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('SelfConditional')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(commentFieldId)
    .withName(FieldName.create('CommentId')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .singleLineText()
    .withId(parentFieldId)
    .withName(FieldName.create('ParentCommentId')._unsafeUnwrap())
    .done();
  builder
    .field()
    .singleLineText()
    .withId(lookupFieldId)
    .withName(FieldName.create('ParentText')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(commentFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_comment_id')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(parentFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_parent_comment_id')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(lookupFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_parent_text')._unsafeUnwrap())
    ._unsafeUnwrap();

  return { baseId, table, commentFieldId, parentFieldId, lookupFieldId };
};

const createConditionalGroupLookupTables = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const sourceTableId = TableId.create(CONDITIONAL_SOURCE_TABLE_ID)._unsafeUnwrap();
  const hostTableId = TableId.create(CONDITIONAL_TARGET_TABLE_ID)._unsafeUnwrap();
  const sourceValueFieldId = FieldId.create(CONDITIONAL_NAME_FIELD_ID)._unsafeUnwrap();
  const sourceGroupFieldId = FieldId.create(CONDITIONAL_STATUS_FIELD_ID)._unsafeUnwrap();
  const hostGroupFieldId = FieldId.create(CONDITIONAL_TARGET_FIELD_ID)._unsafeUnwrap();
  const conditionalLookupFieldId = FieldId.create(`fld${'4'.repeat(16)}`)._unsafeUnwrap();

  const sourceBuilder = Table.builder()
    .withId(sourceTableId)
    .withBaseId(baseId)
    .withName(TableName.create('ConditionalGroupSource')._unsafeUnwrap());
  sourceBuilder
    .field()
    .singleLineText()
    .withId(sourceValueFieldId)
    .withName(FieldName.create('Value')._unsafeUnwrap())
    .primary()
    .done();
  sourceBuilder
    .field()
    .singleLineText()
    .withId(sourceGroupFieldId)
    .withName(FieldName.create('Group')._unsafeUnwrap())
    .done();
  sourceBuilder.view().defaultGrid().done();
  const sourceTable = sourceBuilder.build()._unsafeUnwrap();
  sourceTable
    .getField((field) => field.id().equals(sourceValueFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_value')._unsafeUnwrap())
    ._unsafeUnwrap();
  sourceTable
    .getField((field) => field.id().equals(sourceGroupFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_group')._unsafeUnwrap())
    ._unsafeUnwrap();

  const conditionalLookupOptions = ConditionalLookupOptions.create({
    foreignTableId: sourceTableId.toString(),
    lookupFieldId: sourceValueFieldId.toString(),
    condition: {
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: sourceGroupFieldId.toString(),
            operator: 'is',
            value: hostGroupFieldId.toString(),
            isSymbol: true,
          },
        ],
      },
      limit: 100,
    },
  })._unsafeUnwrap();

  const hostBuilder = Table.builder()
    .withId(hostTableId)
    .withBaseId(baseId)
    .withName(TableName.create('ConditionalGroupHost')._unsafeUnwrap());
  hostBuilder
    .field()
    .singleLineText()
    .withId(hostGroupFieldId)
    .withName(FieldName.create('Lookup Group')._unsafeUnwrap())
    .primary()
    .done();
  hostBuilder
    .field()
    .conditionalLookup()
    .withId(conditionalLookupFieldId)
    .withName(FieldName.create('Group Values')._unsafeUnwrap())
    .withConditionalLookupOptions(conditionalLookupOptions)
    .withInnerField(
      sourceTable.getField((field) => field.id().equals(sourceValueFieldId))._unsafeUnwrap()
    )
    .done();
  hostBuilder.view().defaultGrid().done();
  const hostTable = hostBuilder.build({ foreignTables: [sourceTable] })._unsafeUnwrap();
  hostTable
    .getField((field) => field.id().equals(hostGroupFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_lookup_group')._unsafeUnwrap())
    ._unsafeUnwrap();
  hostTable
    .getField((field) => field.id().equals(conditionalLookupFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_group_values')._unsafeUnwrap())
    ._unsafeUnwrap();

  return { baseId, sourceTable, hostTable, conditionalLookupFieldId };
};

const createSequentialRecordIds = (count: number): RecordId[] =>
  Array.from({ length: count }, (_, index) =>
    RecordId.create(`rec${index.toString().padStart(16, '0')}`)._unsafeUnwrap()
  );

// =============================================================================
// Tests
// =============================================================================

describe('ComputedFieldUpdater', () => {
  it('invalidates an untracked scope before empty-stage return', async () => {
    const { baseId, table } = createSameTableFormulaChainTable();
    const { db, driver } = createRecordingDb();
    const updater = new ComputedFieldUpdater(
      createTableRepository([table]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy()
    );
    const result = await updater.execute(
      {
        baseId,
        seedTableId: table.id(),
        seedRecordIds: [],
        extraSeedRecords: [],
        steps: [],
        edges: [],
        estimatedComplexity: 0,
        changeType: 'update',
        sameTableBatches: [],
      },
      { actorId: ActorId.create(ACTOR_ID)._unsafeUnwrap() },
      undefined,
      { ledgerScopeId: 'scope', valueFrontier: { tableIds: [] } }
    );
    expect(result.isOk()).toBe(true);
    expect(driver.queries).toHaveLength(1);
    expect(driver.queries[0].sql).toContain('delete from "computed_update_change_frontier"');
    expect(driver.queries[0].parameters).toContain('scope');
  });

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
    expect(driver.queries).toHaveLength(1);
    expect(driver.queries[0]?.sql).toContain('pg_try_advisory_xact_lock');
    expect(driver.queries[0]?.sql).not.toContain('unnest');
    expect(driver.queries[0]?.parameters).toHaveLength(1);
  });

  it('loads tables referenced only by seedAllTableIds before dirty seeding', async () => {
    const { baseId, table, plusOneFieldId } = createSameTableFormulaChainTable();
    const { hostTable: seedAllTable } = createLinkTables();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: table.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      seedAllTableIds: [seedAllTable.id()],
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
      createFilteringTableRepository([table, seedAllTable]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy()
    );

    const result = await updater.prepareDirtyState(plan, { actorId });

    expect(result.isOk()).toBe(true);
    expect(
      driver.queries.some(
        (query) =>
          query.sql.includes('insert into "pg_temp"."tmp_computed_dirty"') &&
          query.sql.includes(`from "${BASE_ID}"."${TABLE_ID}"`)
      )
    ).toBe(true);
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
          "sql": "drop table if exists "pg_temp"."tmp_computed_dirty"",
        },
        {
          "parameters": [],
          "sql": "create temporary table "pg_temp"."tmp_computed_dirty" (
              table_id text not null,
              record_id text not null,
              generation integer not null default 0,
              primary key (table_id, record_id)
            ) on commit drop",
        },
        {
          "parameters": [],
          "sql": "create index tmp_computed_dirty_frontier_idx on "pg_temp"."tmp_computed_dirty" (
              generation,
              table_id,
              record_id
            )",
        },
        {
          "parameters": [],
          "sql": "drop table if exists "pg_temp"."tmp_computed_before_image"",
        },
        {
          "parameters": [],
          "sql": "create temporary table "pg_temp"."tmp_computed_before_image" (
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
          "sql": "insert into "pg_temp"."tmp_computed_dirty" ("table_id", "record_id") values ($1, $2) on conflict ("table_id", "record_id") do nothing",
        },
        {
          "parameters": [
            "bseaaaaaaaaaaaaaaaa",
            "junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff",
            "__fk_fldeeeeeeeeeeeeeeee",
          ],
          "sql": "
              SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = $1
                  AND table_name = $2
                  AND column_name = $3
              ) as exists
            ",
        },
        {
          "parameters": [
            "tblcccccccccccccccc",
            0,
          ],
          "sql": "insert into "pg_temp"."tmp_computed_dirty" ("table_id", "record_id", "generation") select "propagated"."table_id" as "table_id", "propagated"."record_id" as "record_id", 1 as "generation" from (select distinct 'tblbbbbbbbbbbbbbbbb' as "table_id", "j"."__fk_fldffffffffffffffff" as "record_id" from "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" as "j" inner join "pg_temp"."tmp_computed_dirty" as "d" on "d"."record_id" = "j"."__fk_fldeeeeeeeeeeeeeeee" where "d"."table_id" = $1 and "d"."generation" = $2) as "propagated" on conflict ("table_id", "record_id") do nothing",
        },
        {
          "parameters": [],
          "sql": "select "table_id" as "tableId", count(*) as "recordCount" from "pg_temp"."tmp_computed_dirty" group by "table_id"",
        },
        {
          "parameters": [
            "tblbbbbbbbbbbbbbbbb",
          ],
          "sql": "select count(*) as "count" from "pg_temp"."tmp_computed_dirty" where "table_id" = $1",
        },
        {
          "parameters": [
            "tblbbbbbbbbbbbbbbbb",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "u" set "__version" = "u"."__version" + 1, "col_link" = "c"."__set_col_link"::jsonb from (select "c_src"."__id" as "__id", (CASE
          WHEN "c_src"."col_link" IS NULL THEN NULL::jsonb
          ELSE to_jsonb("c_src"."col_link")
        END) as "__set_col_link" from (select "t"."__id" as "__id", "t"."__version" as "__version", "lat_fldeeeeeeeeeeeeeeee_0"."col_link" as "col_link" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "t" inner join "pg_temp"."tmp_computed_dirty" as "__dirty" on "t"."__id" = "__dirty"."record_id" and "__dirty"."table_id" = $1 inner join lateral (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', "f"."__id", 'title', ("f"."col_name")::text)) ORDER BY (SELECT "j"."__order" FROM "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" AS j WHERE "j"."__fk_fldffffffffffffffff" = "t"."__id" AND "j"."__fk_fldeeeeeeeeeeeeeeee" = "f"."__id"), (SELECT "j"."__id" FROM "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" AS j WHERE "j"."__fk_fldffffffffffffffff" = "t"."__id" AND "j"."__fk_fldeeeeeeeeeeeeeeee" = "f"."__id")) as "col_link" from "bseaaaaaaaaaaaaaaaa"."tblcccccccccccccccc" as "f" where "f"."__id" IN (SELECT "j"."__fk_fldeeeeeeeeeeeeeeee" FROM "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" AS j WHERE "j"."__fk_fldffffffffffffffff" = "t"."__id")) as "lat_fldeeeeeeeeeeeeeeee_0" on true) as "c_src") as "c" where "u"."__id" = "c"."__id" and (("u"."col_link")::jsonb IS DISTINCT FROM ("c"."__set_col_link")::jsonb)",
        },
      ]
    `);
  });

  it('rejects oversized computed cell values returned from updates', async () => {
    const { baseId, table, plusOneFieldId } = createSameTableFormulaChainTable();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: table.id(),
      seedRecordIds: [recordId],
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

    const { db } = createRecordingDb([
      [
        {
          __id: RECORD_ID,
          __old_version: 1,
          col_plus_one: 'oversized',
        },
      ],
    ]);
    const updater = new ComputedFieldUpdater(
      createTableRepository([table]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy(),
      new TableDataSafetyLimitComposer([
        new StaticTableDataSafetyLimitPlugin({
          computed: { maxComputedCellValueBytes: 1 },
        }),
      ])
    );

    const result = await updater.execute(plan, { actorId }, undefined, { collectChanges: true });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.computed_cell_value_max_bytes');
  });

  it('isolates oversized computed cells and continues when requested', async () => {
    const { baseId, table, plusOneFieldId } = createSameTableFormulaChainTable();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: table.id(),
      seedRecordIds: [recordId],
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

    const { db, driver } = createRecordingDb([
      [
        {
          __id: RECORD_ID,
          __old_version: 1,
          col_plus_one: 'oversized',
        },
      ],
    ]);
    const updater = new ComputedFieldUpdater(
      createTableRepository([table]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy(),
      new TableDataSafetyLimitComposer([
        new StaticTableDataSafetyLimitPlugin({
          computed: { maxComputedCellValueBytes: 1 },
        }),
      ])
    );

    const result = await updater.execute(plan, { actorId }, undefined, {
      collectChanges: true,
      isolateOversizedComputedCells: true,
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.changesByStep).toEqual([]);
    expect(value.rejectedCells).toEqual([
      {
        tableId: table.id().toString(),
        recordId: RECORD_ID,
        fieldId: plusOneFieldId.toString(),
        column: 'col_plus_one',
        columnType: 'double precision',
        oldValue: undefined,
        attempted: JSON.stringify('oversized').length,
        max: 1,
      },
    ]);
    const revert = driver.queries.find(
      (query) =>
        query.sql.includes('set "col_plus_one" = "__v"."val"') && !query.sql.includes(' RETURNING ')
    );
    expect(revert).toBeDefined();
    expect(revert?.sql).toContain(`update "${BASE_ID}"."${SAME_TABLE_FORMULA_TABLE_ID}"`);
    expect(revert?.sql).toContain('from (values ');
    expect(revert?.sql).toContain('::double precision)');
    // Missing old alias reverts to NULL, never to a serialized "undefined".
    expect(revert?.parameters).toEqual([RECORD_ID, null]);
    // Rejected records are re-dirtied so same-statement dependents recompute
    // from the reverted stored value in the continuation stage.
    const reseed = driver.queries.find(
      (query) =>
        query.sql.includes('insert into "pg_temp"."tmp_computed_dirty"') &&
        query.parameters.includes(RECORD_ID)
    );
    expect(reseed).toBeDefined();
  });

  it('allows oversized junction-backed link projections to stay consistent', async () => {
    const { baseId, foreignTable, hostTable, linkFieldId } = createLinkTables();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();
    const linkValue = Array.from({ length: 8_000 }, (_, index) => ({
      id: `rec${index.toString().padStart(16, '0')}`,
      title: `Synthetic item ${index}`,
    }));
    expect(JSON.stringify(linkValue).length).toBeGreaterThan(262_144);

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: hostTable.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      steps: [
        {
          tableId: hostTable.id(),
          fieldIds: [linkFieldId],
          level: 0,
        },
      ],
      edges: [],
      estimatedComplexity: 1,
      changeType: 'update',
      sameTableBatches: [],
    };

    const { db } = createRecordingDb([
      [
        {
          __id: RECORD_ID,
          __old_version: 1,
          col_link: linkValue,
        },
      ],
    ]);
    const updater = new ComputedFieldUpdater(
      createTableRepository([hostTable, foreignTable]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy(),
      new TableDataSafetyLimitComposer([
        new StaticTableDataSafetyLimitPlugin({
          computed: { maxComputedCellValueBytes: 262_144 },
        }),
      ])
    );

    const result = await updater.execute(plan, { actorId }, undefined, { collectChanges: true });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().changesByStep[0]?.recordChanges[0]?.changes).toEqual([
      {
        fieldId: linkFieldId.toString(),
        oldValue: undefined,
        newValue: linkValue,
      },
    ]);
  });

  it('chunks wide same-level computed updates and bumps record versions once', async () => {
    const { baseId, table, formulaFieldIds } = createWideSameLevelFormulaTable(17);
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: table.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      steps: [
        {
          tableId: table.id(),
          fieldIds: formulaFieldIds,
          level: 0,
        },
      ],
      edges: [],
      estimatedComplexity: 17,
      changeType: 'update',
      sameTableBatches: [],
    };

    const { db, driver } = createRecordingDb([
      [
        {
          __id: RECORD_ID,
          __old_version: 1,
          col_formula_0: 10,
        },
      ],
      [
        {
          __id: RECORD_ID,
          __old_version: 1,
          col_formula_16: 26,
        },
      ],
    ]);
    const updater = new ComputedFieldUpdater(
      createTableRepository([table]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy()
    );

    const result = await updater.execute(plan, { actorId }, undefined, { collectChanges: true });

    expect(result.isOk()).toBe(true);
    const updates = driver.queries.filter((query) =>
      query.sql.startsWith('update "bseaaaaaaaaaaaaaaaa"."tblrrrrrrrrrrrrrrrr"')
    );
    const returningUpdates = updates.filter((query) => query.sql.includes(' RETURNING '));
    const versionBumps = updates.filter((query) => !query.sql.includes(' RETURNING '));

    expect(returningUpdates).toHaveLength(2);
    expect(returningUpdates[0]?.sql).toContain('"col_formula_0" = "c"."__set_col_formula_0"');
    expect(returningUpdates[0]?.sql).toContain('"col_formula_15" = "c"."__set_col_formula_15"');
    expect(returningUpdates[0]?.sql).not.toContain('"col_formula_16"');
    expect(returningUpdates[0]?.sql).not.toContain('"__version" =');
    expect(returningUpdates[1]?.sql).toContain('"col_formula_16" = "c"."__set_col_formula_16"');
    expect(returningUpdates[1]?.sql).not.toContain('"__version" =');
    expect(versionBumps).toHaveLength(1);
    expect(versionBumps[0]?.sql).toContain('set "__version" = "__version" + 1');
    expect(versionBumps[0]?.parameters).toStrictEqual([RECORD_ID]);

    expect(result._unsafeUnwrap().changesByStep).toHaveLength(1);
    const recordChange = result._unsafeUnwrap().changesByStep[0]?.recordChanges[0];
    expect(recordChange?.recordId).toBe(RECORD_ID);
    expect(recordChange?.oldVersion).toBe(1);
    expect(recordChange?.changes).toHaveLength(17);
    expect(recordChange?.changes).toContainEqual({
      fieldId: formulaFieldIds[0]!.toString(),
      oldValue: undefined,
      newValue: 10,
    });
    expect(recordChange?.changes).toContainEqual({
      fieldId: formulaFieldIds[16]!.toString(),
      oldValue: undefined,
      newValue: 26,
    });
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
      query.sql.includes(`select distinct '${CASCADE_MIDDLE_TABLE_ID}' as "table_id"`)
    );

    expect(propagationQuery).toBeDefined();
    expect(propagationQuery?.sql).not.toContain('union all');
  });

  it('skips dirty propagation when a persisted edge points at a non-link field', async () => {
    const { baseId, sourceTable, middleTable, sourceNameFieldId, middleLookupFieldId } =
      createLookupRollupCascadeTables();
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
          fieldIds: [middleLookupFieldId],
          level: 0,
        },
      ],
      edges: [
        {
          fromFieldId: sourceNameFieldId,
          toFieldId: middleLookupFieldId,
          fromTableId: sourceTable.id(),
          toTableId: middleTable.id(),
          // Stale persisted plan: lookup/rollup id leaked into linkFieldId.
          linkFieldId: middleLookupFieldId,
          order: 0,
        },
      ],
      estimatedComplexity: 1,
      changeType: 'update',
      sameTableBatches: [],
    };

    const { db, driver } = createRecordingDb();
    const updater = new ComputedFieldUpdater(
      createTableRepository([sourceTable, middleTable]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy()
    );

    const result = await updater.execute(plan, { actorId });

    expect(result.isOk()).toBe(true);
    const failure = result.isErr() ? result.error.message : '';
    expect(failure).not.toContain('relationship is not a function');

    const propagationQuery = driver.queries.find(
      (query) =>
        query.sql.includes('insert into "pg_temp"."tmp_computed_dirty"') &&
        query.sql.includes('select ') &&
        query.sql.includes(CASCADE_MIDDLE_TABLE_ID)
    );
    expect(propagationQuery?.sql).toContain('where false');
    expect(propagationQuery?.sql).not.toMatch(/__fk_|junction_/);
  });

  it('skips steps and edges whose table is missing from the loaded set', async () => {
    const { baseId, sourceTable, middleTable, sourceNameFieldId, middleLookupFieldId } =
      createLookupRollupCascadeTables();
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
          fieldIds: [middleLookupFieldId],
          level: 0,
        },
      ],
      edges: [
        {
          fromFieldId: sourceNameFieldId,
          toFieldId: middleLookupFieldId,
          fromTableId: sourceTable.id(),
          toTableId: middleTable.id(),
          order: 0,
        },
      ],
      estimatedComplexity: 1,
      changeType: 'update',
      sameTableBatches: [],
    };

    const { db, driver } = createRecordingDb();
    const updater = new ComputedFieldUpdater(
      createTableRepository([sourceTable]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy()
    );

    const result = await updater.execute(plan, { actorId });

    expect(result.isOk()).toBe(true);
    const failure = result.isErr() ? result.error.message : '';
    expect(failure).not.toContain('Missing table');
    expect(failure).not.toContain('Missing target table');
    const propagationQuery = driver.queries.find(
      (query) =>
        query.sql.includes('insert into "pg_temp"."tmp_computed_dirty"') &&
        query.sql.includes('select ') &&
        query.sql.includes(CASCADE_MIDDLE_TABLE_ID)
    );
    expect(propagationQuery?.sql).toContain('where false');
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

  it('gates all-target self-refresh propagation by the current dirty frontier', async () => {
    const {
      baseId,
      sourceTable,
      middleTable,
      sourceNameFieldId,
      middleLinkFieldId,
      middleLookupFieldId,
    } = createLookupRollupCascadeTables();
    const recordId = RecordId.create(CASCADE_RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: sourceTable.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      steps: [{ tableId: middleTable.id(), fieldIds: [middleLookupFieldId], level: 0 }],
      edges: [
        {
          fromFieldId: sourceNameFieldId,
          toFieldId: sourceNameFieldId,
          fromTableId: sourceTable.id(),
          toTableId: sourceTable.id(),
          propagationMode: 'allTargetRecords',
          order: 0,
        },
        {
          fromFieldId: sourceNameFieldId,
          toFieldId: middleLookupFieldId,
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

    const { db, driver } = createRecordingDb([], [BigInt(1), BigInt(0)]);
    const updater = new ComputedFieldUpdater(
      createTableRepository([sourceTable, middleTable]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy()
    );

    const result = await updater.execute(plan, { actorId });
    expect(result.isOk()).toBe(true);

    const propagationQueries = driver.queries.filter(
      (query) =>
        query.sql.includes('insert into "pg_temp"."tmp_computed_dirty"') &&
        query.sql.includes(' select ')
    );
    expect(propagationQueries).toHaveLength(2);

    for (const [frontierGeneration, query] of propagationQueries.entries()) {
      expect(query.sql).toContain(
        `from "${BASE_ID}"."${CASCADE_SOURCE_TABLE_ID}" as "t" inner join (select "d"."table_id" as "table_id" from "pg_temp"."tmp_computed_dirty" as "d"`
      );
      expect(query.parameters).toContain(frontierGeneration);
    }
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
                  value: {
                    type: 'field',
                    fieldId: targetFieldId.toString(),
                    tableId: targetTable.id().toString(),
                  },
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
      query.sql.includes('insert into "pg_temp"."tmp_computed_before_image"')
    );
    expect(beforeImageSeedQuery?.parameters).toEqual([
      CONDITIONAL_SOURCE_TABLE_ID,
      CONDITIONAL_RECORD_ID,
      JSON.stringify({ col_status: 'closed' }),
    ]);

    // The dirty source rows — current plus reconstructed before-image — are
    // materialized once per statement into a pruned temp relation…
    const materializeQuery = driver.queries.find((query) =>
      query.sql.includes('jsonb_populate_record')
    );
    expect(materializeQuery?.sql).toContain('create temp table "tmp_computed_csrc_');
    expect(materializeQuery?.sql).toContain('"pg_temp"."tmp_computed_before_image"');
    expect(materializeQuery?.sql).toContain('as "s_before"');
    expect(materializeQuery?.sql).toContain(`coalesce(to_jsonb("s_current"), '{}'::jsonb)`);
    expect(materializeQuery?.sql).toContain('from "pg_temp"."tmp_computed_dirty" as "d"');
    expect(materializeQuery?.sql).toContain(
      'inner join "bseaaaaaaaaaaaaaaaa"."tbl0000000000000000" as "s"'
    );
    expect(materializeQuery?.sql).toContain('union all');
    // …and the pruned projection only carries the filter's source columns.
    expect(materializeQuery?.sql).toContain('"s"."col_status" as "col_status"');
    expect(materializeQuery?.sql).toContain('"s_before"."col_status" as "col_status"');

    // …so the target-driven propagation select probes that relation instead of
    // re-running the source scan (and full-row rebuild) once per target row.
    const propagationQuery = driver.queries.find((query) =>
      query.sql.includes('from "bseaaaaaaaaaaaaaaaa"."tbl9999999999999999" as "t"')
    );
    expect(propagationQuery?.sql).toContain('from "pg_temp"."tmp_computed_csrc_');
    expect(propagationQuery?.sql).toContain('where exists (');
    expect(propagationQuery?.sql.match(/exists \(/g)).toHaveLength(1);
    expect(propagationQuery?.sql).not.toContain('jsonb_populate_record');
    expect(propagationQuery?.sql).not.toContain(
      'inner join "bseaaaaaaaaaaaaaaaa"."tbl9999999999999999" as "t"'
    );
  });

  it('propagates host-field conditional matches from current and before-image rows', async () => {
    const { baseId, sourceTable, targetTable, statusFieldId, targetFieldId } =
      createConditionalPropagationTables();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();
    const currentOnlyId = RecordId.create(`rec${'1'.repeat(16)}`)._unsafeUnwrap();
    const beforeOnlyId = RecordId.create(`rec${'2'.repeat(16)}`)._unsafeUnwrap();
    const bothId = RecordId.create(`rec${'3'.repeat(16)}`)._unsafeUnwrap();
    const deletedId = RecordId.create(`rec${'4'.repeat(16)}`)._unsafeUnwrap();
    const data = await createPGliteDb();

    try {
      await data.db.schema.createSchema(BASE_ID).execute();
      await data.db.schema
        .createTable(`${BASE_ID}.${CONDITIONAL_SOURCE_TABLE_ID}`)
        .addColumn('__id', 'varchar', (column) => column.primaryKey())
        .addColumn('col_source_name', 'varchar')
        .addColumn('col_status', 'varchar')
        .execute();
      await data.db.schema
        .createTable(`${BASE_ID}.${CONDITIONAL_TARGET_TABLE_ID}`)
        .addColumn('__id', 'varchar', (column) => column.primaryKey())
        .addColumn('col_filtered_value', 'varchar')
        .execute();

      await data.db
        .insertInto(`${BASE_ID}.${CONDITIONAL_SOURCE_TABLE_ID}`)
        .values([
          { __id: currentOnlyId.toString(), col_status: 'current-only' },
          { __id: beforeOnlyId.toString(), col_status: 'not-before-only' },
          { __id: bothId.toString(), col_status: 'both' },
        ])
        .execute();
      await data.db
        .insertInto(`${BASE_ID}.${CONDITIONAL_TARGET_TABLE_ID}`)
        .values([
          { __id: `rec${'a'.repeat(16)}`, col_filtered_value: 'current-only' },
          { __id: `rec${'b'.repeat(16)}`, col_filtered_value: 'before-only' },
          { __id: `rec${'c'.repeat(16)}`, col_filtered_value: 'both' },
          { __id: `rec${'d'.repeat(16)}`, col_filtered_value: 'deleted' },
          { __id: `rec${'e'.repeat(16)}`, col_filtered_value: 'neither' },
        ])
        .execute();

      const plan: ComputedUpdatePlan = {
        baseId,
        seedTableId: sourceTable.id(),
        seedRecordIds: [currentOnlyId, beforeOnlyId, bothId, deletedId],
        extraSeedRecords: [],
        beforeImageRecords: [
          { recordId: currentOnlyId, fieldValuesByDbName: { col_status: 'not-current-only' } },
          { recordId: beforeOnlyId, fieldValuesByDbName: { col_status: 'before-only' } },
          { recordId: bothId, fieldValuesByDbName: { col_status: 'both' } },
          { recordId: deletedId, fieldValuesByDbName: { col_status: 'deleted' } },
        ],
        steps: [{ tableId: targetTable.id(), fieldIds: [targetFieldId], level: 0 }],
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
                    value: {
                      type: 'field',
                      fieldId: targetFieldId.toString(),
                      tableId: targetTable.id().toString(),
                    },
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

      await data.db.transaction().execute(async (trx) => {
        const updater = new ComputedFieldUpdater(
          createTableRepository([sourceTable, targetTable]),
          createLogger(),
          trx,
          undefined,
          createTypeValidationStrategy()
        );
        const result = await updater.prepareDirtyState(plan, { actorId });
        expect(result.isOk()).toBe(true);

        const dirtyTargets = await trx
          .selectFrom('tmp_computed_dirty')
          .select('record_id')
          .where('table_id', '=', targetTable.id().toString())
          .orderBy('record_id')
          .execute();

        expect(dirtyTargets.map((row) => row.record_id)).toEqual([
          `rec${'a'.repeat(16)}`,
          `rec${'b'.repeat(16)}`,
          `rec${'c'.repeat(16)}`,
          `rec${'d'.repeat(16)}`,
        ]);
      });
    } finally {
      await data.db.destroy();
    }
  });

  it('projects swapped self-table filter references into the pruned propagation source', async () => {
    const { baseId, table, commentFieldId, parentFieldId, lookupFieldId } =
      createSelfReferencingConditionalTable();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();
    const parentId = RecordId.create(`rec${'6'.repeat(16)}`)._unsafeUnwrap();
    const childId = RecordId.create(`rec${'7'.repeat(16)}`)._unsafeUnwrap();
    const bystanderId = RecordId.create(`rec${'8'.repeat(16)}`)._unsafeUnwrap();
    const data = await createPGliteDb();

    try {
      await data.db.schema.createSchema(BASE_ID).execute();
      await data.db.schema
        .createTable(`${BASE_ID}.${SELF_CONDITIONAL_TABLE_ID}`)
        .addColumn('__id', 'varchar', (column) => column.primaryKey())
        .addColumn('col_comment_id', 'varchar')
        .addColumn('col_parent_comment_id', 'varchar')
        .addColumn('col_parent_text', 'varchar')
        .execute();
      await data.db
        .insertInto(`${BASE_ID}.${SELF_CONDITIONAL_TABLE_ID}`)
        .values([
          { __id: parentId.toString(), col_comment_id: 'c1', col_parent_comment_id: null },
          { __id: childId.toString(), col_comment_id: 'c1/r1', col_parent_comment_id: 'c1' },
          { __id: bystanderId.toString(), col_comment_id: 'c2', col_parent_comment_id: null },
        ])
        .execute();

      const plan: ComputedUpdatePlan = {
        baseId,
        seedTableId: table.id(),
        seedRecordIds: [childId],
        extraSeedRecords: [],
        steps: [{ tableId: table.id(), fieldIds: [lookupFieldId], level: 0 }],
        edges: [
          {
            fromFieldId: parentFieldId,
            toFieldId: lookupFieldId,
            fromTableId: table.id(),
            toTableId: table.id(),
            propagationMode: 'conditionalFiltered',
            filterCondition: {
              foreignTableId: table.id(),
              filterDto: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: commentFieldId.toString(),
                    operator: 'is',
                    value: {
                      type: 'field',
                      fieldId: parentFieldId.toString(),
                      tableId: table.id().toString(),
                    },
                  },
                ],
              },
              includeBeforeImage: false,
            },
            order: 0,
          },
        ],
        estimatedComplexity: 1,
        changeType: 'update',
        sameTableBatches: [],
      };

      await data.db.transaction().execute(async (trx) => {
        const updater = new ComputedFieldUpdater(
          createTableRepository([table]),
          createLogger(),
          trx,
          undefined,
          createTypeValidationStrategy()
        );
        const result = await updater.prepareDirtyState(plan, { actorId });
        expect(result.isOk()).toBe(true);

        const dirtyRecords = await trx
          .selectFrom('tmp_computed_dirty')
          .select('record_id')
          .where('table_id', '=', table.id().toString())
          .orderBy('record_id')
          .execute();

        // toRecordConditionSpec swaps self-table field references, so the
        // propagation predicate is s.col_parent_comment_id = t.col_comment_id:
        // the changed child marks its parent dirty. Before the fix the pruned
        // source relation only projected col_comment_id and the whole
        // propagation failed with `column s.col_parent_comment_id does not
        // exist`.
        expect(dirtyRecords.map((row) => row.record_id)).toEqual([
          parentId.toString(),
          childId.toString(),
        ]);
      });
    } finally {
      await data.db.destroy();
    }
  });

  it('uses only the current dirty frontier on later propagation passes', async () => {
    const {
      baseId,
      sourceTable,
      middleTable,
      targetTable,
      sourceNameFieldId,
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
          fieldIds: [middleLookupFieldId],
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
          fromFieldId: middleRollupFieldId,
          toFieldId: targetLookupFieldId,
          fromTableId: middleTable.id(),
          toTableId: targetTable.id(),
          linkFieldId: targetLinkFieldId,
          order: 1,
        },
      ],
      estimatedComplexity: 2,
      changeType: 'update',
      sameTableBatches: [],
    };

    const { db, driver } = createRecordingDb([], [BigInt(1), BigInt(0)]);
    const updater = new ComputedFieldUpdater(
      createTableRepository([sourceTable, middleTable, targetTable]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy()
    );

    const result = await updater.execute(plan, { actorId });
    expect(result.isOk()).toBe(true);

    const propagationQueries = driver.queries.filter(
      (query) =>
        query.sql.includes('insert into "pg_temp"."tmp_computed_dirty"') &&
        query.sql.includes(' select ')
    );
    expect(propagationQueries).toHaveLength(2);
    expect(propagationQueries[0]?.sql).toContain('"generation"');
    expect(propagationQueries[0]?.parameters).toContain(0);
    expect(propagationQueries[1]?.sql).toContain('"generation"');
    expect(propagationQueries[1]?.parameters).toContain(1);
    expect(propagationQueries[1]?.parameters).not.toContain(0);
  });

  it('propagates a multi-hop dirty frontier through successive generations', async () => {
    const {
      baseId,
      sourceTable,
      middleTable,
      targetTable,
      sourceNameFieldId,
      middleLinkFieldId,
      middleLookupFieldId,
      middleRollupFieldId,
      targetLinkFieldId,
      targetLookupFieldId,
    } = createLookupRollupCascadeTables();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();
    const sourceRecordId = RecordId.create(CASCADE_RECORD_ID)._unsafeUnwrap();
    const middleRecordId = RecordId.create(`rec${'3'.repeat(16)}`)._unsafeUnwrap();
    const targetRecordId = RecordId.create(`rec${'4'.repeat(16)}`)._unsafeUnwrap();
    const data = await createPGliteDb();

    try {
      await data.db.schema.createSchema(BASE_ID).execute();
      await data.db.schema
        .createTable(`${BASE_ID}.${CASCADE_SOURCE_TABLE_ID}`)
        .addColumn('__id', 'varchar', (column) => column.primaryKey())
        .execute();
      await data.db.schema
        .createTable(`${BASE_ID}.${CASCADE_MIDDLE_TABLE_ID}`)
        .addColumn('__id', 'varchar', (column) => column.primaryKey())
        .addColumn(`__fk_${CASCADE_MIDDLE_LINK_FIELD_ID}`, 'varchar')
        .execute();
      await data.db.schema
        .createTable(`${BASE_ID}.${CASCADE_TARGET_TABLE_ID}`)
        .addColumn('__id', 'varchar', (column) => column.primaryKey())
        .addColumn(`__fk_${CASCADE_TARGET_LINK_FIELD_ID}`, 'varchar')
        .execute();

      await data.db
        .insertInto(`${BASE_ID}.${CASCADE_SOURCE_TABLE_ID}`)
        .values({ __id: sourceRecordId.toString() })
        .execute();
      await data.db
        .insertInto(`${BASE_ID}.${CASCADE_MIDDLE_TABLE_ID}`)
        .values({
          __id: middleRecordId.toString(),
          [`__fk_${CASCADE_MIDDLE_LINK_FIELD_ID}`]: sourceRecordId.toString(),
        })
        .execute();
      await data.db
        .insertInto(`${BASE_ID}.${CASCADE_TARGET_TABLE_ID}`)
        .values({
          __id: targetRecordId.toString(),
          [`__fk_${CASCADE_TARGET_LINK_FIELD_ID}`]: middleRecordId.toString(),
        })
        .execute();

      const plan: ComputedUpdatePlan = {
        baseId,
        seedTableId: sourceTable.id(),
        seedRecordIds: [sourceRecordId],
        extraSeedRecords: [],
        steps: [
          { tableId: middleTable.id(), fieldIds: [middleLookupFieldId], level: 0 },
          { tableId: targetTable.id(), fieldIds: [targetLookupFieldId], level: 1 },
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
            fromFieldId: middleRollupFieldId,
            toFieldId: targetLookupFieldId,
            fromTableId: middleTable.id(),
            toTableId: targetTable.id(),
            linkFieldId: targetLinkFieldId,
            order: 1,
          },
        ],
        estimatedComplexity: 2,
        changeType: 'update',
        sameTableBatches: [],
      };

      await data.db.transaction().execute(async (trx) => {
        const updater = new ComputedFieldUpdater(
          createTableRepository([sourceTable, middleTable, targetTable]),
          createLogger(),
          trx,
          undefined,
          createTypeValidationStrategy()
        );
        const result = await updater.prepareDirtyState(plan, { actorId });
        expect(result.isOk()).toBe(true);

        const dirtyRecords = await trx
          .selectFrom('tmp_computed_dirty')
          .select(['table_id', 'record_id', 'generation'])
          .orderBy('generation')
          .execute();

        expect(dirtyRecords).toEqual([
          {
            table_id: sourceTable.id().toString(),
            record_id: sourceRecordId.toString(),
            generation: 0,
          },
          {
            table_id: middleTable.id().toString(),
            record_id: middleRecordId.toString(),
            generation: 1,
          },
          {
            table_id: targetTable.id().toString(),
            record_id: targetRecordId.toString(),
            generation: 2,
          },
        ]);
      });
    } finally {
      await data.db.destroy();
    }
  });

  it('keeps an insert dirty set on the new host row instead of sibling lookup targets', async () => {
    const {
      baseId,
      sourceTable,
      middleTable,
      sourceNameFieldId,
      middleLinkFieldId,
      middleLookupFieldId,
    } = createLookupRollupCascadeTables();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();
    const sourceRecordId = RecordId.create(`rec${'a'.repeat(16)}`)._unsafeUnwrap();
    const existingMiddleId = RecordId.create(`rec${'b'.repeat(16)}`)._unsafeUnwrap();
    const insertedMiddleId = RecordId.create(`rec${'c'.repeat(16)}`)._unsafeUnwrap();
    const data = await createPGliteDb();

    try {
      await data.db.schema.createSchema(BASE_ID).execute();
      await data.db.schema
        .createTable(`${BASE_ID}.${CASCADE_SOURCE_TABLE_ID}`)
        .addColumn('__id', 'varchar', (column) => column.primaryKey())
        .execute();
      await data.db.schema
        .createTable(`${BASE_ID}.${CASCADE_MIDDLE_TABLE_ID}`)
        .addColumn('__id', 'varchar', (column) => column.primaryKey())
        .addColumn(`__fk_${CASCADE_MIDDLE_LINK_FIELD_ID}`, 'varchar')
        .execute();
      await data.db
        .insertInto(`${BASE_ID}.${CASCADE_SOURCE_TABLE_ID}`)
        .values({ __id: sourceRecordId.toString() })
        .execute();
      await data.db
        .insertInto(`${BASE_ID}.${CASCADE_MIDDLE_TABLE_ID}`)
        .values([
          {
            __id: existingMiddleId.toString(),
            [`__fk_${CASCADE_MIDDLE_LINK_FIELD_ID}`]: sourceRecordId.toString(),
          },
          {
            __id: insertedMiddleId.toString(),
            [`__fk_${CASCADE_MIDDLE_LINK_FIELD_ID}`]: sourceRecordId.toString(),
          },
        ])
        .execute();

      const plan: ComputedUpdatePlan = {
        baseId,
        seedTableId: middleTable.id(),
        seedRecordIds: [insertedMiddleId],
        extraSeedRecords: [{ tableId: sourceTable.id(), recordIds: [sourceRecordId] }],
        steps: [{ tableId: middleTable.id(), fieldIds: [middleLookupFieldId], level: 0 }],
        edges: [
          {
            fromFieldId: sourceNameFieldId,
            toFieldId: middleLookupFieldId,
            fromTableId: sourceTable.id(),
            toTableId: middleTable.id(),
            linkFieldId: middleLinkFieldId,
            order: 0,
          },
        ],
        estimatedComplexity: 1,
        changeType: 'insert',
        sameTableBatches: [],
      };

      await data.db.transaction().execute(async (trx) => {
        const updater = new ComputedFieldUpdater(
          createTableRepository([sourceTable, middleTable]),
          createLogger(),
          trx,
          undefined,
          createTypeValidationStrategy()
        );
        const result = await updater.prepareDirtyState(plan, { actorId });
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap().totalDirtyRecords).toBe(1);

        const dirtyRecords = await trx
          .selectFrom('tmp_computed_dirty')
          .select(['table_id', 'record_id'])
          .orderBy('record_id')
          .execute();
        expect(dirtyRecords).toEqual([
          {
            table_id: middleTable.id().toString(),
            record_id: insertedMiddleId.toString(),
          },
        ]);
      });
    } finally {
      await data.db.destroy();
    }
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
          "sql": "drop table if exists "pg_temp"."tmp_computed_dirty"",
        },
        {
          "parameters": [],
          "sql": "create temporary table "pg_temp"."tmp_computed_dirty" (
              table_id text not null,
              record_id text not null,
              generation integer not null default 0,
              primary key (table_id, record_id)
            ) on commit drop",
        },
        {
          "parameters": [],
          "sql": "create index tmp_computed_dirty_frontier_idx on "pg_temp"."tmp_computed_dirty" (
              generation,
              table_id,
              record_id
            )",
        },
        {
          "parameters": [],
          "sql": "drop table if exists "pg_temp"."tmp_computed_before_image"",
        },
        {
          "parameters": [],
          "sql": "create temporary table "pg_temp"."tmp_computed_before_image" (
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
          "sql": "insert into "pg_temp"."tmp_computed_dirty" ("table_id", "record_id") values ($1, $2) on conflict ("table_id", "record_id") do nothing",
        },
        {
          "parameters": [
            "bseaaaaaaaaaaaaaaaa",
            "tblllllllllllllllll",
            "__fk_fldpppppppppppppppp",
          ],
          "sql": "
              SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = $1
                  AND table_name = $2
                  AND column_name = $3
              ) as exists
            ",
        },
        {
          "parameters": [
            "bseaaaaaaaaaaaaaaaa",
            "tblmmmmmmmmmmmmmmmm",
            "__fk_fldtttttttttttttttt",
          ],
          "sql": "
              SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = $1
                  AND table_name = $2
                  AND column_name = $3
              ) as exists
            ",
        },
        {
          "parameters": [
            "tblkkkkkkkkkkkkkkkk",
            0,
            "tblllllllllllllllll",
            0,
          ],
          "sql": "insert into "pg_temp"."tmp_computed_dirty" ("table_id", "record_id", "generation") select "propagated"."table_id" as "table_id", "propagated"."record_id" as "record_id", 1 as "generation" from (select distinct 'tblllllllllllllllll' as "table_id", "t"."__id" as "record_id" from "bseaaaaaaaaaaaaaaaa"."tblllllllllllllllll" as "t" inner join "pg_temp"."tmp_computed_dirty" as "d" on "d"."record_id" = "t"."__fk_fldpppppppppppppppp" where "d"."table_id" = $1 and "d"."generation" = $2 union all select distinct 'tblmmmmmmmmmmmmmmmm' as "table_id", "t"."__id" as "record_id" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join "pg_temp"."tmp_computed_dirty" as "d" on "d"."record_id" = "t"."__fk_fldtttttttttttttttt" where "d"."table_id" = $3 and "d"."generation" = $4) as "propagated" on conflict ("table_id", "record_id") do nothing",
        },
        {
          "parameters": [],
          "sql": "select "table_id" as "tableId", count(*) as "recordCount" from "pg_temp"."tmp_computed_dirty" group by "table_id"",
        },
        {
          "parameters": [
            "tblllllllllllllllll",
          ],
          "sql": "select count(*) as "count" from "pg_temp"."tmp_computed_dirty" where "table_id" = $1",
        },
        {
          "parameters": [
            "tblllllllllllllllll",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblllllllllllllllll" as "u" set "__version" = "u"."__version" + 1, "col_lookup_b" = "c"."__set_col_lookup_b"::jsonb, "col_rollup_b" = "c"."__set_col_rollup_b"::double precision from (select "c_src"."__id" as "__id", (CASE
          WHEN "c_src"."col_lookup_b" IS NULL THEN NULL::jsonb
          ELSE ("c_src"."col_lookup_b")::jsonb
        END) as "__set_col_lookup_b", CASE
          WHEN ("c_src"."col_rollup_b") IS NULL THEN NULL
          WHEN BTRIM(("c_src"."col_rollup_b")::text) ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
            THEN BTRIM(("c_src"."col_rollup_b")::text)::double precision
          ELSE NULL
        END as "__set_col_rollup_b" from (select "t"."__id" as "__id", "t"."__version" as "__version", "lat_fldpppppppppppppppp_0"."col_lookup_b" as "col_lookup_b", "lat_fldpppppppppppppppp_0"."col_rollup_b" as "col_rollup_b" from "bseaaaaaaaaaaaaaaaa"."tblllllllllllllllll" as "t" inner join "pg_temp"."tmp_computed_dirty" as "__dirty" on "t"."__id" = "__dirty"."record_id" and "__dirty"."table_id" = $1 inner join lateral (select jsonb_agg(to_jsonb("f"."col_source_name")) FILTER (WHERE "f"."col_source_name" IS NOT NULL) as "col_lookup_b", CAST(COALESCE(SUM("f"."col_source_score"), 0) AS DOUBLE PRECISION) as "col_rollup_b" from "bseaaaaaaaaaaaaaaaa"."tblkkkkkkkkkkkkkkkk" as "f" where "f"."__id" = "t"."__fk_fldpppppppppppppppp") as "lat_fldpppppppppppppppp_0" on true) as "c_src") as "c" where "u"."__id" = "c"."__id" and (("u"."col_lookup_b")::jsonb IS DISTINCT FROM ("c"."__set_col_lookup_b")::jsonb OR ("u"."col_rollup_b")::double precision IS DISTINCT FROM ("c"."__set_col_rollup_b")::double precision)",
        },
        {
          "parameters": [
            "tblmmmmmmmmmmmmmmmm",
          ],
          "sql": "select count(*) as "count" from "pg_temp"."tmp_computed_dirty" where "table_id" = $1",
        },
        {
          "parameters": [
            "tblmmmmmmmmmmmmmmmm",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "u" set "__version" = "u"."__version" + 1, "col_lookup_c" = "c"."__set_col_lookup_c"::jsonb from (select "c_src"."__id" as "__id", (CASE
          WHEN "c_src"."col_lookup_c" IS NULL THEN NULL::jsonb
          ELSE ("c_src"."col_lookup_c")::jsonb
        END) as "__set_col_lookup_c" from (select "t"."__id" as "__id", "t"."__version" as "__version", "lat_fldtttttttttttttttt_0"."col_lookup_c" as "col_lookup_c" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join "pg_temp"."tmp_computed_dirty" as "__dirty" on "t"."__id" = "__dirty"."record_id" and "__dirty"."table_id" = $1 inner join lateral (select jsonb_agg(to_jsonb("f"."col_rollup_b")) FILTER (WHERE "f"."col_rollup_b" IS NOT NULL) as "col_lookup_c" from "bseaaaaaaaaaaaaaaaa"."tblllllllllllllllll" as "f" where "f"."__id" = "t"."__fk_fldtttttttttttttttt") as "lat_fldtttttttttttttttt_0" on true) as "c_src") as "c" where "u"."__id" = "c"."__id" and (("u"."col_lookup_c")::jsonb IS DISTINCT FROM ("c"."__set_col_lookup_c")::jsonb)",
        },
      ]
    `);
  });

  it('counts dirty rows once per table in an execution and recounts on the next execution', async () => {
    const { baseId, table, plusOneFieldId, doubleFieldId } = createSameTableFormulaChainTable();
    const { table: otherTable, formulaFieldIds } = createWideSameLevelFormulaTable(1);
    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: table.id(),
      seedRecordIds: [RecordId.create(RECORD_ID)._unsafeUnwrap()],
      extraSeedRecords: [],
      steps: Array.from({ length: 8 }, (_, level) => ({
        tableId: level === 3 || level === 6 ? otherTable.id() : table.id(),
        fieldIds: [
          level === 3 || level === 6
            ? formulaFieldIds[0]
            : level % 2
              ? doubleFieldId
              : plusOneFieldId,
        ],
        level,
      })),
      edges: [],
      estimatedComplexity: 8,
      changeType: 'update',
      sameTableBatches: [],
    };
    const { db, driver } = createRecordingDb();
    const updater = new ComputedFieldUpdater(
      createTableRepository([table, otherTable]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy()
    );
    driver.dirtyCounts.push(42, 17, 43, 18);
    const { tracer, spans } = createTracerRecorder();
    const context = { actorId: ActorId.create(ACTOR_ID)._unsafeUnwrap(), tracer };
    const counts = () =>
      driver.queries.filter((query) =>
        query.sql.startsWith('select count(*) as "count" from "pg_temp"."tmp_computed_dirty"')
      );
    expect((await updater.execute(plan, context)).isOk()).toBe(true);
    expect(counts()).toHaveLength(2);
    expect(driver.queries.filter((query) => query.sql.startsWith('update '))).toHaveLength(8);
    expect((await updater.execute(plan, context)).isOk()).toBe(true);
    expect(counts()).toHaveLength(4);
    expect(
      spans
        .filter((span) => span.name === 'teable.ComputedFieldUpdater.step')
        .map((span) => span.attributes['step.dirtyRecordCount'])
    ).toEqual([42, 42, 42, 17, 42, 42, 17, 42, 43, 43, 43, 18, 43, 43, 18, 43]);
  });

  it('recounts dirty rows after oversized-cell restoration before the next step', async () => {
    const { baseId, table, plusOneFieldId, doubleFieldId } = createSameTableFormulaChainTable();
    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: table.id(),
      seedRecordIds: [RecordId.create(RECORD_ID)._unsafeUnwrap()],
      extraSeedRecords: [],
      steps: [
        { tableId: table.id(), fieldIds: [plusOneFieldId], level: 0 },
        { tableId: table.id(), fieldIds: [doubleFieldId], level: 1 },
      ],
      edges: [],
      estimatedComplexity: 2,
      changeType: 'update',
      sameTableBatches: [],
    };
    const { db, driver } = createRecordingDb([
      [{ __id: RECORD_ID, __old_version: 1, col_plus_one: 'oversized' }],
    ]);
    const updater = new ComputedFieldUpdater(
      createTableRepository([table]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy(),
      new TableDataSafetyLimitComposer([
        new StaticTableDataSafetyLimitPlugin({ computed: { maxComputedCellValueBytes: 1 } }),
      ])
    );
    driver.dirtyCounts.push(42, 43);
    const { tracer, spans } = createTracerRecorder();
    const result = await updater.execute(
      plan,
      { actorId: ActorId.create(ACTOR_ID)._unsafeUnwrap(), tracer },
      undefined,
      {
        collectChanges: true,
        isolateOversizedComputedCells: true,
      }
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().rejectedCells).toHaveLength(1);
    expect(
      spans
        .filter((span) => span.name === 'teable.ComputedFieldUpdater.step')
        .map((span) => span.attributes['step.dirtyRecordCount'])
    ).toEqual([42, 43]);
    expect(
      driver.queries.filter((query) =>
        query.sql.startsWith('select count(*) as "count" from "pg_temp"."tmp_computed_dirty"')
      )
    ).toHaveLength(2);
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
      // The last CTE already has the record ID and all output columns. Project
      // directly from it instead of joining the base table a second time.
      expect(query.sql).toMatch(/from "level_1"\) as "c_src"/i);
      expect(query.sql).not.toMatch(/join "level_1" on "u"\."__id"/i);
      expect(query.sql).toContain(
        'AS "__record_ids"("__id") ON "t"."__id" = "__record_ids"."__id"'
      );
      expect(query.sql).not.toContain('from "level_0", "level_1"');
    }
  });

  it('chunks JSON-backed same-table formula batches below the dirty threshold', async () => {
    const { baseId, table, plusOneFieldId, doubleFieldId } = createSameTableFormulaChainTable();
    for (const fieldId of [plusOneFieldId, doubleFieldId]) {
      table
        .getField((field) => field.id().equals(fieldId))
        ._unsafeUnwrap()
        .setDbFieldType(DbFieldType.rehydrate('JSON')._unsafeUnwrap())
        ._unsafeUnwrap();
    }

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: table.id(),
      seedRecordIds: createSequentialRecordIds(265),
      extraSeedRecords: [],
      steps: [
        { tableId: table.id(), fieldIds: [plusOneFieldId], level: 0 },
        { tableId: table.id(), fieldIds: [doubleFieldId], level: 1 },
      ],
      edges: [],
      estimatedComplexity: 2,
      changeType: 'update',
      sameTableBatches: [
        {
          tableId: table.id(),
          steps: [
            { tableId: table.id(), fieldIds: [plusOneFieldId], level: 0 },
            { tableId: table.id(), fieldIds: [doubleFieldId], level: 1 },
          ],
          minLevel: 0,
          maxLevel: 1,
        },
      ],
    };

    const { db, driver } = createRecordingDb();
    const updater = new ComputedFieldUpdater(
      createTableRepository([table]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy()
    );
    const updaterInternal = updater as unknown as {
      getDirtyCountForTable: () => Promise<number>;
      getDirtyRecordIdChunks: (
        db: unknown,
        tableId: unknown,
        chunkSize?: number,
        includeSingleton?: boolean
      ) => Promise<ReadonlyArray<ReadonlyArray<string>>>;
    };
    updaterInternal.getDirtyCountForTable = async () => 265;
    updaterInternal.getDirtyRecordIdChunks = async (_db, _tableId, chunkSize, includeSingleton) => {
      expect(chunkSize).toBe(25);
      expect(includeSingleton).toBe(true);
      return Array.from({ length: 11 }, (_, chunkIndex) =>
        Array.from(
          { length: chunkIndex === 10 ? 15 : 25 },
          (_, index) => `rec${(chunkIndex * 25 + index).toString().padStart(16, '0')}`
        )
      );
    };

    const result = await updater.execute(plan, {
      actorId: ActorId.create(ACTOR_ID)._unsafeUnwrap(),
    });
    expect(result.isOk()).toBe(true);

    const updateQueries = driver.queries.filter((query) =>
      query.sql.startsWith('update "bseaaaaaaaaaaaaaaaa"."tblzzzzzzzzzzzzzzzz" as "u"')
    );
    expect(updateQueries).toHaveLength(11);
    for (const query of updateQueries) {
      expect(query.sql).toContain('AS "__record_ids"("__id")');
      expect(query.sql).toContain('"level_0" AS MATERIALIZED');
      expect(query.sql).toContain('"level_1" AS MATERIALIZED');
    }
  });

  it('chunks lateral lookup updates when dirty records exceed threshold', async () => {
    const {
      baseId,
      sourceTable,
      middleTable,
      middleLinkFieldId,
      middleLookupFieldId,
      sourceNameFieldId,
    } = createLookupRollupCascadeTables();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();
    const seedRecordIds = createSequentialRecordIds(1001);

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: sourceTable.id(),
      seedRecordIds,
      extraSeedRecords: [],
      steps: [
        {
          tableId: middleTable.id(),
          fieldIds: [middleLookupFieldId],
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
      ],
      estimatedComplexity: 1,
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

    const updateQueries = driver.queries.filter(
      (query) => query.sql.startsWith('update ') && query.sql.includes(' as "u"')
    );

    // Three dirty-id chunks → three lateral UPDATE…FROM statements.
    expect(updateQueries.length).toBeGreaterThanOrEqual(3);
    const lateralUpdates = updateQueries.filter((query) =>
      query.sql.includes('inner join lateral')
    );
    expect(lateralUpdates).toHaveLength(3);
    const expectedChunkSizes = [500, 500, 1];
    for (const [index, query] of lateralUpdates.entries()) {
      expect(query.sql).toContain('inner join "pg_temp"."tmp_computed_dirty" as "__dirty"');
      expect(query.sql).toMatch(/"__dirty"\."record_id" = any\(\$\d+::text\[\]\)/i);
      const recordIdParameters = query.parameters.filter(Array.isArray);
      expect(recordIdParameters).toHaveLength(1);
      expect(recordIdParameters[0]).toHaveLength(expectedChunkSizes[index]);
    }
  });

  it('executes distinct-host-key conditional aggregates without record-id chunks', async () => {
    const { baseId, sourceTable, hostTable, conditionalLookupFieldId } =
      createConditionalGroupLookupTables();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();
    const seedRecordIds = createSequentialRecordIds(1001);
    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: sourceTable.id(),
      seedRecordIds,
      extraSeedRecords: [],
      steps: [
        {
          tableId: hostTable.id(),
          fieldIds: [conditionalLookupFieldId],
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
      createTableRepository([sourceTable, hostTable]),
      createLogger(),
      db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy()
    );
    const updaterInternal = updater as unknown as {
      getDirtyCountForTable: () => Promise<number>;
      getDirtyRecordIdChunks: () => Promise<ReadonlyArray<ReadonlyArray<string>>>;
    };
    const recordIdChunks = [
      Array.from({ length: 500 }, (_, index) => `rec${index.toString().padStart(16, '0')}`),
      Array.from({ length: 500 }, (_, index) => `rec${(index + 500).toString().padStart(16, '0')}`),
      [`rec${'1000'.padStart(16, '0')}`],
    ];
    updaterInternal.getDirtyCountForTable = async () => 1001;
    updaterInternal.getDirtyRecordIdChunks = async () => recordIdChunks;

    const result = await updater.execute(plan, { actorId });
    expect(result.isOk()).toBe(true);

    const conditionalUpdates = driver.queries.filter(
      (query) => query.sql.startsWith('update ') && query.sql.includes('"__host_key"')
    );
    expect(conditionalUpdates).toHaveLength(1);
    expect(conditionalUpdates[0]?.sql).not.toMatch(
      /"__dirty"\."record_id" = any\(\$\d+::text\[\]\)/i
    );
    const cardinalityQuery = driver.queries.find((query) => query.sql.includes('as "__keys"'));
    expect(cardinalityQuery?.sql).toContain('select distinct "h"."col_lookup_group" as "__key"');
    expect(cardinalityQuery?.parameters).toEqual([hostTable.id().toString(), 5001]);

    const fallbackDb = createRecordingDb();
    const fallbackUpdater = new ComputedFieldUpdater(
      createTableRepository([sourceTable, hostTable]),
      createLogger(),
      fallbackDb.db as unknown as Kysely<V1TeableDatabase>,
      undefined,
      createTypeValidationStrategy()
    );
    const fallbackInternal = fallbackUpdater as unknown as {
      getDirtyCountForTable: () => Promise<number>;
      getDirtyRecordIdChunks: () => Promise<ReadonlyArray<ReadonlyArray<string>>>;
      hasBoundedDistinctHostKeys: () => Promise<unknown>;
    };
    fallbackInternal.getDirtyCountForTable = async () => 1001;
    fallbackInternal.getDirtyRecordIdChunks = async () => recordIdChunks;
    fallbackInternal.hasBoundedDistinctHostKeys = async () => ok(false);

    const fallbackResult = await fallbackUpdater.execute(plan, { actorId });
    expect(fallbackResult.isOk()).toBe(true);
    const fallbackUpdates = fallbackDb.driver.queries.filter(
      (query) => query.sql.startsWith('update ') && query.sql.includes('"__host_key"')
    );
    expect(fallbackUpdates).toHaveLength(3);
    for (const query of fallbackUpdates) {
      expect(query.sql).toMatch(/"__dirty"\."record_id" = any\(\$\d+::text\[\]\)/i);
    }
  });
});
