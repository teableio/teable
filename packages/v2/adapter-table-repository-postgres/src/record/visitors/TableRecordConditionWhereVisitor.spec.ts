/* eslint-disable @typescript-eslint/naming-convention */
import {
  BaseId,
  CheckboxConditionSpec,
  DateTimeFormatting,
  DbFieldName,
  type Field,
  FieldId,
  FieldName,
  IncomingLinkCandidateSpec,
  IncomingLinkSelectedSpec,
  LinkFieldConfig,
  RecordByIdSpec,
  RecordByIdsSpec,
  RecordId,
  RecordConditionDateValue,
  RecordConditionFieldReferenceValue,
  LongTextConditionSpec,
  NumberConditionSpec,
  RecordConditionLiteralListValue,
  RecordConditionLiteralValue,
  SingleLineTextConditionSpec,
  SingleSelectConditionSpec,
  Table,
  TableId,
  TableName,
  UserConditionSpec,
  UserMultiplicity,
} from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
  type Expression,
  type SqlBool,
} from 'kysely';
import { describe, expect, test } from 'vitest';

import { TableRecordConditionWhereVisitor } from './TableRecordConditionWhereVisitor';

// ============================================================================
// Utilities
// ============================================================================

const createTestDb = () =>
  new Kysely<Record<string, Record<string, unknown>>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

/**
 * Compile a RawBuilder WHERE condition to a SQL string using a dummy select.
 * Returns { sql, parameters } so we can snapshot both.
 */
const compileWhere = (db: ReturnType<typeof createTestDb>, condRaw: unknown) => {
  const compiled = db
    .selectFrom('test_table as t')
    .selectAll()
    .where(condRaw as Expression<SqlBool>)
    .compile();
  // Strip the SELECT prefix so we only snapshot the WHERE part
  const idx = compiled.sql.indexOf(' where ');
  const whereSql = idx >= 0 ? compiled.sql.slice(idx + 7) : compiled.sql;
  return { sql: whereSql, parameters: compiled.parameters };
};

