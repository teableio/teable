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
import { allFieldTypesTemplate } from '@teable/v2-table-templates';
import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type InfoSchemaColumnRow = {
  column_name: string;
  table_schema: string;
  table_name: string;
};

type InfoSchemaTableRow = {
  table_schema: string;
  table_name: string;
};

type V1Db = V1TeableDatabase & { columns: InfoSchemaColumnRow; tables: InfoSchemaTableRow };

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
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;
    const context = { actorId: actorIdResult.value };

    const createTableResult = CreateTableCommand.create(
      allFieldTypesTemplate.createInput(baseId.toString(), 'Data Check')
    );
    expect(createTableResult.isOk()).toBe(true);
    if (createTableResult.isErr()) return;

    const createdTableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createTableResult.value
    );
    expect(createdTableResult.isOk()).toBe(true);
    if (createdTableResult.isErr()) return;

    const createdTable = createdTableResult.value.table;
    const tableId = createdTable.id().toString();
    const initialFieldIds = createdTable.fields().map((field) => field.id().toString());

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
    expect(initialViewMetaResult.isOk()).toBe(true);
    if (initialViewMetaResult.isErr()) return;
    const initialViewMeta = initialViewMetaResult.value.toDto();
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
    ];

    let latestTable = createdTable;
    for (const field of fieldCommands) {
      const commandResult = CreateFieldCommand.create({
        baseId: baseId.toString(),
        tableId,
        field,
      });
      expect(commandResult.isOk()).toBe(true);
      if (commandResult.isErr()) return;

      const execResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
        context,
        commandResult.value
      );
      expect(execResult.isOk()).toBe(true);
      if (execResult.isErr()) return;
      latestTable = execResult.value.table;
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
        'is_computed',
        'options',
        'table_id',
      ])
      .where('id', 'in', [numberFieldId, checkboxFieldId, multiSelectFieldId, formulaFieldId])
      .execute();

    const rowById = new Map(rows.map((row) => [row.id, row] as const));

    const numberRow = rowById.get(numberFieldId);
    expect(numberRow).toBeTruthy();
    if (!numberRow) return;
    expect(numberRow.table_id).toBe(tableId);
    expect(numberRow.type).toBe('number');
    expect(numberRow.cell_value_type).toBe('number');
    expect(numberRow.is_multiple_cell_value).toBe(false);
    expect(numberRow.db_field_type).toBe('REAL');
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
    expect(formulaRow.is_computed).toBe(true);
    expect(JSON.parse(formulaRow.options ?? '')).toEqual({
      expression: `{${numberFieldId}} * 2`,
      timeZone: 'utc',
      formatting: { type: 'decimal', precision: 1 },
      showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
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
      .select(['column_name'])
      .where('table_schema', '=', schemaName)
      .where('table_name', '=', tableName)
      .execute();
    const columnNames = new Set(columnRows.map((row) => row.column_name));

    for (const row of rows) {
      expect(columnNames.has(row.db_field_name)).toBe(true);
    }

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
    expect(updatedMetaResult.isOk()).toBe(true);
    if (updatedMetaResult.isErr()) return;
    const updatedViewMeta = updatedMetaResult.value.toDto();
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
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;
    const context = { actorId: actorIdResult.value };

    const createHostResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Host Table',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    expect(createHostResult.isOk()).toBe(true);
    if (createHostResult.isErr()) return;

    const hostExec = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createHostResult.value
    );
    expect(hostExec.isOk()).toBe(true);
    if (hostExec.isErr()) return;
    const hostTable = hostExec.value.table;
    const hostTableId = hostTable.id().toString();

    const createForeignResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Foreign Table',
      fields: [{ type: 'singleLineText', name: 'Title' }],
    });
    expect(createForeignResult.isOk()).toBe(true);
    if (createForeignResult.isErr()) return;

    const foreignExec = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createForeignResult.value
    );
    expect(foreignExec.isOk()).toBe(true);
    if (foreignExec.isErr()) return;
    const foreignTable = foreignExec.value.table;
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
      expect(commandResult.isOk()).toBe(true);
      if (commandResult.isErr()) return;

      const execResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
        context,
        commandResult.value
      );
      expect(execResult.isOk()).toBe(true);
      if (execResult.isErr()) return;
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
