import {
  CellValueMultiplicity,
  CellValueType,
  BaseId,
  DbFieldName,
  DefaultTableMapper,
  FieldHasError,
  FieldId,
  FieldName,
  FormulaExpression,
  FormulaField,
  LinkFieldConfig,
  LookupField,
  LookupOptions,
  NumberFormatting,
  RollupExpression,
  RollupFieldConfig,
  Table,
  TableByNameSpec,
  TableId,
  type ITableMapper,
  TableName,
  TableRenameSpec,
  TableUpdateFieldDbFieldNameSpec,
  TableUpdateFieldHasErrorSpec,
  TableUpdateFieldNameSpec,
  ViewColumnMeta,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely';
import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableMetaUpdateVisitor, type TableUpdateBuilder } from './TableMetaUpdateVisitor';

const createTestDb = () =>
  new Kysely<V1TeableDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

const createTableFixture = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create('Projects')._unsafeUnwrap());

  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();

  const linkFieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
  const foreignTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const lookupFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
  const rollupFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
    fkHostTableName: 'link_relations',
    selfKeyName: '__self_id',
    foreignKeyName: '__foreign_id',
  })._unsafeUnwrap();

  builder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Related')._unsafeUnwrap())
    .withConfig(linkConfig)
    .done();
  builder
    .field()
    .rollup()
    .withId(rollupFieldId)
    .withName(FieldName.create('Total')._unsafeUnwrap())
    .withConfig(
      RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap()
    )
    .withExpression(RollupExpression.create('sum({values})')._unsafeUnwrap())
    .withResultType({
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    })
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap().clone(new DefaultTableMapper())._unsafeUnwrap();
  const titleField = table.getFields()[0]!;
  const linkField = table.getFields()[1]!;
  const rollupField = table.getFields()[2]!;
  const view = table.views()[0]!;

  return { table, titleField, linkField, rollupField, view };
};

const createDetachedField = (name: string) => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'d'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'d'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Detached')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create(name)._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder
    .build()
    ._unsafeUnwrap()
    .clone(new DefaultTableMapper())
    ._unsafeUnwrap()
    .getFields()[0]!;
};

const createVisitor = (table = createTableFixture().table) => {
  const db = createTestDb();
  const visitor = new TableMetaUpdateVisitor({
    db,
    table,
    tableMapper: new DefaultTableMapper(),
    actorId: 'system',
    now: new Date('2026-03-30T00:00:00.000Z'),
    where: (eb) => eb.eb('id', '=', table.id().toString()),
  });

  return { db, visitor };
};

const compileStatements = (
  db: Kysely<V1TeableDatabase>,
  statements: ReadonlyArray<TableUpdateBuilder>
): CompiledQuery[] => statements.map((statement) => statement.compile(db));

