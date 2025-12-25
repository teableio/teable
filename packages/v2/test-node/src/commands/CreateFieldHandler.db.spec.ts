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

type V1Db = V1TeableDatabase & { columns: InfoSchemaColumnRow };

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
});
