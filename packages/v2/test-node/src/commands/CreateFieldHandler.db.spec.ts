/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateFieldCommand,
  CreateTableCommand,
  type CreateFieldResult,
  type CreateTableResult,
  FieldId,
  type ICommandBus,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { createAllFieldTypesFields } from '@teable/v2-table-templates';
import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type InfoSchemaColumnRow = {
  column_name: string;
  table_schema: string;
  table_name: string;
  is_nullable: string;
};

type InfoSchemaTableRow = {
  table_schema: string;
  table_name: string;
};

type InfoSchemaConstraintRow = {
  constraint_name: string;
  constraint_type: string;
  table_schema: string;
  table_name: string;
};

type InfoSchemaConstraintUsageRow = {
  constraint_name: string;
  table_schema: string;
  table_name: string;
  column_name: string;
};

type V1Db = V1TeableDatabase & {
  columns: InfoSchemaColumnRow;
  tables: InfoSchemaTableRow;
  table_constraints: InfoSchemaConstraintRow;
  constraint_column_usage: InfoSchemaConstraintUsageRow;
};

describe('CreateFieldHandler (db)', () => {
  beforeEach(async () => {
    await getV2NodeTestContainer().dispose();
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  it('persists field rows, columns, and formula references', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1Db>>(v2PostgresDbTokens.db);

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };

    const createTableResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Data Check',
      fields: createAllFieldTypesFields(),
    });
    createTableResult._unsafeUnwrap();

    const createdTableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createTableResult._unsafeUnwrap()
    );
    createdTableResult._unsafeUnwrap();

    const createdTable = createdTableResult._unsafeUnwrap().table;
    const tableId = createdTable.id().toString();
    const initialFieldIds = createdTable.getFields().map((field) => field.id().toString());

    const initialFieldRows = await db
      .selectFrom('field')
      .select(['id', 'table_id', 'is_primary'])
      .where('table_id', '=', tableId)
      .execute();
    expect(initialFieldRows).toHaveLength(initialFieldIds.length);
    expect(new Set(initialFieldRows.map((row) => row.id))).toEqual(new Set(initialFieldIds));

    const primaryFieldId = createdTable.primaryFieldId().toString();
    const primaryRow = initialFieldRows.find((row) => row.id === primaryFieldId);
    expect(primaryRow?.is_primary).toBe(true);

    const initialViewRows = await db
      .selectFrom('view')
      .select(['id', 'type', 'column_meta'])
      .where('table_id', '=', tableId)
      .execute();
    expect(initialViewRows).toHaveLength(createdTable.views().length);

    const initialView = createdTable.views()[0];
    expect(initialView).toBeTruthy();
    if (!initialView) return;
    const initialViewMetaResult = initialView.columnMeta();
    initialViewMetaResult._unsafeUnwrap();

    const initialViewMeta = initialViewMetaResult._unsafeUnwrap().toDto();
    const initialViewRow = initialViewRows[0];
    expect(initialViewRow).toBeTruthy();
    if (!initialViewRow) return;
    const initialViewMetaDb = JSON.parse(initialViewRow.column_meta ?? '{}') as Record<
      string,
      { order: number }
    >;
    expect(initialViewRow.type).toBe(initialView.type().toString());
    expect(initialViewMetaDb).toEqual(initialViewMeta);

    const numberFieldId = FieldId.mustGenerate().toString();
    const checkboxFieldId = FieldId.mustGenerate().toString();
    const multiSelectFieldId = FieldId.mustGenerate().toString();
    const formulaFieldId = FieldId.mustGenerate().toString();
    const createdTimeFieldId = FieldId.mustGenerate().toString();
    const createdTimeFieldId2 = FieldId.mustGenerate().toString();
    const lastModifiedTimeFieldId = FieldId.mustGenerate().toString();
    const createdByFieldId = FieldId.mustGenerate().toString();
    const lastModifiedByFieldId = FieldId.mustGenerate().toString();
    const autoNumberFieldId = FieldId.mustGenerate().toString();
    const dateFormatting = { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } as const;

    const fieldCommands = [
      {
        type: 'number',
        id: numberFieldId,
        name: 'Extra Amount',
        options: {
          formatting: { type: 'currency', precision: 2, symbol: '$' },
          showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
          defaultValue: 42,
        },
        notNull: true,
        unique: true,
      },
      {
        type: 'checkbox',
        id: checkboxFieldId,
        name: 'Extra Approved',
        options: { defaultValue: true },
      },
      {
        type: 'multipleSelect',
        id: multiSelectFieldId,
        name: 'Extra Tags',
        options: {
          choices: [
            { id: 'choice-alpha', name: 'Alpha', color: 'blue' },
            { id: 'choice-beta', name: 'Beta', color: 'green' },
          ],
          defaultValue: ['Alpha'],
        },
      },
      {
        type: 'formula',
        id: formulaFieldId,
        name: 'Extra Score',
        options: {
          expression: `{${numberFieldId}} * 2`,
          timeZone: 'utc',
          formatting: { type: 'decimal', precision: 1 },
          showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
        },
      },
      {
        type: 'createdTime',
        id: createdTimeFieldId,
        name: 'Created Time',
        options: {
          formatting: dateFormatting,
        },
      },
      {
        type: 'createdTime',
        id: createdTimeFieldId2,
        name: 'Created Time 2',
        options: {
          formatting: dateFormatting,
        },
      },
      {
        type: 'lastModifiedTime',
        id: lastModifiedTimeFieldId,
        name: 'Last Modified Time',
        options: {
          formatting: dateFormatting,
          trackedFieldIds: [numberFieldId],
        },
      },
      {
        type: 'createdBy',
        id: createdByFieldId,
        name: 'Created By',
      },
      {
        type: 'lastModifiedBy',
        id: lastModifiedByFieldId,
        name: 'Last Modified By',
        options: {
          trackedFieldIds: [checkboxFieldId],
        },
      },
      {
        type: 'autoNumber',
        id: autoNumberFieldId,
        name: 'Auto Number',
      },
    ];

    let latestTable = createdTable;
    for (const field of fieldCommands) {
      const commandResult = CreateFieldCommand.create({
        baseId: baseId.toString(),
        tableId,
        field,
      });
      commandResult._unsafeUnwrap();

      const execResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
        context,
        commandResult._unsafeUnwrap()
      );
      execResult._unsafeUnwrap();

      latestTable = execResult._unsafeUnwrap().table;
    }

    const rows = await db
      .selectFrom('field')
      .select([
        'id',
        'type',
        'cell_value_type',
        'is_multiple_cell_value',
        'db_field_type',
        'db_field_name',
        'not_null',
        'unique',
        'is_computed',
        'options',
        'meta',
        'table_id',
      ])
      .where('id', 'in', [
        numberFieldId,
        checkboxFieldId,
        multiSelectFieldId,
        formulaFieldId,
        createdTimeFieldId,
        createdTimeFieldId2,
        lastModifiedTimeFieldId,
        createdByFieldId,
        lastModifiedByFieldId,
        autoNumberFieldId,
      ])
      .execute();

    const rowById = new Map(rows.map((row) => [row.id, row] as const));
    const parseMeta = (row: (typeof rows)[number]) =>
      row.meta ? (JSON.parse(row.meta) as { persistedAsGeneratedColumn?: boolean }) : undefined;

    const numberRow = rowById.get(numberFieldId);
    expect(numberRow).toBeTruthy();
    if (!numberRow) return;
    expect(numberRow.table_id).toBe(tableId);
    expect(numberRow.type).toBe('number');
    expect(numberRow.cell_value_type).toBe('number');
    expect(numberRow.is_multiple_cell_value).toBe(false);
    expect(numberRow.db_field_type).toBe('REAL');
    expect(numberRow.not_null).toBe(true);
    expect(numberRow.unique).toBe(true);
    expect(numberRow.is_computed).toBeNull();
    expect(numberRow.db_field_name).toBeTruthy();
    expect(JSON.parse(numberRow.options ?? '')).toEqual({
      formatting: { type: 'currency', precision: 2, symbol: '$' },
      showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
      defaultValue: 42,
    });

    const checkboxRow = rowById.get(checkboxFieldId);
    expect(checkboxRow).toBeTruthy();
    if (!checkboxRow) return;
    expect(checkboxRow.type).toBe('checkbox');
    expect(checkboxRow.cell_value_type).toBe('boolean');
    expect(checkboxRow.is_multiple_cell_value).toBe(false);
    expect(checkboxRow.db_field_type).toBe('BOOLEAN');
    expect(checkboxRow.not_null).toBeNull();
    expect(checkboxRow.unique).toBeNull();
    expect(checkboxRow.is_computed).toBeNull();
    expect(JSON.parse(checkboxRow.options ?? '')).toEqual({ defaultValue: true });

    const multiSelectRow = rowById.get(multiSelectFieldId);
    expect(multiSelectRow).toBeTruthy();
    if (!multiSelectRow) return;
    expect(multiSelectRow.type).toBe('multipleSelect');
    expect(multiSelectRow.cell_value_type).toBe('string');
    expect(multiSelectRow.is_multiple_cell_value).toBe(true);
    expect(multiSelectRow.db_field_type).toBe('JSON');
    expect(multiSelectRow.is_computed).toBeNull();
    expect(JSON.parse(multiSelectRow.options ?? '')).toEqual({
      choices: [
        { id: 'choice-alpha', name: 'Alpha', color: 'blue' },
        { id: 'choice-beta', name: 'Beta', color: 'green' },
      ],
      defaultValue: ['Alpha'],
    });

    const formulaRow = rowById.get(formulaFieldId);
    expect(formulaRow).toBeTruthy();
    if (!formulaRow) return;
    expect(formulaRow.type).toBe('formula');
    expect(formulaRow.cell_value_type).toBe('number');
    expect(formulaRow.is_multiple_cell_value).toBe(false);
    expect(formulaRow.db_field_type).toBe('REAL');
    expect(formulaRow.not_null).toBeNull();
    expect(formulaRow.unique).toBeNull();
    expect(formulaRow.is_computed).toBe(true);
    expect(JSON.parse(formulaRow.options ?? '')).toEqual({
      expression: `{${numberFieldId}} * 2`,
      timeZone: 'utc',
      formatting: { type: 'decimal', precision: 1 },
      showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
    });

    const createdTimeRow = rowById.get(createdTimeFieldId);
    expect(createdTimeRow).toBeTruthy();
    if (!createdTimeRow) return;
    expect(createdTimeRow.type).toBe('createdTime');
    expect(createdTimeRow.cell_value_type).toBe('dateTime');
    expect(createdTimeRow.is_multiple_cell_value).toBe(false);
    expect(createdTimeRow.db_field_type).toBe('DATETIME');
    expect(createdTimeRow.is_computed).toBe(true);
    expect(createdTimeRow.db_field_name).toBe('Created_Time');
    expect(parseMeta(createdTimeRow)?.persistedAsGeneratedColumn).toBe(true);
    expect(JSON.parse(createdTimeRow.options ?? '')).toEqual({
      expression: 'CREATED_TIME()',
      formatting: dateFormatting,
    });

    const createdTimeRow2 = rowById.get(createdTimeFieldId2);
    expect(createdTimeRow2).toBeTruthy();
    if (!createdTimeRow2) return;
    expect(createdTimeRow2.type).toBe('createdTime');
    expect(createdTimeRow2.cell_value_type).toBe('dateTime');
    expect(createdTimeRow2.is_multiple_cell_value).toBe(false);
    expect(createdTimeRow2.db_field_type).toBe('DATETIME');
    expect(createdTimeRow2.is_computed).toBe(true);
    expect(createdTimeRow2.db_field_name).toBe('Created_Time_2');
    expect(parseMeta(createdTimeRow2)?.persistedAsGeneratedColumn).toBe(true);
    expect(JSON.parse(createdTimeRow2.options ?? '')).toEqual({
      expression: 'CREATED_TIME()',
      formatting: dateFormatting,
    });

    const lastModifiedTimeRow = rowById.get(lastModifiedTimeFieldId);
    expect(lastModifiedTimeRow).toBeTruthy();
    if (!lastModifiedTimeRow) return;
    expect(lastModifiedTimeRow.type).toBe('lastModifiedTime');
    expect(lastModifiedTimeRow.cell_value_type).toBe('dateTime');
    expect(lastModifiedTimeRow.is_multiple_cell_value).toBe(false);
    expect(lastModifiedTimeRow.db_field_type).toBe('DATETIME');
    expect(lastModifiedTimeRow.is_computed).toBe(true);
    expect(lastModifiedTimeRow.db_field_name).toBe('Last_Modified_Time');
    expect(parseMeta(lastModifiedTimeRow)?.persistedAsGeneratedColumn).not.toBe(true);
    expect(JSON.parse(lastModifiedTimeRow.options ?? '')).toEqual({
      expression: 'LAST_MODIFIED_TIME()',
      formatting: dateFormatting,
      trackedFieldIds: [numberFieldId],
    });

    const createdByRow = rowById.get(createdByFieldId);
    expect(createdByRow).toBeTruthy();
    if (!createdByRow) return;
    expect(createdByRow.type).toBe('createdBy');
    expect(createdByRow.cell_value_type).toBe('string');
    expect(createdByRow.is_multiple_cell_value).toBe(false);
    expect(createdByRow.db_field_type).toBe('JSON');
    expect(createdByRow.is_computed).toBe(true);
    expect(createdByRow.db_field_name).toBe('Created_By');
    // CreatedBy is NOT persisted as generated column - it's populated via INSERT subquery
    expect(parseMeta(createdByRow)?.persistedAsGeneratedColumn).not.toBe(true);
    expect(JSON.parse(createdByRow.options ?? '')).toEqual({});

    const lastModifiedByRow = rowById.get(lastModifiedByFieldId);
    expect(lastModifiedByRow).toBeTruthy();
    if (!lastModifiedByRow) return;
    expect(lastModifiedByRow.type).toBe('lastModifiedBy');
    expect(lastModifiedByRow.cell_value_type).toBe('string');
    expect(lastModifiedByRow.is_multiple_cell_value).toBe(false);
    expect(lastModifiedByRow.db_field_type).toBe('JSON');
    expect(lastModifiedByRow.is_computed).toBe(true);
    expect(lastModifiedByRow.db_field_name).toBe('Last_Modified_By');
    expect(parseMeta(lastModifiedByRow)?.persistedAsGeneratedColumn).not.toBe(true);
    expect(JSON.parse(lastModifiedByRow.options ?? '')).toEqual({
      trackedFieldIds: [checkboxFieldId],
    });

    const autoNumberRow = rowById.get(autoNumberFieldId);
    expect(autoNumberRow).toBeTruthy();
    if (!autoNumberRow) return;
    expect(autoNumberRow.type).toBe('autoNumber');
    expect(autoNumberRow.cell_value_type).toBe('number');
    expect(autoNumberRow.is_multiple_cell_value).toBe(false);
    expect(autoNumberRow.db_field_type).toBe('REAL');
    expect(autoNumberRow.is_computed).toBe(true);
    expect(autoNumberRow.db_field_name).toBe('Auto_Number');
    expect(parseMeta(autoNumberRow)?.persistedAsGeneratedColumn).toBe(true);
    expect(JSON.parse(autoNumberRow.options ?? '')).toEqual({
      expression: 'AUTO_NUMBER()',
    });

    const metaRow = await db
      .selectFrom('table_meta')
      .select(['db_table_name'])
      .where('id', '=', tableId)
      .executeTakeFirst();
    expect(metaRow).toBeTruthy();
    if (!metaRow) return;

    const parts = String(metaRow.db_table_name).split('.');
    const schemaName = parts.length > 1 ? parts[0] : 'public';
    const tableName = parts.length > 1 ? parts[1] : parts[0];
    const columnRows = await db
      .withSchema('information_schema')
      .selectFrom('columns')
      .select(['column_name', 'is_nullable'])
      .where('table_schema', '=', schemaName)
      .where('table_name', '=', tableName)
      .execute();
    const columnByName = new Map(columnRows.map((row) => [row.column_name, row] as const));

    for (const row of rows) {
      expect(columnByName.has(row.db_field_name)).toBe(true);
    }

    const numberColumn = columnByName.get(numberRow.db_field_name);
    expect(numberColumn?.is_nullable).toBe('NO');

    const indexName = `${tableName}_${numberRow.db_field_name}_unique`;
    const indexRows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom('pg_index as idx')
      .innerJoin('pg_class as table_class', 'table_class.oid', 'idx.indrelid')
      .innerJoin(
        'pg_namespace as table_namespace',
        'table_namespace.oid',
        'table_class.relnamespace'
      )
      .innerJoin('pg_class as index_class', 'index_class.oid', 'idx.indexrelid')
      .select(['index_class.relname as index_name', 'idx.indisunique as is_unique'])
      .where('table_namespace.nspname', '=', schemaName)
      .where('table_class.relname', '=', tableName)
      .execute();
    const indexByName = new Map(indexRows.map((row) => [String(row.index_name), row] as const));
    const uniqueIndex = indexByName.get(indexName);
    expect(uniqueIndex?.is_unique).toBe(true);

    const referenceRows = await db
      .selectFrom('reference')
      .select(['from_field_id', 'to_field_id'])
      .where('to_field_id', '=', formulaFieldId)
      .execute();
    expect(referenceRows).toEqual([{ from_field_id: numberFieldId, to_field_id: formulaFieldId }]);

    const updatedViewRows = await db
      .selectFrom('view')
      .select(['id', 'column_meta'])
      .where('table_id', '=', tableId)
      .execute();
    expect(updatedViewRows).toHaveLength(latestTable.views().length);

    const updatedView = latestTable.views()[0];
    expect(updatedView).toBeTruthy();
    if (!updatedView) return;
    const updatedMetaResult = updatedView.columnMeta();
    updatedMetaResult._unsafeUnwrap();

    const updatedViewMeta = updatedMetaResult._unsafeUnwrap().toDto();
    const updatedViewRow = updatedViewRows[0];
    expect(updatedViewRow).toBeTruthy();
    if (!updatedViewRow) return;
    const updatedViewMetaDb = JSON.parse(updatedViewRow.column_meta ?? '{}') as Record<
      string,
      { order: number }
    >;
    expect(updatedViewMetaDb).toEqual(updatedViewMeta);
  });

  it('persists all field types and link side effects', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1Db>>(v2PostgresDbTokens.db);

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };

    const createHostResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Host Table',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    createHostResult._unsafeUnwrap();

    const hostExec = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createHostResult._unsafeUnwrap()
    );

    const hostTable = hostExec._unsafeUnwrap().table;
    const hostTableId = hostTable.id().toString();

    const createForeignResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Foreign Table',
      fields: [{ type: 'singleLineText', name: 'Title' }],
    });

    const foreignExec = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createForeignResult._unsafeUnwrap()
    );

    const foreignTable = foreignExec._unsafeUnwrap().table;
    const foreignTableId = foreignTable.id().toString();
    const foreignPrimaryFieldId = foreignTable.primaryFieldId().toString();

    const singleLineId = `fld${'a'.repeat(16)}`;
    const longTextId = `fld${'b'.repeat(16)}`;
    const numberId = `fld${'c'.repeat(16)}`;
    const ratingId = `fld${'d'.repeat(16)}`;
    const singleSelectId = `fld${'e'.repeat(16)}`;
    const multipleSelectId = `fld${'f'.repeat(16)}`;
    const checkboxId = `fld${'g'.repeat(16)}`;
    const attachmentId = `fld${'h'.repeat(16)}`;
    const dateId = `fld${'i'.repeat(16)}`;
    const userId = `fld${'j'.repeat(16)}`;
    const buttonId = `fld${'k'.repeat(16)}`;
    const formulaId = `fld${'l'.repeat(16)}`;
    const linkId = `fld${'m'.repeat(16)}`;
    const symmetricLinkId = `fld${'n'.repeat(16)}`;

    const fieldCommands = [
      {
        id: singleLineId,
        field: {
          type: 'singleLineText',
          id: singleLineId,
          name: 'Title',
          options: { showAs: { type: 'email' }, defaultValue: 'hello@example.com' },
        },
        expect: {
          type: 'singleLineText',
          cellValueType: 'string',
          isMultiple: false,
          dbFieldType: 'TEXT',
        },
      },
      {
        id: longTextId,
        field: {
          type: 'longText',
          id: longTextId,
          name: 'Notes',
          options: { defaultValue: 'Details' },
        },
        expect: {
          type: 'longText',
          cellValueType: 'string',
          isMultiple: false,
          dbFieldType: 'TEXT',
        },
      },
      {
        id: numberId,
        field: {
          type: 'number',
          id: numberId,
          name: 'Amount',
          options: {
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
            defaultValue: 42,
          },
        },
        expect: {
          type: 'number',
          cellValueType: 'number',
          isMultiple: false,
          dbFieldType: 'REAL',
        },
      },
      {
        id: ratingId,
        field: {
          type: 'rating',
          id: ratingId,
          name: 'Priority',
          options: { max: 7, icon: 'star', color: 'yellowBright' },
        },
        expect: {
          type: 'rating',
          cellValueType: 'number',
          isMultiple: false,
          dbFieldType: 'REAL',
        },
      },
      {
        id: singleSelectId,
        field: {
          type: 'singleSelect',
          id: singleSelectId,
          name: 'Status',
          options: {
            choices: [
              { id: 'opt1', name: 'Todo', color: 'blue' },
              { id: 'opt2', name: 'Done', color: 'green' },
            ],
            defaultValue: 'Todo',
          },
        },
        expect: {
          type: 'singleSelect',
          cellValueType: 'string',
          isMultiple: false,
          dbFieldType: 'TEXT',
        },
      },
      {
        id: multipleSelectId,
        field: {
          type: 'multipleSelect',
          id: multipleSelectId,
          name: 'Tags',
          options: {
            choices: [
              { id: 'opt3', name: 'Alpha', color: 'purple' },
              { id: 'opt4', name: 'Beta', color: 'orange' },
            ],
            defaultValue: ['Alpha', 'Beta'],
          },
        },
        expect: {
          type: 'multipleSelect',
          cellValueType: 'string',
          isMultiple: true,
          dbFieldType: 'JSON',
        },
      },
      {
        id: checkboxId,
        field: {
          type: 'checkbox',
          id: checkboxId,
          name: 'Approved',
          options: { defaultValue: true },
        },
        expect: {
          type: 'checkbox',
          cellValueType: 'boolean',
          isMultiple: false,
          dbFieldType: 'BOOLEAN',
        },
      },
      {
        id: attachmentId,
        field: {
          type: 'attachment',
          id: attachmentId,
          name: 'Files',
        },
        expect: {
          type: 'attachment',
          cellValueType: 'string',
          isMultiple: true,
          dbFieldType: 'JSON',
        },
      },
      {
        id: dateId,
        field: {
          type: 'date',
          id: dateId,
          name: 'Due',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            defaultValue: 'now',
          },
        },
        expect: {
          type: 'date',
          cellValueType: 'dateTime',
          isMultiple: false,
          dbFieldType: 'DATETIME',
        },
      },
      {
        id: userId,
        field: {
          type: 'user',
          id: userId,
          name: 'Owner',
          options: {
            isMultiple: true,
            shouldNotify: false,
            defaultValue: ['usr1', 'usr2'],
          },
        },
        expect: {
          type: 'user',
          cellValueType: 'string',
          isMultiple: true,
          dbFieldType: 'JSON',
        },
      },
      {
        id: buttonId,
        field: {
          type: 'button',
          id: buttonId,
          name: 'Action',
          options: {
            label: 'Run',
            color: 'teal',
            maxCount: 9,
            resetCount: true,
            workflow: { id: 'wfl123', name: 'Flow', isActive: true },
          },
        },
        expect: {
          type: 'button',
          cellValueType: 'string',
          isMultiple: false,
          dbFieldType: 'JSON',
        },
      },
      {
        id: formulaId,
        field: {
          type: 'formula',
          id: formulaId,
          name: 'Score',
          options: {
            expression: `{${numberId}} * 2`,
            timeZone: 'utc',
            formatting: { type: 'decimal', precision: 1 },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
          },
        },
        expect: {
          type: 'formula',
          cellValueType: 'number',
          isMultiple: false,
          dbFieldType: 'REAL',
          isComputed: true,
        },
      },
      {
        id: linkId,
        field: {
          type: 'link',
          id: linkId,
          name: 'Related',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTableId,
            lookupFieldId: foreignPrimaryFieldId,
            symmetricFieldId: symmetricLinkId,
          },
        },
        expect: {
          type: 'link',
          cellValueType: 'string',
          isMultiple: true,
          dbFieldType: 'JSON',
        },
      },
    ];

    for (const entry of fieldCommands) {
      const commandResult = CreateFieldCommand.create({
        baseId: baseId.toString(),
        tableId: hostTableId,
        field: entry.field,
      });
      commandResult._unsafeUnwrap();

      const execResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
        context,
        commandResult._unsafeUnwrap()
      );
      execResult._unsafeUnwrap();
    }

    const fieldIds = fieldCommands.map((entry) => entry.id);
    const rows = await db
      .selectFrom('field')
      .select([
        'id',
        'type',
        'cell_value_type',
        'is_multiple_cell_value',
        'db_field_type',
        'db_field_name',
        'is_computed',
        'table_id',
      ])
      .where('id', 'in', fieldIds)
      .execute();
    const rowById = new Map(rows.map((row) => [row.id, row] as const));

    for (const entry of fieldCommands) {
      const row = rowById.get(entry.id);
      expect(row).toBeTruthy();
      if (!row) return;
      expect(row.table_id).toBe(hostTableId);
      expect(row.type).toBe(entry.expect.type);
      expect(row.cell_value_type).toBe(entry.expect.cellValueType);
      expect(row.is_multiple_cell_value).toBe(entry.expect.isMultiple);
      expect(row.db_field_type).toBe(entry.expect.dbFieldType);
      if (entry.expect.isComputed) {
        expect(row.is_computed).toBe(true);
      } else {
        expect(row.is_computed).toBeNull();
      }
      expect(row.db_field_name).toBeTruthy();
    }

    const hostMetaRow = await db
      .selectFrom('table_meta')
      .select(['db_table_name'])
      .where('id', '=', hostTableId)
      .executeTakeFirst();
    expect(hostMetaRow).toBeTruthy();
    if (!hostMetaRow) return;

    const hostParts = String(hostMetaRow.db_table_name).split('.');
    const hostSchema = hostParts.length > 1 ? hostParts[0] : 'public';
    const hostTableName = hostParts.length > 1 ? hostParts[1] : hostParts[0];
    const hostColumns = await db
      .withSchema('information_schema')
      .selectFrom('columns')
      .select(['column_name'])
      .where('table_schema', '=', hostSchema)
      .where('table_name', '=', hostTableName)
      .execute();
    const hostColumnNames = new Set(hostColumns.map((row) => row.column_name));

    for (const entry of fieldCommands) {
      const row = rowById.get(entry.id);
      if (!row) return;
      expect(hostColumnNames.has(row.db_field_name)).toBe(true);
    }

    const symmetricRow = await db
      .selectFrom('field')
      .select([
        'id',
        'type',
        'cell_value_type',
        'is_multiple_cell_value',
        'db_field_type',
        'db_field_name',
        'table_id',
      ])
      .where('id', '=', symmetricLinkId)
      .executeTakeFirst();
    expect(symmetricRow).toBeTruthy();
    if (!symmetricRow) return;
    expect(symmetricRow.table_id).toBe(foreignTableId);
    expect(symmetricRow.type).toBe('link');
    expect(symmetricRow.cell_value_type).toBe('string');
    expect(symmetricRow.is_multiple_cell_value).toBe(true);
    expect(symmetricRow.db_field_type).toBe('JSON');
    expect(symmetricRow.db_field_name).toBeTruthy();

    const foreignMetaRow = await db
      .selectFrom('table_meta')
      .select(['db_table_name'])
      .where('id', '=', foreignTableId)
      .executeTakeFirst();
    expect(foreignMetaRow).toBeTruthy();
    if (!foreignMetaRow) return;

    const foreignParts = String(foreignMetaRow.db_table_name).split('.');
    const foreignSchema = foreignParts.length > 1 ? foreignParts[0] : 'public';
    const foreignTableName = foreignParts.length > 1 ? foreignParts[1] : foreignParts[0];
    const foreignColumns = await db
      .withSchema('information_schema')
      .selectFrom('columns')
      .select(['column_name'])
      .where('table_schema', '=', foreignSchema)
      .where('table_name', '=', foreignTableName)
      .execute();
    const foreignColumnNames = new Set(foreignColumns.map((row) => row.column_name));
    expect(foreignColumnNames.has(symmetricRow.db_field_name)).toBe(true);

    const junctionTableName = `junction_${linkId}_${symmetricLinkId}`;
    const junctionRows = await db
      .withSchema('information_schema')
      .selectFrom('tables')
      .select(['table_name'])
      .where('table_schema', '=', baseId.toString())
      .where('table_name', '=', junctionTableName)
      .execute();
    expect(junctionRows).toHaveLength(1);
    const junctionColumns = await db
      .withSchema('information_schema')
      .selectFrom('columns')
      .select(['column_name'])
      .where('table_schema', '=', baseId.toString())
      .where('table_name', '=', junctionTableName)
      .execute();
    const junctionColumnNames = new Set(junctionColumns.map((row) => row.column_name));
    expect(junctionColumnNames.has('__id')).toBe(true);

    const linkReferenceRows = await db
      .selectFrom('reference')
      .select(['from_field_id', 'to_field_id'])
      .where('to_field_id', 'in', [formulaId, linkId, symmetricLinkId])
      .orderBy('to_field_id')
      .orderBy('from_field_id')
      .execute();
    expect(linkReferenceRows).toEqual([
      { from_field_id: numberId, to_field_id: formulaId },
      { from_field_id: foreignPrimaryFieldId, to_field_id: linkId },
      { from_field_id: hostTable.primaryFieldId().toString(), to_field_id: symmetricLinkId },
    ]);
  });
});