// ============================================================================
// Table fixtures
// ============================================================================

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'t'.repeat(16)}`;
const UTC_DATE_ONLY = DateTimeFormatting.create({
  date: 'YYYY-MM-DD',
  time: 'None',
  timeZone: 'utc',
})._unsafeUnwrap();
const UTC_DATE_TIME = DateTimeFormatting.create({
  date: 'YYYY-MM-DD',
  time: 'HH:mm',
  timeZone: 'utc',
})._unsafeUnwrap();
const SHANGHAI_DATE_ONLY = DateTimeFormatting.create({
  date: 'YYYY-MM-DD',
  time: 'None',
  timeZone: 'Asia/Shanghai',
})._unsafeUnwrap();

const createTestTable = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
  const foreignTableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
  const singleLinkFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
  const multipleLinkFieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();
  const lookupFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
  const singleLinkConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
    fkHostTableName: 'public.link_single',
    selfKeyName: '__self_id',
    foreignKeyName: '__foreign_id',
  })._unsafeUnwrap();
  const multipleLinkConfig = LinkFieldConfig.create({
    relationship: 'manyMany',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
    fkHostTableName: 'public.link_multiple',
    selfKeyName: '__self_id',
    foreignKeyName: '__foreign_id',
  })._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('FilterTestTable')._unsafeUnwrap());

  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.field().number().withName(FieldName.create('Score')._unsafeUnwrap()).done();
  builder.field().singleSelect().withName(FieldName.create('Status')._unsafeUnwrap()).done();
  builder.field().checkbox().withName(FieldName.create('Done')._unsafeUnwrap()).done();
  builder.field().longText().withName(FieldName.create('Notes')._unsafeUnwrap()).done();
  builder
    .field()
    .date()
    .withName(FieldName.create('Due Date')._unsafeUnwrap())
    .withFormatting(UTC_DATE_ONLY)
    .done();
  builder
    .field()
    .date()
    .withName(FieldName.create('Cutoff Date')._unsafeUnwrap())
    .withFormatting(UTC_DATE_ONLY)
    .done();
  builder
    .field()
    .createdTime()
    .withName(FieldName.create('Created At')._unsafeUnwrap())
    .withFormatting(SHANGHAI_DATE_ONLY)
    .done();
  builder
    .field()
    .date()
    .withName(FieldName.create('Due At')._unsafeUnwrap())
    .withFormatting(UTC_DATE_TIME)
    .done();
  builder.field().multipleSelect().withName(FieldName.create('Labels')._unsafeUnwrap()).done();
  builder.field().attachment().withName(FieldName.create('Files')._unsafeUnwrap()).done();
  builder.field().user().withName(FieldName.create('Owner')._unsafeUnwrap()).done();
  builder
    .field()
    .user()
    .withName(FieldName.create('Watchers')._unsafeUnwrap())
    .withMultiplicity(UserMultiplicity.multiple())
    .done();
  builder
    .field()
    .link()
    .withId(singleLinkFieldId)
    .withName(FieldName.create('Tag')._unsafeUnwrap())
    .withConfig(singleLinkConfig)
    .done();
  builder
    .field()
    .link()
    .withId(multipleLinkFieldId)
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withConfig(multipleLinkConfig)
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  const fields = table.getFields();
  fields[0].setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())._unsafeUnwrap();
  fields[1].setDbFieldName(DbFieldName.rehydrate('col_score')._unsafeUnwrap())._unsafeUnwrap();
  fields[2].setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())._unsafeUnwrap();
  fields[3].setDbFieldName(DbFieldName.rehydrate('col_done')._unsafeUnwrap())._unsafeUnwrap();
  fields[4].setDbFieldName(DbFieldName.rehydrate('col_notes')._unsafeUnwrap())._unsafeUnwrap();
  fields[5].setDbFieldName(DbFieldName.rehydrate('col_due_date')._unsafeUnwrap())._unsafeUnwrap();
  fields[6]
    .setDbFieldName(DbFieldName.rehydrate('col_cutoff_date')._unsafeUnwrap())
    ._unsafeUnwrap();
  fields[7]
    .setDbFieldName(DbFieldName.rehydrate('col_created_time')._unsafeUnwrap())
    ._unsafeUnwrap();
  fields[8].setDbFieldName(DbFieldName.rehydrate('col_due_at')._unsafeUnwrap())._unsafeUnwrap();
  fields[9].setDbFieldName(DbFieldName.rehydrate('col_labels')._unsafeUnwrap())._unsafeUnwrap();
  fields[10].setDbFieldName(DbFieldName.rehydrate('col_files')._unsafeUnwrap())._unsafeUnwrap();
  fields[11].setDbFieldName(DbFieldName.rehydrate('col_owner')._unsafeUnwrap())._unsafeUnwrap();
  fields[12].setDbFieldName(DbFieldName.rehydrate('col_watchers')._unsafeUnwrap())._unsafeUnwrap();
  fields[13].setDbFieldName(DbFieldName.rehydrate('col_tag')._unsafeUnwrap())._unsafeUnwrap();
  fields[14].setDbFieldName(DbFieldName.rehydrate('col_tags')._unsafeUnwrap())._unsafeUnwrap();

  return {
    table,
    nameField: fields[0],
    scoreField: fields[1],
    statusField: fields[2],
    doneField: fields[3],
    notesField: fields[4],
    dueDateField: fields[5],
    cutoffDateField: fields[6],
    createdTimeField: fields[7],
    dueAtField: fields[8],
    labelsField: fields[9],
    filesField: fields[10],
    ownerField: fields[11],
    watchersField: fields[12],
    tagField: fields[13],
    tagsField: fields[14],
  };
};

/**
 * Helper: create a spec, run it through the visitor, and compile the WHERE SQL.
 */
const buildWhereFor = (
  db: ReturnType<typeof createTestDb>,
  spec: { accept: (v: TableRecordConditionWhereVisitor) => { isErr: () => boolean } },
  options?: { tableAlias?: string; hostTableAlias?: string }
) => {
  const visitor = new TableRecordConditionWhereVisitor({ tableAlias: 't', ...options });
  const acceptResult = spec.accept(visitor);
  expect(acceptResult.isErr()).toBe(false);
  const whereResult = visitor.where();
  expect(whereResult.isOk()).toBe(true);
  if (whereResult.isErr()) throw new Error('where() failed');
  return compileWhere(db, whereResult.value);
};

const buildWhereForDirectMethod = (
  db: ReturnType<typeof createTestDb>,
  method: string,
  field: Field,
  value?: unknown,
  options?: { tableAlias?: string; hostTableAlias?: string }
) => {
  const visitor = new TableRecordConditionWhereVisitor({ tableAlias: 't', ...options });
  const visit = (visitor as unknown as Record<string, (spec: unknown) => { isErr: () => boolean }>)[
    method
  ];
  expect(typeof visit).toBe('function');
  const acceptResult = visit.call(visitor, {
    field: () => field,
    value: () => value,
  });
  expect(acceptResult.isErr()).toBe(false);
  const whereResult = visitor.where();
  expect(whereResult.isOk()).toBe(true);
  if (whereResult.isErr()) throw new Error('where() failed');
  return compileWhere(db, whereResult.value);
};

const createUserReferenceFields = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'u'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('UserReferenceFilterTable')._unsafeUnwrap());

  builder.field().user().withName(FieldName.create('Owner')._unsafeUnwrap()).done();
  builder
    .field()
    .user()
    .withName(FieldName.create('Assignees')._unsafeUnwrap())
    .withMultiplicity(UserMultiplicity.multiple())
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  const ownerField = table.getField((field) => field.name().toString() === 'Owner')._unsafeUnwrap();
  const assigneesField = table
    .getField((field) => field.name().toString() === 'Assignees')
    ._unsafeUnwrap();

  ownerField.setDbFieldName(DbFieldName.rehydrate('col_owner')._unsafeUnwrap())._unsafeUnwrap();
  assigneesField
    .setDbFieldName(DbFieldName.rehydrate('col_assignees')._unsafeUnwrap())
    ._unsafeUnwrap();

  return { ownerField, assigneesField };
};

const createLinkTitleReferenceFields = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'l'.repeat(16)}`)._unsafeUnwrap();
  const foreignTableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
  const lookupFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
    fkHostTableName: 'link_relations',
    selfKeyName: '__self_id',
    foreignKeyName: '__foreign_id',
  })._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('LinkTitleFilterTable')._unsafeUnwrap());

  builder
    .field()
    .link()
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withConfig(linkConfig)
    .done();
  builder.field().singleLineText().withName(FieldName.create('TagName')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  const linkField = table.getField((field) => field.name().toString() === 'Tags')._unsafeUnwrap();
  const tagNameField = table
    .getField((field) => field.name().toString() === 'TagName')
    ._unsafeUnwrap();

  linkField.setDbFieldName(DbFieldName.rehydrate('col_tags')._unsafeUnwrap())._unsafeUnwrap();
  tagNameField
    .setDbFieldName(DbFieldName.rehydrate('col_tag_name')._unsafeUnwrap())
    ._unsafeUnwrap();

  return { linkField, tagNameField };
};