describe('TableMetaUpdateVisitor', () => {
  it('builds table metadata updates and merges collected statements', () => {
    const fixture = createTableFixture();
    const { db, visitor } = createVisitor(fixture.table);
    const renameSpec = TableRenameSpec.create(
      TableName.create('Projects')._unsafeUnwrap(),
      TableName.create('Renamed')._unsafeUnwrap()
    );
    const byNameSpec = TableByNameSpec.create(TableName.create('ByName')._unsafeUnwrap());

    const renameResult = visitor.visitTableRename(renameSpec);
    const byNameResult = visitor.visitTableByName(byNameSpec);

    expect(renameResult.isOk()).toBe(true);
    expect(byNameResult.isOk()).toBe(true);

    const sqls = compileStatements(db, visitor.where()._unsafeUnwrap()).map((query) => query.sql);
    expect(sqls).toHaveLength(2);
    expect(sqls[0]).toContain('update "table_meta"');
    expect(sqls[0]).toContain('"name" = $1');
    expect(sqls[0]).toContain('where "id" = $4');
    expect(sqls[1]).toContain('update "table_meta"');
  });

  it('builds add, addMany, duplicate and remove field statements', () => {
    const augmented = Table.builder()
      .withBaseId(BaseId.create(`bse${'k'.repeat(16)}`)._unsafeUnwrap())
      .withId(TableId.create(`tbl${'k'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Augmented')._unsafeUnwrap());
    augmented
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    augmented.field().singleLineText().withName(FieldName.create('Added')._unsafeUnwrap()).done();
    augmented.field().singleLineText().withName(FieldName.create('Added 2')._unsafeUnwrap()).done();
    augmented.view().defaultGrid().done();
    const augmentedTable = augmented
      .build()
      ._unsafeUnwrap()
      .clone(new DefaultTableMapper())
      ._unsafeUnwrap();
    const { db, visitor } = createVisitor(augmentedTable);
    const newField = augmentedTable.getFields()[1]!;
    const otherField = augmentedTable.getFields()[2]!;
    const removeField = augmentedTable.getFields()[1]!;

    const addResult = visitor.visitTableAddField({ field: () => newField } as never);
    const addManyResult = visitor.visitTableAddFields({
      fields: () => [newField, otherField],
    } as never);
    const duplicateResult = visitor.visitTableDuplicateField({
      newField: () => otherField,
    } as never);
    const removeResult = visitor.visitTableRemoveField({
      field: () => removeField,
    } as never);

    expect(addResult.isOk()).toBe(true);
    expect(addManyResult.isOk()).toBe(true);
    expect(duplicateResult.isOk()).toBe(true);
    expect(removeResult.isOk()).toBe(true);

    const addSql = compileStatements(db, addResult._unsafeUnwrap())[0]!;
    expect(addSql.sql).toContain('insert into "field"');
    expect(addSql.sql).toContain('on conflict ("id") do update');

    const removeSqls = compileStatements(db, removeResult._unsafeUnwrap()).map(
      (query) => query.sql
    );
    expect(removeSqls[0]).toContain('update "field"');
    expect(removeSqls[0]).toContain('"deleted_time" = $1');
    expect(removeSqls[1]).toContain('delete from "reference"');
    expect(removeSqls[1]).toContain('"from_field_id" = $1');
    expect(removeSqls[1]).toContain('"to_field_id" = $2');

    expect(addManyResult._unsafeUnwrap()).toHaveLength(2);
    expect(duplicateResult._unsafeUnwrap()).toHaveLength(1);
  });

  it('preserves lookup inner options in add-field statements when mapper DTO metadata is incomplete', () => {
    class IncompleteLookupMapper extends DefaultTableMapper implements ITableMapper {
      override toDTO(table: Table) {
        const dto = super.toDTO(table)._unsafeUnwrap();
        const lookupDto = dto.fields.find((field) => field.id === lookupFieldId.toString());
        if (!lookupDto) {
          throw new Error('Lookup DTO not found');
        }
        delete (lookupDto as { options?: unknown }).options;
        delete (lookupDto as { lookupOptions?: unknown }).lookupOptions;
        return ok(dto);
      }
    }

    const baseId = BaseId.create(`bse${'q'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'q'.repeat(16)}`)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(`fld${'r'.repeat(16)}`)._unsafeUnwrap();
    const innerFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Lookup Updates')._unsafeUnwrap());

    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.addFieldFromResult(
      LookupField.create({
        id: lookupFieldId,
        name: FieldName.create('Formula Lookup')._unsafeUnwrap(),
        innerField: FormulaField.create({
          id: innerFieldId,
          name: FieldName.create('Amount Formula')._unsafeUnwrap(),
          expression: FormulaExpression.create('1')._unsafeUnwrap(),
          formatting: NumberFormatting.create({
            type: 'currency',
            precision: 2,
            symbol: '¥',
          })._unsafeUnwrap(),
          resultType: {
            cellValueType: CellValueType.number(),
            isMultipleCellValue: CellValueMultiplicity.single(),
          },
        })._unsafeUnwrap(),
        lookupOptions: LookupOptions.create({
          linkFieldId: `fld${'t'.repeat(16)}`,
          foreignTableId: `tbl${'t'.repeat(16)}`,
          lookupFieldId: `fld${'u'.repeat(16)}`,
        })._unsafeUnwrap(),
      })
    );
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap().clone(new DefaultTableMapper())._unsafeUnwrap();
    const lookupField = table.getField((field) => field.id().equals(lookupFieldId))._unsafeUnwrap();
    const db = createTestDb();
    const visitor = new TableMetaUpdateVisitor({
      db,
      table,
      tableMapper: new IncompleteLookupMapper(),
      actorId: 'system',
      now: new Date('2026-04-09T00:00:00.000Z'),
      where: (eb) => eb.eb('id', '=', table.id().toString()),
    });

    const addResult = visitor.visitTableAddField({ field: () => lookupField } as never);
    expect(addResult.isOk()).toBe(true);

    const compiled = compileStatements(db, addResult._unsafeUnwrap())[0]!;
    const jsonParameters = compiled.parameters.flatMap((parameter) => {
      if (typeof parameter !== 'string' || !parameter.startsWith('{')) {
        return [];
      }

      try {
        return [JSON.parse(parameter) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    const fieldOptions = jsonParameters.find((value) => value.expression === '1') as
      | Record<string, unknown>
      | undefined;
    const lookupOptions = jsonParameters.find(
      (value) => value.lookupFieldId === `fld${'u'.repeat(16)}`
    ) as Record<string, unknown> | undefined;

    expect(fieldOptions).toMatchObject({
      expression: '1',
      formatting: {
        type: 'currency',
        precision: 2,
        symbol: '¥',
      },
    });
    expect(lookupOptions).toMatchObject({
      linkFieldId: `fld${'t'.repeat(16)}`,
      foreignTableId: `tbl${'t'.repeat(16)}`,
      lookupFieldId: `fld${'u'.repeat(16)}`,
    });
  });

  it('updates field metadata columns and tracks touched field versions', () => {
    const fixture = createTableFixture();
    const { db, visitor } = createVisitor(fixture.table);
    const { titleField } = fixture;
    const fieldId = titleField.id();

    const nameSpec = TableUpdateFieldNameSpec.create(
      fieldId,
      titleField.name(),
      FieldName.create('Headline')._unsafeUnwrap()
    );
    const dbFieldNameSpec = {
      fieldId: () => fieldId,
      nextDbFieldName: () => DbFieldName.rehydrate('headline_col')._unsafeUnwrap(),
    } as never;
    const hasErrorSpec = TableUpdateFieldHasErrorSpec.setError(fieldId, FieldHasError.ok());
    const clearErrorSpec = TableUpdateFieldHasErrorSpec.clearError(fieldId, FieldHasError.error());

    const nameSql = compileStatements(
      db,
      visitor.visitTableUpdateFieldName(nameSpec)._unsafeUnwrap()
    )[0]!;
    const dbNameSql = compileStatements(
      db,
      visitor.visitTableUpdateFieldDbFieldName(dbFieldNameSpec)._unsafeUnwrap()
    )[0]!;
    const errorSql = compileStatements(
      db,
      visitor.visitTableUpdateFieldHasError(hasErrorSpec)._unsafeUnwrap()
    )[0]!;
    const clearErrorSql = compileStatements(
      db,
      visitor.visitTableUpdateFieldHasError(clearErrorSpec)._unsafeUnwrap()
    )[0]!;

    expect(nameSql.parameters).toContain('Headline');
    expect(dbNameSql.parameters).toContain('headline_col');
    expect(errorSql.parameters).toContain(true);
    expect(clearErrorSql.parameters[0]).toBeNull();
    expect(visitor.fieldVersionTouchOrder()).toEqual([
      fieldId.toString(),
      fieldId.toString(),
      fieldId.toString(),
      fieldId.toString(),
    ]);
  });

  it('serializes view column meta and query defaults payloads', () => {
    const fixture = createTableFixture();
    const { db, visitor } = createVisitor(fixture.table);
    const { view, titleField } = fixture;
    const columnMeta = ViewColumnMeta.create({
      [titleField.id().toString()]: { order: 9, width: 320 },
    })._unsafeUnwrap();

    const viewMetaResult = visitor.visitTableUpdateViewColumnMeta({
      updates: () => [{ viewId: view.id(), fieldId: titleField.id(), columnMeta }],
    } as never);
    const queryDefaultsResult = visitor.visitTableUpdateViewQueryDefaults({
      updates: () => [
        {
          viewId: view.id(),
          queryDefaults: {
            toDto: () => ({
              filter: {
                conjunction: 'and',
                items: [
                  {
                    fieldId: titleField.id().toString(),
                    operator: 'contains',
                    value: 'abc',
                  },
                  {
                    not: {
                      fieldId: titleField.id().toString(),
                      operator: 'isEmpty',
                    },
                  },
                ],
              },
              sort: [{ fieldId: titleField.id().toString(), order: 'asc' }],
              manualSort: true,
              group: [{ fieldId: titleField.id().toString() }],
            }),
          },
        },
      ],
    } as never);

    expect(viewMetaResult.isOk()).toBe(true);
    expect(queryDefaultsResult.isOk()).toBe(true);

    const viewMetaSql = compileStatements(db, viewMetaResult._unsafeUnwrap())[0]!;
    const queryDefaultsSql = compileStatements(db, queryDefaultsResult._unsafeUnwrap())[0]!;

    expect(viewMetaSql.parameters).toContain(JSON.stringify(columnMeta.toDto()));
    expect(queryDefaultsSql.parameters).toContain(
      JSON.stringify({
        conjunction: 'and',
        filterSet: [
          {
            fieldId: titleField.id().toString(),
            operator: 'contains',
            value: 'abc',
          },
          {
            not: {
              fieldId: titleField.id().toString(),
              operator: 'isEmpty',
              value: undefined,
            },
          },
        ],
      })
    );
    expect(queryDefaultsSql.parameters).toContain(
      JSON.stringify({
        sortObjs: [{ fieldId: titleField.id().toString(), order: 'asc' }],
        manualSort: true,
      })
    );
    expect(queryDefaultsSql.parameters).toContain(
      JSON.stringify([{ fieldId: titleField.id().toString() }])
    );
    expect(visitor.viewVersionTouchOrder()).toEqual([view.id().toString(), view.id().toString()]);
  });

  it('covers option-based and storage-based wrapper updates', () => {
    const fixture = createTableFixture();
    const { db, visitor } = createVisitor(fixture.table);
    const { titleField, linkField } = fixture;
    const optionSpec = { fieldId: () => titleField.id() } as never;
    const storageSpec = { fieldId: () => linkField.id() } as never;

    const optionMethods = [
      'visitUpdateSingleLineTextShowAs',
      'visitUpdateSingleLineTextDefaultValue',
      'visitUpdateLongTextShowAs',
      'visitUpdateLongTextDefaultValue',
      'visitUpdateNumberFormatting',
      'visitUpdateNumberShowAs',
      'visitUpdateNumberDefaultValue',
      'visitUpdateDateFormatting',
      'visitUpdateDateDefaultValue',
      'visitUpdateCheckboxDefaultValue',
      'visitUpdateRatingMax',
      'visitUpdateRatingIcon',
      'visitUpdateRatingColor',
      'visitUpdateUserMultiplicity',
      'visitUpdateUserNotification',
      'visitUpdateUserDefaultValue',
      'visitUpdateButtonLabel',
      'visitUpdateButtonColor',
      'visitUpdateButtonMaxCount',
      'visitUpdateButtonWorkflow',
      'visitUpdateSingleSelectOptions',
      'visitUpdateSingleSelectDefaultValue',
      'visitUpdateSingleSelectAutoNewOptions',
      'visitUpdateMultipleSelectOptions',
      'visitUpdateMultipleSelectDefaultValue',
      'visitUpdateMultipleSelectAutoNewOptions',
      'visitUpdateFormulaFormatting',
      'visitUpdateFormulaShowAs',
      'visitUpdateFormulaTimeZone',
      'visitUpdateRollupExpression',
      'visitUpdateRollupFormatting',
      'visitUpdateRollupShowAs',
      'visitUpdateRollupTimeZone',
    ] as const;
    const storageMethods = [
      'visitUpdateFormulaExpression',
      'visitUpdateLinkRelationship',
      'visitUpdateLookupOptions',
      'visitUpdateRollupConfig',
    ] as const;

    for (const method of optionMethods) {
      const result = (
        visitor as Record<
          string,
          (spec: unknown) => ReturnType<typeof visitor.visitUpdateButtonLabel>
        >
      )[method](optionSpec);
      expect(result.isOk()).toBe(true);
      expect(compileStatements(db, result._unsafeUnwrap())[0]?.sql).toContain('update "field"');
    }

    for (const method of storageMethods) {
      const result = (
        visitor as Record<
          string,
          (spec: unknown) => ReturnType<typeof visitor.visitUpdateFormulaExpression>
        >
      )[method](storageSpec);
      expect(result.isOk()).toBe(true);
      const compiled = compileStatements(db, result._unsafeUnwrap())[0]!;
      expect(compiled.sql).toContain('update "field"');
      expect(compiled.parameters).toContain(linkField.id().toString());
    }
  });

  it('switches between option-only and storage-metadata link config updates', () => {
    const fixture = createTableFixture();
    const { db, visitor } = createVisitor(fixture.table);
    const { linkField } = fixture;

    const optionOnly = visitor.visitUpdateLinkConfig({
      fieldId: () => linkField.id(),
      isRelationshipChanging: () => false,
      isOneWayChanging: () => false,
    } as never);
    const storageUpdate = visitor.visitUpdateLinkConfig({
      fieldId: () => linkField.id(),
      isRelationshipChanging: () => true,
      isOneWayChanging: () => false,
    } as never);

    expect(optionOnly.isOk()).toBe(true);
    expect(storageUpdate.isOk()).toBe(true);
    expect(compileStatements(db, optionOnly._unsafeUnwrap())[0]?.sql).toContain('"options" = $1');
    expect(compileStatements(db, storageUpdate._unsafeUnwrap())[0]?.sql).toContain('"meta" = $2');
  });

  it('uses storage metadata updates for rollup config changes', () => {
    const fixture = createTableFixture();
    const { db, visitor } = createVisitor(fixture.table);
    const { linkField, rollupField } = fixture;

    const result = visitor.visitUpdateRollupConfig({ fieldId: () => rollupField.id() } as never);

    expect(result.isOk()).toBe(true);
    const compiled = compileStatements(db, result._unsafeUnwrap())[0]!;
    expect(compiled.sql).toContain('"lookup_linked_field_id" =');
    expect(compiled.sql).toContain('"lookup_options" =');
    expect(compiled.parameters).toContain(linkField.id().toString());
    expect(
      compiled.parameters.some(
        (parameter) =>
          typeof parameter === 'string' && parameter.includes(`"linkFieldId":"${linkField.id()}"`)
      )
    ).toBe(true);
  });

  it('returns errors for unsupported selectors and missing fields, and clones cleanly', () => {
    const { visitor } = createVisitor();
    const unsupported = [
      ['visitTableByBaseId', 'TableByBaseIdSpec is not supported for table updates'],
      ['visitTableById', 'TableByIdSpec is not supported for table updates'],
      [
        'visitTableByIncomingReferenceToTable',
        'TableByIncomingReferenceToTableSpec is not supported for table updates',
      ],
      ['visitTableByIds', 'TableByIdsSpec is not supported for table updates'],
      ['visitTableByNameLike', 'TableByNameLikeSpec is not supported for table updates'],
    ] as const;

    for (const [method, message] of unsupported) {
      const result = (
        visitor as Record<
          string,
          (spec: unknown) => {
            isErr(): boolean;
            _unsafeUnwrapErr(): { message: string; code: string };
          }
        >
      )[method](undefined);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: 'validation.invalid',
        message,
      });
    }

    const missingFieldResult = visitor.visitUpdateButtonLabel({
      fieldId: () => FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap(),
    } as never);
    expect(missingFieldResult.isErr()).toBe(true);

    expect(visitor.clone()).toBeInstanceOf(TableMetaUpdateVisitor);
    expect(visitor.and([1] as never, [2] as never)).toEqual([1, 2]);
    expect(visitor.or([1] as never, [2] as never)).toEqual([1, 2]);
    expect(visitor.not([1, 2] as never)).toEqual([1, 2]);
  });
});
