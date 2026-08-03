/* eslint-disable @typescript-eslint/naming-convention */
import { sql } from 'kysely';
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

type TableLike = {
  id: string;
  fields: Array<{
    id: string;
    name: string;
    isPrimary?: boolean;
  }>;
};

type SelectFieldLike = {
  id: string;
  type: string;
  options?: unknown;
};

type SelectOptionsDto = {
  choices?: Array<{ id: string; name: string; color: string }>;
};

const getSelectChoiceNames = (field?: SelectFieldLike): string[] => {
  const options = (field?.options as SelectOptionsDto | undefined) ?? {};
  return options.choices?.map((choice) => choice.name).sort() ?? [];
};

const primaryFieldId = (table: TableLike): string => {
  const fieldId = table.fields.find((f) => f.isPrimary)?.id;
  if (!fieldId) throw new Error(`Primary field missing in table ${table.id}`);
  return fieldId;
};

describe('update-field: link to multipleSelect conversion', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  const hasColumnInTable = async (tableId: string, columnName: string): Promise<boolean> => {
    const result = await sql<{ count: string }>`
      SELECT COUNT(*)::int as count
      FROM information_schema.columns
      WHERE table_schema = ${ctx.baseId}
      AND table_name = ${tableId}
      AND column_name = ${columnName}
    `.execute(ctx.testContainer.db);

    return parseInt(result.rows[0].count, 10) > 0;
  };

  const getFkValueByRecordId = async (
    tableId: string,
    fieldId: string,
    recordId: string
  ): Promise<string | null> => {
    const result = await sql<{ fk_value: string | null }>`
      SELECT ${sql.ref(`__fk_${fieldId}`)} as fk_value
      FROM ${sql.table(`${ctx.baseId}.${tableId}`)}
      WHERE "__id" = ${recordId}
    `.execute(ctx.testContainer.db);

    if (result.rows.length !== 1) {
      throw new Error(`Expected one record for ${recordId}, got ${result.rows.length}`);
    }

    return result.rows[0].fk_value;
  };

  const getJunctionTableNameByFieldId = async (fieldId: string): Promise<string | undefined> => {
    const result = await sql<{ table_name: string }>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${ctx.baseId}
      AND table_name LIKE ${'junction_%'}
    `.execute(ctx.testContainer.db);

    return result.rows.find((r) => r.table_name.includes(fieldId))?.table_name;
  };

  const hasTableInBase = async (tableName: string): Promise<boolean> => {
    const result = await sql<{ count: string }>`
      SELECT COUNT(*)::int as count
      FROM information_schema.tables
      WHERE table_schema = ${ctx.baseId}
      AND table_name = ${tableName}
    `.execute(ctx.testContainer.db);

    return parseInt(result.rows[0].count, 10) > 0;
  };

  const getJunctionRows = async (
    junctionTableName: string
  ): Promise<Array<Record<string, unknown>>> => {
    const result = await sql`
      SELECT * FROM "${sql.raw(ctx.baseId)}"."${sql.raw(junctionTableName)}"
    `.execute(ctx.testContainer.db);

    return result.rows as Array<Record<string, unknown>>;
  };

  test('should convert many-one one-way link to multipleSelect with immediate generated choices', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('l2ms-mo-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('l2ms-mo-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const linkTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'manyOne',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: true,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const b = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'x' });
    const a = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'a1',
      [linkField.id]: { id: b.id },
    });
    await ctx.drainOutbox();

    expect(await hasColumnInTable(tableA.id, `__fk_${linkField.id}`)).toBe(true);
    expect(await getFkValueByRecordId(tableA.id, linkField.id, a.id)).toBe(b.id);

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: { type: 'multipleSelect' },
    });
    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedField?.type).toBe('multipleSelect');
    expect(getSelectChoiceNames(updatedField as SelectFieldLike | undefined)).toEqual(['x']);

    const refreshedTable = await ctx.getTableById(tableA.id);
    const refreshedField = refreshedTable.fields.find((f) => f.id === linkField.id) as
      | SelectFieldLike
      | undefined;
    expect(getSelectChoiceNames(refreshedField)).toEqual(['x']);

    const rows = await ctx.listRecords(tableA.id);
    const row = rows.find((r) => r.id === a.id);
    expect(row?.fields[linkField.id]).toEqual(['x']);
    expect(await hasColumnInTable(tableA.id, `__fk_${linkField.id}`)).toBe(false);
  });

  test('should convert one-many one-way link to multipleSelect with immediate generated choices', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('l2ms-om-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('l2ms-om-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const linkTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'oneMany',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: true,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const b1 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'x' });
    const b2 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'y' });
    const a = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'a1',
      [linkField.id]: [{ id: b1.id }, { id: b2.id }],
    });
    await ctx.drainOutbox();

    const junctionTableName = await getJunctionTableNameByFieldId(linkField.id);
    expect(junctionTableName).toBeDefined();
    const beforeRows = await getJunctionRows(junctionTableName!);
    const beforeMatches = beforeRows.filter((r) => Object.values(r).includes(a.id));
    expect(beforeMatches.length).toBe(2);

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: { type: 'multipleSelect' },
    });
    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedField?.type).toBe('multipleSelect');
    expect(getSelectChoiceNames(updatedField as SelectFieldLike | undefined)).toEqual(['x', 'y']);

    const refreshedTable = await ctx.getTableById(tableA.id);
    const refreshedField = refreshedTable.fields.find((f) => f.id === linkField.id) as
      | SelectFieldLike
      | undefined;
    expect(getSelectChoiceNames(refreshedField)).toEqual(['x', 'y']);

    const rows = await ctx.listRecords(tableA.id);
    const row = rows.find((r) => r.id === a.id);
    expect(row?.fields[linkField.id]).toEqual(['x', 'y']);

    if (junctionTableName && (await hasTableInBase(junctionTableName))) {
      const afterRows = await getJunctionRows(junctionTableName);
      const afterMatches = afterRows.filter((r) => Object.values(r).includes(a.id));
      expect(afterMatches.length).toBe(0);
    }
  });

  test('should keep null when converting empty one-many one-way link to multipleSelect', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('l2ms-om-null-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('l2ms-om-null-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const linkTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'oneMany',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: true,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const a = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'a-null',
    });
    await ctx.drainOutbox();

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: { type: 'multipleSelect' },
    });
    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedField?.type).toBe('multipleSelect');

    const refreshedTable = await ctx.getTableById(tableA.id);
    const refreshedField = refreshedTable.fields.find((f) => f.id === linkField.id) as
      | SelectFieldLike
      | undefined;
    expect(getSelectChoiceNames(refreshedField)).toEqual([]);

    const rows = await ctx.listRecords(tableA.id);
    const row = rows.find((r) => r.id === a.id);
    expect(row?.fields[linkField.id]).toBeNull();
  });
});