// ============================================================================
// Tests
// ============================================================================

describe('TableRecordConditionWhereVisitor NULL handling', () => {
  const db = createTestDb();
  const {
    nameField,
    scoreField,
    statusField,
    doneField,
    notesField,
    dueDateField,
    cutoffDateField,
    createdTimeField,
    dueAtField,
  } = createTestTable();

  // ---- isNot ----

  describe('isNot operator', () => {
    test('text isNot uses IS DISTINCT FROM (includes NULL rows)', () => {
      const value = RecordConditionLiteralValue.create('hello')._unsafeUnwrap();
      const spec = SingleLineTextConditionSpec.create(nameField, 'isNot', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_name" is distinct from $1"`);
      expect(parameters).toEqual(['hello']);
    });

    test('number isNot uses IS DISTINCT FROM (includes NULL rows)', () => {
      const value = RecordConditionLiteralValue.create(42)._unsafeUnwrap();
      const spec = NumberConditionSpec.create(scoreField, 'isNot', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_score" is distinct from $1"`);
      expect(parameters).toEqual([42]);
    });

    test('singleSelect isNot uses IS DISTINCT FROM (includes NULL rows)', () => {
      const value = RecordConditionLiteralValue.create('Closed')._unsafeUnwrap();
      const spec = SingleSelectConditionSpec.create(statusField, 'isNot', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_status" is distinct from $1"`);
      expect(parameters).toEqual(['Closed']);
    });
  });

  // ---- doesNotContain ----

  describe('doesNotContain operator', () => {
    test('text doesNotContain uses COALESCE (includes NULL rows)', () => {
      const value = RecordConditionLiteralValue.create('test')._unsafeUnwrap();
      const spec = SingleLineTextConditionSpec.create(nameField, 'doesNotContain', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`"coalesce("t"."col_name", '') not ilike $1 escape '\\'"`);
      expect(parameters).toEqual(['%test%']);
    });

    test('longText doesNotContain uses COALESCE (includes NULL rows)', () => {
      const value = RecordConditionLiteralValue.create('note')._unsafeUnwrap();
      const spec = LongTextConditionSpec.create(notesField, 'doesNotContain', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`"coalesce("t"."col_notes", '') not ilike $1 escape '\\'"`);
      expect(parameters).toEqual(['%note%']);
    });

    test('text contains does NOT use COALESCE (standard LIKE)', () => {
      const value = RecordConditionLiteralValue.create('test')._unsafeUnwrap();
      const spec = SingleLineTextConditionSpec.create(nameField, 'contains', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_name" ilike $1 escape '\\'"`);
      expect(parameters).toEqual(['%test%']);
    });
  });

  // ---- isNoneOf ----

  describe('isNoneOf operator', () => {
    test('singleSelect isNoneOf uses COALESCE (includes NULL rows)', () => {
      const value = RecordConditionLiteralListValue.create(['Closed', 'Archived'])._unsafeUnwrap();
      const spec = SingleSelectConditionSpec.create(statusField, 'isNoneOf', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`"coalesce("t"."col_status", '') not in ($1, $2)"`);
      expect(parameters).toEqual(['Closed', 'Archived']);
    });

    test('singleSelect isAnyOf does NOT use COALESCE (standard IN)', () => {
      const value = RecordConditionLiteralListValue.create(['Open', 'Active'])._unsafeUnwrap();
      const spec = SingleSelectConditionSpec.create(statusField, 'isAnyOf', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_status" in ($1, $2)"`);
      expect(parameters).toEqual(['Open', 'Active']);
    });
  });

  // ---- checkbox is(false) ----

  describe('checkbox is operator', () => {
    test('checkbox is(false) includes NULL rows (unchecked checkboxes)', () => {
      const value = RecordConditionLiteralValue.create(false)._unsafeUnwrap();
      const spec = CheckboxConditionSpec.create(doneField, 'is', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`"("t"."col_done" = false or "t"."col_done" is null)"`);
      expect(parameters).toEqual([]);
    });

    test('checkbox is(true) uses standard equality (no NULL special handling)', () => {
      const value = RecordConditionLiteralValue.create(true)._unsafeUnwrap();
      const spec = CheckboxConditionSpec.create(doneField, 'is', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_done" = $1"`);
      expect(parameters).toEqual([true]);
    });
  });

  // ---- is (positive — no NULL special handling expected) ----

  describe('is operator (positive)', () => {
    test('text is uses standard equality', () => {
      const value = RecordConditionLiteralValue.create('hello')._unsafeUnwrap();
      const spec = SingleLineTextConditionSpec.create(nameField, 'is', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_name" = $1"`);
      expect(parameters).toEqual(['hello']);
    });

    test('number is uses standard equality', () => {
      const value = RecordConditionLiteralValue.create(100)._unsafeUnwrap();
      const spec = NumberConditionSpec.create(scoreField, 'is', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_score" = $1"`);
      expect(parameters).toEqual([100]);
    });
  });

  describe('date field reference comparisons', () => {
    test('incompatible cross-table field reference comparison short-circuits to false', () => {
      const value = RecordConditionFieldReferenceValue.create(nameField)._unsafeUnwrap();
      const spec = NumberConditionSpec.create(scoreField, 'is', value);

      const visitor = new TableRecordConditionWhereVisitor({
        tableAlias: 'f',
        hostTableAlias: 't',
      });
      const visitResult = spec.accept(visitor);
      expect(visitResult.isOk()).toBe(true);
      const where = visitor.where();
      expect(where.isOk()).toBe(true);
      if (where.isErr()) return;

      const { sql, parameters } = compileWhere(db, where.value);
      expect(sql).toMatchInlineSnapshot(`"1 = 0"`);
      expect(parameters).toEqual([]);
    });

    test('incompatible cross-table field reference isNot comparison short-circuits to true', () => {
      const value = RecordConditionFieldReferenceValue.create(nameField)._unsafeUnwrap();
      const spec = NumberConditionSpec.create(scoreField, 'isNot', value);

      const visitor = new TableRecordConditionWhereVisitor({
        tableAlias: 'f',
        hostTableAlias: 't',
      });
      const visitResult = spec.accept(visitor);
      expect(visitResult.isOk()).toBe(true);
      const where = visitor.where();
      expect(where.isOk()).toBe(true);
      if (where.isErr()) return;

      const { sql, parameters } = compileWhere(db, where.value);
      expect(sql).toMatchInlineSnapshot(`"1 = 1"`);
      expect(parameters).toEqual([]);
    });

    test('link title comparison to host text stays on the title-matching path', () => {
      const { linkField, tagNameField } = createLinkTitleReferenceFields();
      const value = RecordConditionFieldReferenceValue.create(tagNameField)._unsafeUnwrap();
      const spec = linkField.spec().create({ operator: 'is', value });
      expect(spec.isOk()).toBe(true);
      if (spec.isErr()) return;

      const visitor = new TableRecordConditionWhereVisitor({
        tableAlias: 'f',
        hostTableAlias: 't',
      });
      const visitResult = spec.value.accept(visitor);
      expect(visitResult.isOk()).toBe(true);
      const where = visitor.where();
      expect(where.isOk()).toBe(true);
      if (where.isErr()) return;

      const { sql, parameters } = compileWhere(db, where.value);
      expect(sql).toContain(`__link->>'title' = ("t"."col_tag_name")::text`);
      expect(parameters).toEqual([]);
    });

    test('date isBefore with field reference uses host table alias', () => {
      const value = RecordConditionFieldReferenceValue.create(cutoffDateField)._unsafeUnwrap();
      const spec = dueDateField.spec().create({ operator: 'isBefore', value });
      expect(spec.isOk()).toBe(true);
      if (spec.isErr()) return;

      const visitor = new TableRecordConditionWhereVisitor({
        tableAlias: 'f',
        hostTableAlias: 't',
      });
      const visitResult = spec.value.accept(visitor);
      expect(visitResult.isOk()).toBe(true);
      const where = visitor.where();
      expect(where.isOk()).toBe(true);
      if (where.isErr()) return;

      const { sql, parameters } = compileWhere(db, where.value);
      expect(sql).toContain('("f"."col_due_date" AT TIME ZONE $1)::date');
      expect(sql).toContain('("t"."col_cutoff_date" AT TIME ZONE $2)::date');
      expect(parameters).toEqual(['utc', 'utc']);
    });

    test('date is with createdTime field reference uses each field timezone before date truncation', () => {
      const value = RecordConditionFieldReferenceValue.create(createdTimeField)._unsafeUnwrap();
      const spec = dueDateField.spec().create({ operator: 'is', value });
      expect(spec.isOk()).toBe(true);
      if (spec.isErr()) return;

      const visitor = new TableRecordConditionWhereVisitor({
        tableAlias: 'f',
        hostTableAlias: 't',
      });
      const visitResult = spec.value.accept(visitor);
      expect(visitResult.isOk()).toBe(true);
      const where = visitor.where();
      expect(where.isOk()).toBe(true);
      if (where.isErr()) return;

      const { sql, parameters } = compileWhere(db, where.value);
      expect(sql).toContain('("f"."col_due_date" AT TIME ZONE $1)::date');
      expect(sql).toContain('("t"."col_created_time" AT TIME ZONE $2)::date');
      expect(parameters).toEqual(['utc', 'Asia/Shanghai']);
    });

    test('datetime exactDate preserves the exact timestamp when the field includes time', () => {
      const value = RecordConditionDateValue.create({
        mode: 'exactDate',
        exactDate: '2025-12-15T11:00:00.000Z',
        timeZone: 'utc',
      })._unsafeUnwrap();
      const spec = dueAtField.spec().create({ operator: 'is', value });
      expect(spec.isOk()).toBe(true);
      if (spec.isErr()) return;

      const { sql, parameters } = buildWhereFor(db, spec.value);
      expect(sql).toContain('"t"."col_due_at" between $1 and $2');
      expect(parameters).toEqual(['2025-12-15T11:00:00.000Z', '2025-12-15T11:00:00.000Z']);
    });
  });

  describe('incoming link selection specs', () => {
    test('incoming selected host references compile to EXISTS subquery', () => {
      const spec = IncomingLinkSelectedSpec.create({
        mode: 'hostReferenceExists',
        selfKeyName: '__host_id',
        fkHostTableName: 'public.link_host',
        foreignKeyName: '__foreign_id',
      });

      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toContain('from "public"."link_host" as h');
      expect(sql).toContain('"h"."__foreign_id" = "t"."__id"');
      expect(parameters).toEqual([]);
    });

    test('incoming candidate current-column availability keeps current host record selectable', () => {
      const hostRecordId = RecordId.create(`rec${'c'.repeat(16)}`)._unsafeUnwrap();
      const spec = IncomingLinkCandidateSpec.create({
        mode: 'currentColumnAvailable',
        selfKeyName: '__parent_id',
        hostRecordId,
      });

      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toContain('"t"."__parent_id" is null or "t"."__parent_id" = $1');
      expect(parameters).toEqual([hostRecordId.toString()]);
    });

    test('incoming candidate host references compile to correlated NOT EXISTS', () => {
      const hostRecordId = RecordId.create(`rec${'d'.repeat(16)}`)._unsafeUnwrap();
      const spec = IncomingLinkCandidateSpec.create({
        mode: 'hostReferenceAvailable',
        selfKeyName: '__host_id',
        fkHostTableName: 'public.link_host',
        foreignKeyName: '__foreign_id',
        hostRecordId,
      });

      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toContain('from "public"."link_host" as h');
      expect(sql).toContain('"h"."__foreign_id" is not null');
      expect(sql).toContain('"h"."__foreign_id" = "t"."__id"');
      expect(sql).toContain('"h"."__host_id" <> $1');
      expect(parameters).toEqual([hostRecordId.toString()]);
    });

    test('incoming candidate junction references compile to correlated NOT EXISTS', () => {
      const spec = IncomingLinkCandidateSpec.create({
        mode: 'junctionReferenceAvailable',
        selfKeyName: '__host_id',
        fkHostTableName: 'public.junction_links',
        foreignKeyName: '__foreign_id',
      });

      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toContain('from "public"."junction_links" as h');
      expect(sql).toContain('"h"."__foreign_id" = "t"."__id"');
      expect(parameters).toEqual([]);
    });
  });

  // ---- isEmpty / isNotEmpty ----

  describe('isEmpty / isNotEmpty operators', () => {
    test('text isEmpty checks IS NULL or empty string', () => {
      const spec = SingleLineTextConditionSpec.create(nameField, 'isEmpty');
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`"("t"."col_name" is null) or ("t"."col_name" = '')"`);
      expect(parameters).toEqual([]);
    });

    test('text isNotEmpty checks IS NOT NULL and non-empty', () => {
      const spec = SingleLineTextConditionSpec.create(nameField, 'isNotEmpty');
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(
        `"("t"."col_name" is not null) and ("t"."col_name" != '')"`
      );
      expect(parameters).toEqual([]);
    });

    test('number isEmpty checks IS NULL', () => {
      const spec = NumberConditionSpec.create(scoreField, 'isEmpty');
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_score" is null"`);
      expect(parameters).toEqual([]);
    });
  });

  // ---- comparison operators (no COALESCE — consistent with v1) ----

  describe('comparison operators', () => {
    test('isGreater uses standard comparison (no COALESCE)', () => {
      const value = RecordConditionLiteralValue.create(50)._unsafeUnwrap();
      const spec = NumberConditionSpec.create(scoreField, 'isGreater', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_score" > $1"`);
      expect(parameters).toEqual([50]);
    });

    test('isLessEqual uses standard comparison (no COALESCE)', () => {
      const value = RecordConditionLiteralValue.create(100)._unsafeUnwrap();
      const spec = NumberConditionSpec.create(scoreField, 'isLessEqual', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_score" <= $1"`);
      expect(parameters).toEqual([100]);
    });
  });

  describe('user field reference operators', () => {
    test('single user is multi user field reference uses overlap match with host alias', () => {
      const userDb = createTestDb();
      const { ownerField, assigneesField } = createUserReferenceFields();
      const spec = UserConditionSpec.create(
        ownerField,
        'is',
        RecordConditionFieldReferenceValue.create(assigneesField)._unsafeUnwrap()
      );

      const { sql, parameters } = buildWhereFor(userDb, spec, {
        tableAlias: 'f',
        hostTableAlias: 't',
      });

      expect(sql).toContain('jsonb_exists_any');
      expect(sql).toContain('to_jsonb("f"."col_owner")');
      expect(sql).toContain('jsonb_path_query_array(CASE');
      expect(sql).toContain('to_jsonb("t"."col_assignees")');
      expect(parameters).toEqual([]);
    });

    test('single user isNot multi user field reference uses anti-match with host alias', () => {
      const userDb = createTestDb();
      const { ownerField, assigneesField } = createUserReferenceFields();
      const spec = UserConditionSpec.create(
        ownerField,
        'isNot',
        RecordConditionFieldReferenceValue.create(assigneesField)._unsafeUnwrap()
      );

      const { sql, parameters } = buildWhereFor(userDb, spec, {
        tableAlias: 'f',
        hostTableAlias: 't',
      });

      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('jsonb_array_elements_text');
      expect(sql).toContain('to_jsonb("f"."col_owner")');
      expect(sql).toContain('to_jsonb("t"."col_assignees")');
      expect(parameters).toEqual([]);
    });
  });

  describe('delegated visitor methods', () => {
    const {
      nameField,
      notesField,
      scoreField,
      dueDateField,
      labelsField,
      filesField,
      watchersField,
      tagField,
      tagsField,
    } = createTestTable();
    const textListValue = RecordConditionLiteralListValue.create(['alpha', 'beta'])._unsafeUnwrap();
    const idListValue = RecordConditionLiteralListValue.create([
      `rec${'x'.repeat(16)}`,
      `rec${'y'.repeat(16)}`,
    ])._unsafeUnwrap();
    const textValue = RecordConditionLiteralValue.create('alpha')._unsafeUnwrap();
    const numericValue = RecordConditionLiteralValue.create(10)._unsafeUnwrap();
    const dateValue = RecordConditionDateValue.create({
      mode: 'exactDate',
      exactDate: '2025-12-15T00:00:00.000Z',
      timeZone: 'utc',
    })._unsafeUnwrap();

    test.each([
      {
        name: 'multiple select hasAllOf uses array containment',
        method: 'visitMultipleSelectHasAllOf',
        field: labelsField,
        value: textListValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain('to_jsonb("t"."col_labels")');
          expect(sql).toContain('?& array[$1, $2]');
          expect(parameters).toEqual(['alpha', 'beta']);
        },
      },
      {
        name: 'multiple select isNotExactly keeps NULL rows selectable',
        method: 'visitMultipleSelectIsNotExactly',
        field: labelsField,
        value: textListValue,
        assert: (sql: string) => {
          expect(sql).toContain(`to_jsonb(coalesce("t"."col_labels", '[]'::jsonb))`);
          expect(sql).toContain('not ((');
        },
      },
      {
        name: 'attachment isEmpty checks null or empty json array',
        method: 'visitAttachmentIsEmpty',
        field: filesField,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain('"t"."col_files" is null');
          expect(sql).toContain('jsonb_array_length(to_jsonb("t"."col_files")) = 0');
          expect(parameters).toEqual([]);
        },
      },
      {
        name: 'attachment isNotEmpty checks non-empty json array',
        method: 'visitAttachmentIsNotEmpty',
        field: filesField,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain('"t"."col_files" is not null');
          expect(sql).toContain('jsonb_array_length(to_jsonb("t"."col_files")) > 0');
          expect(parameters).toEqual([]);
        },
      },
      {
        name: 'user hasAllOf uses jsonb_exists_all',
        method: 'visitUserHasAllOf',
        field: watchersField,
        value: idListValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain('jsonb_exists_all');
          expect(parameters).toEqual([`rec${'x'.repeat(16)}`, `rec${'y'.repeat(16)}`]);
        },
      },
      {
        name: 'user isNotExactly includes NULL rows in anti-match',
        method: 'visitUserIsNotExactly',
        field: watchersField,
        value: idListValue,
        assert: (sql: string) => {
          expect(sql).toContain('OR "t"."col_watchers" IS NULL');
        },
      },
      {
        name: 'link contains matches title on single-link json payload',
        method: 'visitLinkContains',
        field: tagField,
        value: textValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain(`'$.title ? (@ like_regex "alpha" flag "i")'::jsonpath`);
          expect(parameters).toEqual([]);
        },
      },
      {
        name: 'link doesNotContain negates title match on single-link payload',
        method: 'visitLinkDoesNotContain',
        field: tagField,
        value: textValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain('NOT jsonb_path_exists');
          expect(sql).toContain(`'$.title ? (@ like_regex "alpha" flag "i")'::jsonpath`);
          expect(parameters).toEqual([]);
        },
      },
      {
        name: 'link isExactly compares multi-link ids as sets',
        method: 'visitLinkIsExactly',
        field: tagsField,
        value: idListValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain('@> to_jsonb(ARRAY[$1, $2])');
          expect(sql).toContain('to_jsonb(ARRAY[$3, $4]) @>');
          expect(parameters).toEqual([
            `rec${'x'.repeat(16)}`,
            `rec${'y'.repeat(16)}`,
            `rec${'x'.repeat(16)}`,
            `rec${'y'.repeat(16)}`,
          ]);
        },
      },
      {
        name: 'formula doesNotContain reuses string negative match builder',
        method: 'visitFormulaDoesNotContain',
        field: nameField,
        value: textValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain(`coalesce("t"."col_name", '') not ilike $1 escape '\\'`);
          expect(parameters).toEqual(['%alpha%']);
        },
      },
      {
        name: 'formula isGreaterEqual reuses numeric comparison builder',
        method: 'visitFormulaIsGreaterEqual',
        field: scoreField,
        value: numericValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toBe('"t"."col_score" >= $1');
          expect(parameters).toEqual([10]);
        },
      },
      {
        name: 'formula isWithIn reuses date-range builder',
        method: 'visitFormulaIsWithIn',
        field: dueDateField,
        value: dateValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toBe('"t"."col_due_date" between $1 and $2');
          expect(parameters).toEqual(['2025-12-15T00:00:00.000Z', '2025-12-15T23:59:59.999Z']);
        },
      },
      {
        name: 'rollup doesNotContain reuses string negative match builder',
        method: 'visitRollupDoesNotContain',
        field: notesField,
        value: textValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain(`coalesce("t"."col_notes", '') not ilike $1 escape '\\'`);
          expect(parameters).toEqual(['%alpha%']);
        },
      },
      {
        name: 'rollup hasAllOf reuses list-all builder',
        method: 'visitRollupHasAllOf',
        field: labelsField,
        value: textListValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain('to_jsonb("t"."col_labels")');
          expect(sql).toContain('?& array[$1, $2]');
          expect(parameters).toEqual(['alpha', 'beta']);
        },
      },
      {
        name: 'rollup isOnOrAfter reuses date comparison builder',
        method: 'visitRollupIsOnOrAfter',
        field: dueDateField,
        value: dateValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toBe('"t"."col_due_date" >= $1');
          expect(parameters).toEqual(['2025-12-15T00:00:00.000Z']);
        },
      },
      {
        name: 'conditional rollup doesNotContain reuses string negative match builder',
        method: 'visitConditionalRollupDoesNotContain',
        field: notesField,
        value: textValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain(`coalesce("t"."col_notes", '') not ilike $1 escape '\\'`);
          expect(parameters).toEqual(['%alpha%']);
        },
      },
      {
        name: 'conditional rollup hasAllOf reuses list-all builder',
        method: 'visitConditionalRollupHasAllOf',
        field: labelsField,
        value: textListValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain('to_jsonb("t"."col_labels")');
          expect(sql).toContain('?& array[$1, $2]');
          expect(parameters).toEqual(['alpha', 'beta']);
        },
      },
      {
        name: 'conditional rollup isOnOrAfter reuses date comparison builder',
        method: 'visitConditionalRollupIsOnOrAfter',
        field: dueDateField,
        value: dateValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toBe('"t"."col_due_date" >= $1');
          expect(parameters).toEqual(['2025-12-15T00:00:00.000Z']);
        },
      },
      {
        name: 'conditional lookup is reuses equality builder',
        method: 'visitConditionalLookupIs',
        field: nameField,
        value: textValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toBe('"t"."col_name" = $1');
          expect(parameters).toEqual(['alpha']);
        },
      },
      {
        name: 'conditional lookup contains reuses string contains builder',
        method: 'visitConditionalLookupContains',
        field: nameField,
        value: textValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toBe(`"t"."col_name" ilike $1 escape '\\'`);
          expect(parameters).toEqual(['%alpha%']);
        },
      },
      {
        name: 'conditional lookup isNot reuses inequality builder',
        method: 'visitConditionalLookupIsNot',
        field: nameField,
        value: textValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toBe(`"t"."col_name" is distinct from $1`);
          expect(parameters).toEqual(['alpha']);
        },
      },
      {
        name: 'conditional lookup doesNotContain reuses string negative match builder',
        method: 'visitConditionalLookupDoesNotContain',
        field: nameField,
        value: textValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain(`coalesce("t"."col_name", '') not ilike $1 escape '\\'`);
          expect(parameters).toEqual(['%alpha%']);
        },
      },
      {
        name: 'conditional lookup isEmpty reuses string empty builder',
        method: 'visitConditionalLookupIsEmpty',
        field: nameField,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toBe(`("t"."col_name" is null) or ("t"."col_name" = '')`);
          expect(parameters).toEqual([]);
        },
      },
      {
        name: 'conditional lookup isNotEmpty reuses string non-empty builder',
        method: 'visitConditionalLookupIsNotEmpty',
        field: nameField,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toBe(`("t"."col_name" is not null) and ("t"."col_name" != '')`);
          expect(parameters).toEqual([]);
        },
      },
      {
        name: 'conditional lookup isAnyOf reuses list-any builder',
        method: 'visitConditionalLookupIsAnyOf',
        field: labelsField,
        value: textListValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain('?| array[$1, $2]');
          expect(parameters).toEqual(['alpha', 'beta']);
        },
      },
      {
        name: 'conditional lookup isNoneOf reuses list-none builder',
        method: 'visitConditionalLookupIsNoneOf',
        field: labelsField,
        value: textListValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain(
            `not (to_jsonb(coalesce("t"."col_labels", '[]'::jsonb)) ?| array[$1, $2])`
          );
          expect(parameters).toEqual(['alpha', 'beta']);
        },
      },
      {
        name: 'conditional lookup hasAnyOf reuses list-any builder',
        method: 'visitConditionalLookupHasAnyOf',
        field: labelsField,
        value: textListValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain('?| array[$1, $2]');
          expect(parameters).toEqual(['alpha', 'beta']);
        },
      },
      {
        name: 'conditional lookup hasAllOf reuses list-all builder',
        method: 'visitConditionalLookupHasAllOf',
        field: labelsField,
        value: textListValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain('to_jsonb("t"."col_labels")');
          expect(sql).toContain('?& array[$1, $2]');
          expect(parameters).toEqual(['alpha', 'beta']);
        },
      },
      {
        name: 'conditional lookup hasNoneOf reuses list-none builder',
        method: 'visitConditionalLookupHasNoneOf',
        field: labelsField,
        value: textListValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain(
            `not (to_jsonb(coalesce("t"."col_labels", '[]'::jsonb)) ?| array[$1, $2])`
          );
          expect(parameters).toEqual(['alpha', 'beta']);
        },
      },
      {
        name: 'conditional lookup isNotExactly keeps NULL rows selectable',
        method: 'visitConditionalLookupIsNotExactly',
        field: labelsField,
        value: textListValue,
        assert: (sql: string) => {
          expect(sql).toContain(`to_jsonb(coalesce("t"."col_labels", '[]'::jsonb))`);
          expect(sql).toContain('not ((');
        },
      },
      {
        name: 'conditional lookup isExactly reuses list-exact builder',
        method: 'visitConditionalLookupIsExactly',
        field: labelsField,
        value: textListValue,
        assert: (sql: string, parameters: unknown[]) => {
          expect(sql).toContain('@> to_jsonb(array[$1, $2])');
          expect(sql).toContain('<@ to_jsonb(array[$3, $4])');
          expect(parameters).toEqual(['alpha', 'beta', 'alpha', 'beta']);
        },
      },
    ])('$name', ({ method, field, value, assert }) => {
      const { sql, parameters } = buildWhereForDirectMethod(db, method, field, value);
      assert(sql, parameters);
    });
  });

  describe('record id and logical helpers', () => {
    test('visitRecordById filters by current table id', () => {
      const visitor = new TableRecordConditionWhereVisitor({ tableAlias: 't' });
      const recordId = RecordId.create(`rec${'1'.repeat(16)}`)._unsafeUnwrap();
      const result = RecordByIdSpec.create(recordId).accept(visitor);

      expect(result.isErr()).toBe(false);
      const where = visitor.where();
      expect(where.isOk()).toBe(true);
      if (where.isErr()) return;

      const { sql, parameters } = compileWhere(db, where.value);
      expect(sql).toBe('"t"."__id" = $1');
      expect(parameters).toEqual([recordId.toString()]);
    });

    test('visitRecordByIds handles empty list as impossible predicate', () => {
      const visitor = new TableRecordConditionWhereVisitor({ tableAlias: 't' });
      const spec = RecordByIdsSpec.create([]);
      const result = spec.accept(visitor);

      expect(result.isErr()).toBe(false);
      const where = visitor.where();
      expect(where.isOk()).toBe(true);
      if (where.isErr()) return;

      const { sql, parameters } = compileWhere(db, where.value);
      expect(sql).toBe('1 = 0');
      expect(parameters).toEqual([]);
    });

    test('clone keeps aliases and logical combinators compile correctly', () => {
      const baseVisitor = new TableRecordConditionWhereVisitor({
        tableAlias: 'f',
        hostTableAlias: 't',
      });
      const cloned = baseVisitor.clone();
      const combined = cloned.or(
        cloned.and(sql`"f"."col_name" = ${'alpha'}`, sql`"f"."col_score" > ${10}`),
        cloned.not(sql`"f"."col_done" = ${true}`)
      );

      const { sql: whereSql, parameters } = compileWhere(db, combined);
      expect(whereSql).toContain('(("f"."col_name" = $1) and ("f"."col_score" > $2))');
      expect(whereSql).toContain('or (not ("f"."col_done" = $3))');
      expect(parameters).toEqual(['alpha', 10, true]);
    });
  });
});
