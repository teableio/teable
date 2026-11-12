import {
  ActorId,
  buildRecordConditionSpec,
  DefaultTableMapper,
  NoopLogger,
  RecordQueryPluginRunner,
  type IExecutionContext,
  type IRecordQueryPlugin,
  type ITablePersistenceDTO,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import { DataQueryBinding, DataQueryDefinition, DataQueryService } from '@teable/v2-data-query';
import { sql } from 'kysely';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';
import { PostgresDataQueryExplainer } from './PostgresDataQueryExplainer';

/**
 * Adapter boundaries that the public service already covers must also hold when
 * the host calls the executor or explainer directly.
 *
 * - A conditional field mask is per-row. A hidden user identity must be NULL,
 *   while the visible row keeps the __created_by/__last_modified_by actor-id
 *   fallback used when the stored snapshot is NULL.
 * - Without a supplied binding the adapter prepares one itself, so it must use
 *   the caller's source budget rather than the lenient default.
 */

const mapper = new DefaultTableMapper();

const createTableDto = (
  id: string,
  fields: ITablePersistenceDTO['fields'],
  primaryFieldId: string,
  dbTableName: string
): ITablePersistenceDTO => ({
  id,
  baseId: `bse${'b'.repeat(16)}`,
  name: 'Formula boundaries',
  dbTableName,
  primaryFieldId,
  fields,
  views: [{ id: `viw${'b'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

describe('conditional user identity masks with actor fallback', () => {
  const tableId = `tbl${'m'.repeat(16)}`;
  const titleId = `fld${'t'.repeat(16)}`;
  const createdById = `fld${'c'.repeat(16)}`;
  const lastModifiedById = `fld${'l'.repeat(16)}`;
  const physicalTable = 'Boundary "masks';
  const context = { actorId: ActorId.create('mask-reader')._unsafeUnwrap() };
  const tableDto = createTableDto(
    tableId,
    [
      { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
      {
        id: createdById,
        name: 'Created by',
        type: 'createdBy',
        dbFieldName: 'created_by_snapshot',
      },
      {
        id: lastModifiedById,
        name: 'Last modified by',
        type: 'lastModifiedBy',
        dbFieldName: 'last_modified_by_snapshot',
      },
    ],
    titleId,
    `public.${physicalTable}`
  );

  let database: PGliteTestDb;
  let table: Table;

  const scopedService = (scope: RecordQueryPluginScope) => {
    const plugin: IRecordQueryPlugin = {
      name: 'user-identity-masks',
      supports: () => true,
      scope: () => ok(scope),
    };
    return new DataQueryService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner([plugin], new NoopLogger()),
      new PostgresDataQueryExecutor(database.db)
    );
  };

  beforeEach(async () => {
    database = await createPGliteDb();
    table = mapper.toDomain(tableDto)._unsafeUnwrap();
    const physical = sql.id('public', physicalTable);
    await sql`create table ${physical} (
      __id text primary key, title text,
      created_by_snapshot jsonb, last_modified_by_snapshot jsonb,
      __created_by text, __last_modified_by text,
      __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz, __auto_number bigint,
      __version integer default 1
    )`.execute(database.db);
    // Both stored snapshots are NULL: the identity can only come from the
    // system actor columns, which the mask must gate row by row.
    for (const [id, title, createdActor, modifiedActor] of [
      ['recVisible', 'Alpha', 'USR-CREATED-A', 'USR-MODIFIED-A'],
      ['recHidden', 'Beta', 'USR-CREATED-B', 'USR-MODIFIED-B'],
    ]) {
      await sql`insert into ${physical} (__id, title, __created_by, __last_modified_by)
        values (${id}, ${title}, ${createdActor}, ${modifiedActor})`.execute(database.db);
    }
  });

  afterEach(async () => {
    await database.db.destroy();
  });

  it('keeps a visible actor fallback and nulls the hidden row for both user fields', async () => {
    const visibleWhen = buildRecordConditionSpec(table, {
      fieldId: titleId,
      operator: 'is',
      value: 'Alpha',
    })._unsafeUnwrap();
    const service = scopedService({
      fieldMasks: [
        { fieldId: createdById, visibleWhen },
        { fieldId: lastModifiedById, visibleWhen },
      ],
    });
    const definition = DataQueryDefinition.create({
      version: 3,
      tableId,
      kind: 'records',
      select: [
        { system: 'id', alias: 'id' },
        {
          expr: {
            type: 'formula',
            formula: 'LOWER({creator})',
            references: { creator: { type: 'field', fieldId: createdById } },
          },
          alias: 'creator',
        },
        {
          expr: {
            type: 'formula',
            formula: 'LOWER({editor})',
            references: { editor: { type: 'field', fieldId: lastModifiedById } },
          },
          alias: 'editor',
        },
      ],
    })._unsafeUnwrap();
    const result = await service.execute(context, definition);
    if (result.isErr()) throw new Error(`Masked execution: ${JSON.stringify(result.error)}`);

    const rowsById = new Map(result.value.rows.map((row) => [row.id, row] as const));
    expect(result.value.rows).toHaveLength(2);
    expect(rowsById.get('recVisible')).toEqual({
      id: 'recVisible',
      creator: 'usr-created-a',
      editor: 'usr-modified-a',
    });
    expect(rowsById.get('recHidden')).toEqual({
      id: 'recHidden',
      creator: null,
      editor: null,
    });
  });
});

describe('formula source budget without a supplied binding', () => {
  const tableId = `tbl${'s'.repeat(16)}`;
  const titleId = `fld${'h'.repeat(16)}`;
  const physicalTable = 'Boundary "budget';
  const tableDto = createTableDto(
    tableId,
    [{ id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' }],
    titleId,
    `public.${physicalTable}`
  );
  /** Deep enough for the default 64-node source budget, shallow for this context. */
  const nestedSource = 'ABS(ABS(ABS(ABS(1))))';
  const strictContext: IExecutionContext = {
    actorId: ActorId.create('budget-reader')._unsafeUnwrap(),
    config: { formulaSourceBudget: { astDepth: 3, visitedNodes: 100, policyVersion: 1 } },
  };

  let database: PGliteTestDb;
  let table: Table;

  beforeEach(async () => {
    database = await createPGliteDb();
    table = mapper.toDomain(tableDto)._unsafeUnwrap();
    const physical = sql.id('public', physicalTable);
    await sql`create table ${physical} (
      __id text primary key, title text,
      __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz, __auto_number bigint,
      __version integer default 1
    )`.execute(database.db);
    await sql`insert into ${physical} (__id, title) values ('recBudget', 'Boundary')`.execute(
      database.db
    );
  });

  afterEach(async () => {
    await database.db.destroy();
  });

  it('rejects a deeper source in compile, execute and explain before any database work', async () => {
    const definition = DataQueryDefinition.create({
      version: 3,
      tableId,
      kind: 'records',
      select: [
        { system: 'id', alias: 'id' },
        {
          expr: { type: 'formula', formula: nestedSource, references: {} },
          alias: 'nested',
        },
      ],
    })._unsafeUnwrap();
    const query = definition.bind({})._unsafeUnwrap();
    // The lenient default budget accepts the same source; only the caller's
    // stricter context may reject it, and only at the adapter boundary.
    DataQueryBinding.prepare(definition, table)._unsafeUnwrap();

    const executor = new PostgresDataQueryExecutor(database.db);
    const explainer = new PostgresDataQueryExplainer(database.db);
    const transaction = vi.spyOn(database.db, 'transaction');
    const executeQuery = vi.spyOn(database.db, 'executeQuery');

    const compiled = executor.compile(strictContext, table, query, {});
    expect(compiled.isErr()).toBe(true);
    expect(compiled._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_depth_max');

    const executed = await executor.execute(strictContext, table, query, {});
    expect(executed.isErr()).toBe(true);
    expect(executed._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_depth_max');

    const explained = await explainer.explain(strictContext, table, query, {});
    expect(explained.isErr()).toBe(true);
    expect(explained._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_depth_max');

    expect(transaction).not.toHaveBeenCalled();
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('evaluates zero-reference RECORD_ID() against the queried root record', async () => {
    const definition = DataQueryDefinition.create({
      version: 3,
      tableId,
      kind: 'records',
      select: [
        { system: 'id', alias: 'id' },
        { expr: { type: 'formula', formula: 'RECORD_ID()', references: {} }, alias: 'formulaId' },
      ],
    })._unsafeUnwrap();
    const result = await new PostgresDataQueryExecutor(database.db).execute(
      { actorId: ActorId.create('formula-id-reader')._unsafeUnwrap() },
      table,
      definition.bind({})._unsafeUnwrap(),
      {}
    );
    expect(result._unsafeUnwrap().rows).toEqual([{ id: 'recBudget', formulaId: 'recBudget' }]);
  });
  it('evaluates zero-reference record system functions against the queried root row', async () => {
    await sql`update ${sql.id('public', physicalTable)}
      set __auto_number = 7, __created_time = '2026-01-01T00:00:00Z'
      where __id = 'recBudget'`.execute(database.db);
    const definition = DataQueryDefinition.create({
      version: 3,
      tableId,
      kind: 'records',
      select: [
        { system: 'id', alias: 'id' },
        {
          expr: { type: 'formula', formula: 'AUTO_NUMBER()', references: {} },
          alias: 'autoNumber',
        },
        {
          expr: { type: 'formula', formula: 'CREATED_TIME()', references: {} },
          alias: 'createdTime',
        },
      ],
    })._unsafeUnwrap();
    const result = await new PostgresDataQueryExecutor(database.db).execute(
      { actorId: ActorId.create('formula-id-reader')._unsafeUnwrap() },
      table,
      definition.bind({})._unsafeUnwrap(),
      {}
    );
    const [row] = result._unsafeUnwrap().rows;
    expect(row).toMatchObject({ id: 'recBudget', autoNumber: 7 });
    expect(new Date(row.createdTime as string).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
