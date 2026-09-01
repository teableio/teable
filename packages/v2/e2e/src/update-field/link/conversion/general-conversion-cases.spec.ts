/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

type TableLike = {
  id: string;
  fields: Array<{
    id: string;
    name: string;
    isPrimary?: boolean;
    type?: string;
    options?: Record<string, unknown>;
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

const asLinkArray = (value: unknown): Array<{ id: string; title?: string }> => {
  if (!value) return [];
  if (Array.isArray(value)) return value as Array<{ id: string; title?: string }>;
  return [value as { id: string; title?: string }];
};

const extractSymmetricFieldId = (field: { options?: unknown } | undefined): string | undefined => {
  const options = field?.options as Record<string, unknown> | undefined;
  return typeof options?.symmetricFieldId === 'string' ? options.symmetricFieldId : undefined;
};

const primaryFieldId = (table: TableLike): string => {
  const fieldId = table.fields.find((f) => f.isPrimary)?.id;
  if (!fieldId) throw new Error(`Primary field missing in table ${table.id}`);
  return fieldId;
};

const getSelectChoiceNames = (field?: SelectFieldLike): string[] => {
  const options = (field?.options as SelectOptionsDto | undefined) ?? {};
  return options.choices?.map((choice) => choice.name).sort() ?? [];
};

describe('update-field: link conversion general cases', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  test('should convert text to one-many link', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-text-om-a'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'ToConvert' },
      ],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-text-om-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const titleFieldId = primaryFieldId(tableB);
    const toConvertFieldId = tableA.fields.find((f) => f.name === 'ToConvert')?.id;
    if (!toConvertFieldId) throw new Error('ToConvert field missing');

    const b1 = await ctx.createRecord(tableB.id, { [titleFieldId]: 'x' });
    const b2 = await ctx.createRecord(tableB.id, { [titleFieldId]: 'y' });
    const a1 = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'row-a1',
      [toConvertFieldId]: 'x, y',
    });

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: toConvertFieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'oneMany',
          foreignTableId: tableB.id,
          lookupFieldId: titleFieldId,
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === toConvertFieldId);
    expect(updatedField?.type).toBe('link');

    const rows = await ctx.listRecords(tableA.id);
    const row = rows.find((r) => r.id === a1.id);
    const links = asLinkArray(row?.fields[toConvertFieldId]);
    expect(links.map((l) => l.id)).toEqual([b1.id, b2.id]);
    expect(links.map((l) => l.title)).toEqual(['x', 'y']);
  });

  test('should convert 2k text cells to many-one links by foreign primary title', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-bulk-text-link-a'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'Agency Code Text' },
      ],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-bulk-text-link-b'),
      fields: [{ type: 'singleLineText', name: 'Agency Code', isPrimary: true }],
    });

    const codeFieldId = primaryFieldId(tableB);
    const sourceFieldId = tableA.fields.find((f) => f.name === 'Agency Code Text')?.id;
    const nameFieldId = primaryFieldId(tableA);
    if (!sourceFieldId) throw new Error('Agency Code Text field missing');

    const codes = ['US', 'BR', 'TW', 'CN', 'JP', 'DE', 'FR', 'IN', 'AU', 'ZA'];
    const codeRecordMap = new Map<string, string>();
    for (const code of codes) {
      const record = await ctx.createRecord(tableB.id, { [codeFieldId]: code });
      codeRecordMap.set(code, record.id);
    }

    const totalRecords = 2000;
    const expectedCodeByRecordId = new Map<string, string>();
    const payload = Array.from({ length: totalRecords }, (_, index) => {
      const code = codes[index % codes.length];
      return {
        fields: {
          [nameFieldId]: `Record-${index + 1}`,
          [sourceFieldId]: code,
        },
      };
    });

    const createdRecords = await ctx.createRecords(tableA.id, payload);
    createdRecords.forEach((record, index) => {
      expectedCodeByRecordId.set(record.id, codes[index % codes.length]);
    });

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: sourceFieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: tableB.id,
          lookupFieldId: codeFieldId,
          isOneWay: true,
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === sourceFieldId);
    expect(updatedField?.type).toBe('link');

    await ctx.drainOutbox();

    const matched = new Map<string, { id: string; fields: Record<string, unknown> }>();
    for (let offset = 0; matched.size < totalRecords; offset += 500) {
      const rows = await ctx.listRecords(tableA.id, { offset, limit: 500 });
      if (!rows.length) break;
      for (const row of rows) {
        if (expectedCodeByRecordId.has(row.id)) {
          matched.set(row.id, row);
        }
      }
    }

    expect(matched.size).toBe(totalRecords);

    matched.forEach((row, recordId) => {
      const expectedCode = expectedCodeByRecordId.get(recordId);
      if (!expectedCode) throw new Error(`Missing expected code for record ${recordId}`);
      const expectedForeignRecordId = codeRecordMap.get(expectedCode);
      if (!expectedForeignRecordId)
        throw new Error(`Missing foreign record for code ${expectedCode}`);

      const links = asLinkArray(row.fields[sourceFieldId]);
      expect(links).toHaveLength(1);
      expect(links[0]?.id).toBe(expectedForeignRecordId);
      expect(links[0]?.title).toBe(expectedCode);
    });
  });

  test('should convert many-one link to text', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-mo-text-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-mo-text-b'),
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
          isOneWay: false,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const b = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'x' });
    const a = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'row-a',
      [linkField.id]: { id: b.id },
    });

    await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: { type: 'singleLineText' },
    });

    await ctx.drainOutbox();

    const rows = await ctx.listRecords(tableA.id);
    const row = rows.find((r) => r.id === a.id);
    expect(row?.fields[linkField.id]).toBe('x');
  });

  test('should return stale choices in immediate payload and generated choices after refresh when converting many-one link to singleSelect', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-mo-single-select-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-mo-single-select-b'),
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
          isOneWay: false,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const b = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'x' });
    const a = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'row-a',
      [linkField.id]: { id: b.id },
    });

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: { type: 'singleSelect' },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id) as
      | SelectFieldLike
      | undefined;
    expect(updatedField?.type).toBe('singleSelect');
    expect(getSelectChoiceNames(updatedField)).toEqual(['x']);

    const refreshedTable = await ctx.getTableById(tableA.id);
    const refreshedField = refreshedTable.fields.find((f) => f.id === linkField.id) as
      | SelectFieldLike
      | undefined;
    expect(getSelectChoiceNames(refreshedField)).toEqual(['x']);

    const rows = await ctx.listRecords(tableA.id);
    const row = rows.find((r) => r.id === a.id);
    expect(row?.fields[linkField.id]).toBe('x');
  });

  test('should convert one-many link to text', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-text-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-text-b'),
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
          isOneWay: false,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const b1 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'x' });
    const b2 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'y' });
    const a = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'row-a',
      [linkField.id]: [{ id: b1.id }, { id: b2.id }],
    });

    await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: { type: 'singleLineText' },
    });

    await ctx.drainOutbox();

    const rows = await ctx.listRecords(tableA.id);
    const row = rows.find((r) => r.id === a.id);
    expect(row?.fields[linkField.id]).toBe('x, y');
  });

  test('should convert many-one to one-many link with in cell illegal', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-mo-om-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-mo-om-b'),
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
          isOneWay: false,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const b = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'b1' });
    const a = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'a1',
      [linkField.id]: { id: b.id },
    });

    await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'oneMany',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const rows = await ctx.listRecords(tableA.id);
    const row = rows.find((r) => r.id === a.id);
    const links = asLinkArray(row?.fields[linkField.id]);
    expect(links[0]?.id).toBe(b.id);
  });

  test('should convert one-many to many-one link', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-mo-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-mo-b'),
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
          isOneWay: false,
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

    await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'manyOne',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const rows = await ctx.listRecords(tableA.id);
    const row = rows.find((r) => r.id === a.id);
    expect(row?.fields[linkField.id]).toEqual({ id: b1.id, title: 'x' });
  });

  test('should convert one-way one-many to two-way many-one link with existing values', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-om-to-tw-mo-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-om-to-tw-mo-b'),
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
    const b3 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'zzz' });
    const a1 = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'a1',
      [linkField.id]: [{ id: b1.id }, { id: b2.id }],
    });
    const a2 = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'a2',
      [linkField.id]: [{ id: b3.id }],
    });

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'manyOne',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    const symFieldId = extractSymmetricFieldId(updatedField);
    expect(symFieldId).toBeDefined();

    const rowsA = await ctx.listRecords(tableA.id);
    const rowA1 = rowsA.find((r) => r.id === a1.id);
    const rowA2 = rowsA.find((r) => r.id === a2.id);
    expect(rowA1?.fields[linkField.id]).toEqual({ id: b1.id, title: 'x' });
    expect(rowA2?.fields[linkField.id]).toEqual({ id: b3.id, title: 'zzz' });

    const rowsB = await ctx.listRecords(tableB.id);
    const rowB1 = rowsB.find((r) => r.id === b1.id);
    const rowB2 = rowsB.find((r) => r.id === b2.id);
    const rowB3 = rowsB.find((r) => r.id === b3.id);
    expect(asLinkArray(rowB1?.fields[symFieldId!]).map((v) => v.id)).toEqual([a1.id]);
    expect(rowB2?.fields[symFieldId!]).toBeNull();
    expect(asLinkArray(rowB3?.fields[symFieldId!]).map((v) => v.id)).toEqual([a2.id]);
  });

  test('should convert one-many to many-one link with same link title', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-mo-same-title-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-mo-same-title-b'),
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
          isOneWay: false,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const b1 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'same' });
    const b2 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'same' });
    const a = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'a1',
      [linkField.id]: [{ id: b1.id }, { id: b2.id }],
    });

    await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'manyOne',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const rows = await ctx.listRecords(tableA.id);
    const row = rows.find((r) => r.id === a.id);
    const single = row?.fields[linkField.id] as { id: string; title: string } | undefined;
    expect(single?.title).toBe('same');
    expect([b1.id, b2.id]).toContain(single?.id);
  });

  test('should convert one-many to many-one link with same link title and cross table', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-mo-cross-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-mo-cross-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });
    const tableC = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-mo-cross-c'),
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
          isOneWay: false,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const a = await ctx.createRecord(tableA.id, { [primaryFieldId(tableA)]: 'a1' });
    const b = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'same' });
    await ctx.updateRecord(tableA.id, a.id, { [linkField.id]: [{ id: b.id }] });

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'manyOne',
          foreignTableId: tableC.id,
          lookupFieldId: primaryFieldId(tableC),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    const options = updatedField?.options as { relationship?: string; foreignTableId?: string };
    expect(options.relationship).toBe('manyOne');
    expect(options.foreignTableId).toBe(tableC.id);
  });

  test('should convert one-many to many-many link with same link title and cross table', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-mm-cross-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-mm-cross-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });
    const tableC = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-mm-cross-c'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const a1 = await ctx.createRecord(tableA.id, { [primaryFieldId(tableA)]: 'a1' });
    const a2 = await ctx.createRecord(tableA.id, { [primaryFieldId(tableA)]: 'a2' });

    const manyOneTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableB.id,
      field: {
        type: 'link',
        name: 'LinkToA',
        options: {
          relationship: 'manyOne',
          foreignTableId: tableA.id,
          lookupFieldId: primaryFieldId(tableA),
          isOneWay: false,
        },
      },
    });

    const manyOneField = manyOneTable.fields.find((f) => f.name === 'LinkToA');
    const symmetricFieldId = extractSymmetricFieldId(manyOneField);
    if (!manyOneField || !symmetricFieldId) {
      throw new Error('Failed to resolve two-way manyOne symmetric field');
    }

    const b1 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'test' });
    const b2 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'test' });
    const b3 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'test' });

    await ctx.updateRecord(tableB.id, b1.id, { [manyOneField.id]: { id: a1.id } });
    await ctx.updateRecord(tableB.id, b2.id, { [manyOneField.id]: { id: a1.id } });
    await ctx.updateRecord(tableB.id, b3.id, { [manyOneField.id]: { id: a2.id } });

    await ctx.drainOutbox();

    const rowsBeforeConvert = await ctx.listRecords(tableA.id);
    const rowA1BeforeConvert = rowsBeforeConvert.find((row) => row.id === a1.id);
    const rowA2BeforeConvert = rowsBeforeConvert.find((row) => row.id === a2.id);
    expect(asLinkArray(rowA1BeforeConvert?.fields[symmetricFieldId])).toHaveLength(2);
    expect(asLinkArray(rowA2BeforeConvert?.fields[symmetricFieldId])).toHaveLength(1);

    const c1 = await ctx.createRecord(tableC.id, { [primaryFieldId(tableC)]: 'test' });
    const c2 = await ctx.createRecord(tableC.id, { [primaryFieldId(tableC)]: 'test' });
    const c3 = await ctx.createRecord(tableC.id, { [primaryFieldId(tableC)]: 'test' });

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: symmetricFieldId,
      field: {
        options: {
          relationship: 'manyMany',
          foreignTableId: tableC.id,
          lookupFieldId: primaryFieldId(tableC),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const convertedField = updatedTable.fields.find((f) => f.id === symmetricFieldId);
    const convertedOptions = convertedField?.options as {
      relationship?: string;
      foreignTableId?: string;
    };
    expect(convertedOptions.relationship).toBe('manyMany');
    expect(convertedOptions.foreignTableId).toBe(tableC.id);

    const rowsA = await ctx.listRecords(tableA.id);
    const rowA1 = rowsA.find((row) => row.id === a1.id);
    const rowA2 = rowsA.find((row) => row.id === a2.id);
    const linksA1 = asLinkArray(rowA1?.fields[symmetricFieldId]);
    const linksA2 = asLinkArray(rowA2?.fields[symmetricFieldId]);

    expect(linksA1).toHaveLength(1);
    expect(linksA2).toHaveLength(1);
    expect(linksA1[0]?.title).toBe('test');
    expect(linksA2[0]?.title).toBe('test');
    expect([c1.id, c2.id, c3.id]).toContain(linksA1[0]?.id);
    expect([c1.id, c2.id, c3.id]).toContain(linksA2[0]?.id);
  });

  test('should convert two-way one-one to one-way one-many link with link', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-oo-ow-om-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-oo-ow-om-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const linkTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'oneOne',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: false,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const b = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'b1' });
    const a = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'a1',
      [linkField.id]: { id: b.id },
    });

    await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'oneMany',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: true,
        },
      },
    });

    await ctx.drainOutbox();

    const rows = await ctx.listRecords(tableA.id);
    const row = rows.find((r) => r.id === a.id);
    const links = asLinkArray(row?.fields[linkField.id]);
    expect(links[0]?.id).toBe(b.id);
  });

  test('should convert one-way one-one to two-way one-one', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-oo-tw-oo-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-oo-tw-oo-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const linkTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'oneOne',
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

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'oneOne',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedField?.type).toBe('link');
    expect((updatedField?.options as { relationship?: string } | undefined)?.relationship).toBe(
      'oneOne'
    );
    const symFieldId = extractSymmetricFieldId(updatedField);
    expect(symFieldId).toBeDefined();

    const rowsA = await ctx.listRecords(tableA.id);
    const rowA = rowsA.find((r) => r.id === a.id);
    const linksA = asLinkArray(rowA?.fields[linkField.id]);
    expect(linksA[0]?.id).toBe(b.id);
    expect(linksA[0]?.title).toBe('x');

    const rowsB = await ctx.listRecords(tableB.id);
    const rowB = rowsB.find((r) => r.id === b.id);
    const symLinks = asLinkArray(rowB?.fields[symFieldId!]);
    expect(symLinks[0]?.id).toBe(a.id);
  });

  test('should convert one-many to many-one link with 2 lookup and 2 formula fields', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-mo-deps-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-om-mo-deps-b'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Count' },
      ],
    });

    const titleFieldId = primaryFieldId(tableB);
    const countFieldId = tableB.fields.find((f) => f.name === 'Count')?.id;
    if (!countFieldId) throw new Error('Count field missing');

    const withLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'oneMany',
          foreignTableId: tableB.id,
          lookupFieldId: titleFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = withLink.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const withLookup1 = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'lookup',
        name: 'TitleLookup',
        options: {
          linkFieldId: linkField.id,
          foreignTableId: tableB.id,
          lookupFieldId: titleFieldId,
        },
      },
    });
    const lookupField1 = withLookup1.fields.find((f) => f.name === 'TitleLookup');
    if (!lookupField1) throw new Error('TitleLookup field missing');

    const withLookup2 = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'lookup',
        name: 'CountLookup',
        options: {
          linkFieldId: linkField.id,
          foreignTableId: tableB.id,
          lookupFieldId: countFieldId,
        },
      },
    });
    const lookupField2 = withLookup2.fields.find((f) => f.name === 'CountLookup');
    if (!lookupField2) throw new Error('CountLookup field missing');

    const withFormula1 = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'formula',
        name: 'Formula1',
        options: { expression: `{${lookupField1.id}}` },
      },
    });
    const formulaField1 = withFormula1.fields.find((f) => f.name === 'Formula1');
    if (!formulaField1) throw new Error('Formula1 field missing');

    const withFormula2 = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'formula',
        name: 'Formula2',
        options: { expression: `{${lookupField2.id}}` },
      },
    });
    const formulaField2 = withFormula2.fields.find((f) => f.name === 'Formula2');
    if (!formulaField2) throw new Error('Formula2 field missing');

    const b1 = await ctx.createRecord(tableB.id, {
      [titleFieldId]: 'x',
      [countFieldId]: 1,
    });
    const b2 = await ctx.createRecord(tableB.id, { [titleFieldId]: 'y' });
    const a1 = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'a1',
      [linkField.id]: [{ id: b1.id }, { id: b2.id }],
    });

    await ctx.drainOutbox();

    const rowsBefore = await ctx.listRecords(tableA.id);
    const rowBefore = rowsBefore.find((r) => r.id === a1.id);
    expect(rowBefore?.fields[formulaField1.id]).toEqual(['x', 'y']);
    expect(rowBefore?.fields[formulaField2.id]).toEqual([1]);

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'manyOne',
          foreignTableId: tableB.id,
          lookupFieldId: titleFieldId,
          isOneWay: true,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedLink = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedLink?.type).toBe('link');
    expect((updatedLink?.options as { relationship?: string } | undefined)?.relationship).toBe(
      'manyOne'
    );

    // v1: many-one link keeps only one value; dependent lookups/formulas flip to scalar
    const refreshedTable = await ctx.getTableById(tableA.id);
    const refreshedFormula1 = refreshedTable.fields.find((f) => f.id === formulaField1.id) as
      | { isMultipleCellValue?: boolean }
      | undefined;
    const refreshedFormula2 = refreshedTable.fields.find((f) => f.id === formulaField2.id) as
      | { isMultipleCellValue?: boolean }
      | undefined;
    expect(refreshedFormula1?.isMultipleCellValue).not.toBe(true);
    expect(refreshedFormula2?.isMultipleCellValue).not.toBe(true);

    const rowsAfter = await ctx.listRecords(tableA.id);
    const rowAfter = rowsAfter.find((r) => r.id === a1.id);
    expect(rowAfter?.fields[formulaField1.id]).toEqual('x');
    expect(rowAfter?.fields[formulaField2.id]).toEqual(1);
  });

  test('should convert one-way many-many to two-way many-many', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-mm-tw-mm-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-mm-tw-mm-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const linkTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'manyMany',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: true,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const b = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'b1' });
    const a = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'a1',
      [linkField.id]: [{ id: b.id }],
    });

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'manyMany',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    const symFieldId = extractSymmetricFieldId(updatedField);
    expect(symFieldId).toBeDefined();

    const rowsB = await ctx.listRecords(tableB.id);
    const rowB = rowsB.find((r) => r.id === b.id);
    const symLinks = asLinkArray(rowB?.fields[symFieldId!]);
    expect(symLinks[0]?.id).toBe(a.id);
  });

  test('should convert one-way one-many to two-way one-many and keep reverse links', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-om-tw-om-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-om-tw-om-b'),
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

    const b1 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'b1' });
    const b2 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'b2' });
    const a1 = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'a1',
      [linkField.id]: [{ id: b1.id }, { id: b2.id }],
    });

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'oneMany',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    const options = updatedField?.options as {
      relationship?: string;
      foreignTableId?: string;
      symmetricFieldId?: string;
    };
    expect(options.relationship).toBe('oneMany');
    expect(options.foreignTableId).toBe(tableB.id);
    expect(options.symmetricFieldId).toBeDefined();

    const rowsA = await ctx.listRecords(tableA.id);
    const rowA1 = rowsA.find((r) => r.id === a1.id);
    const linksA = asLinkArray(rowA1?.fields[linkField.id]);
    expect(linksA.map((l) => l.id)).toEqual([b1.id, b2.id]);

    const foreignTable = await ctx.getTableById(tableB.id);
    const symmetricField = foreignTable.fields.find((f) => f.id === options.symmetricFieldId);
    expect(symmetricField?.type).toBe('link');
    const symmetricOptions = symmetricField?.options as {
      relationship?: string;
      foreignTableId?: string;
      symmetricFieldId?: string;
    };
    expect(symmetricOptions.relationship).toBe('manyOne');
    expect(symmetricOptions.foreignTableId).toBe(tableA.id);
    expect(symmetricOptions.symmetricFieldId).toBe(linkField.id);

    const rowsB = await ctx.listRecords(tableB.id);
    const rowB1 = rowsB.find((r) => r.id === b1.id);
    const rowB2 = rowsB.find((r) => r.id === b2.id);
    expect(rowB1?.fields[options.symmetricFieldId!]).toMatchObject({ id: a1.id });
    expect(rowB2?.fields[options.symmetricFieldId!]).toMatchObject({ id: a1.id });
  });

  test('should convert one-way link to two-way link and to other table', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-to-tw-other-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-to-tw-other-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });
    const tableC = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-to-tw-other-c'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const linkTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'manyMany',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: true,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'manyMany',
          foreignTableId: tableC.id,
          lookupFieldId: primaryFieldId(tableC),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    const options = updatedField?.options as {
      foreignTableId?: string;
      relationship?: string;
      symmetricFieldId?: string;
    };
    expect(options.foreignTableId).toBe(tableC.id);
    expect(options.relationship).toBe('manyMany');
    expect(options.symmetricFieldId).toBeDefined();
  });

  test('should convert one-way one-many link to two-way and other table with dependent lookup/rollup', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-om-to-tw-other-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-om-to-tw-other-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });
    const tableC = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-ow-om-to-tw-other-c'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const b1 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'x' });
    const b2 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'y' });
    const c1 = await ctx.createRecord(tableC.id, { [primaryFieldId(tableC)]: 'x' });
    const c2 = await ctx.createRecord(tableC.id, { [primaryFieldId(tableC)]: 'y' });
    const a1 = await ctx.createRecord(tableA.id, { [primaryFieldId(tableA)]: 'row-a1' });

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

    await ctx.updateRecord(tableA.id, a1.id, {
      [linkField.id]: [{ id: b1.id }, { id: b2.id }],
    });

    const lookupTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'lookup',
        name: 'Name from table B',
        options: {
          linkFieldId: linkField.id,
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
        },
      },
    });
    const lookupField = lookupTable.fields.find((f) => f.name === 'Name from table B');
    if (!lookupField) throw new Error('Lookup field missing');

    const rollupTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'rollup',
        name: 'Count from table B',
        options: { expression: 'count({values})' },
        config: {
          linkFieldId: linkField.id,
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
        },
      },
    });
    const rollupField = rollupTable.fields.find((f) => f.name === 'Count from table B');
    if (!rollupField) throw new Error('Rollup field missing');

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'oneMany',
          foreignTableId: tableC.id,
          lookupFieldId: primaryFieldId(tableC),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    const options = updatedField?.options as {
      foreignTableId?: string;
      relationship?: string;
      symmetricFieldId?: string;
    };
    expect(options.foreignTableId).toBe(tableC.id);
    expect(options.relationship).toBe('oneMany');
    expect(options.symmetricFieldId).toBeDefined();

    const rowsA = await ctx.listRecords(tableA.id);
    const rowA1 = rowsA.find((r) => r.id === a1.id);
    expect(rowA1?.fields[lookupField.id]).toBeNull();
    expect(rowA1?.fields[rollupField.id]).toBeNull();

    const foreignTable = await ctx.getTableById(tableC.id);
    const symmetricField = foreignTable.fields.find((f) => f.id === options.symmetricFieldId);
    expect(symmetricField?.type).toBe('link');

    const rowsC = await ctx.listRecords(tableC.id);
    const rowC1 = rowsC.find((r) => r.id === c1.id);
    const rowC2 = rowsC.find((r) => r.id === c2.id);
    expect(rowC1).toBeDefined();
    expect(rowC2).toBeDefined();
  });

  test('should convert link from one table to another', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-link-other-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-link-other-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });
    const tableC = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-link-other-c'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const linkTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableA.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'manyMany',
          foreignTableId: tableB.id,
          lookupFieldId: primaryFieldId(tableB),
          isOneWay: false,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'manyMany',
          foreignTableId: tableC.id,
          lookupFieldId: primaryFieldId(tableC),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    const options = updatedField?.options as { foreignTableId?: string; symmetricFieldId?: string };
    expect(options.foreignTableId).toBe(tableC.id);
    expect(options.symmetricFieldId).toBeDefined();
  });

  test('should clear selected values when converting link to another foreign table', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-link-other-selected-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-link-other-selected-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });
    const tableC = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-link-other-selected-c'),
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
          isOneWay: false,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const b1 = await ctx.createRecord(tableB.id, { [primaryFieldId(tableB)]: 'B1' });
    await ctx.createRecord(tableC.id, { [primaryFieldId(tableC)]: 'C1' });
    const a1 = await ctx.createRecord(tableA.id, {
      [primaryFieldId(tableA)]: 'A1',
      [linkField.id]: { id: b1.id },
    });

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'manyOne',
          foreignTableId: tableC.id,
          lookupFieldId: primaryFieldId(tableC),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    const options = updatedField?.options as { foreignTableId?: string; symmetricFieldId?: string };
    expect(options.foreignTableId).toBe(tableC.id);
    expect(options.symmetricFieldId).toBeDefined();

    const rowsA = await ctx.listRecords(tableA.id);
    const rowA1 = rowsA.find((r) => r.id === a1.id);
    expect(rowA1?.fields[linkField.id]).toBeNull();
  });

  test('should convert link from one table to another and change relationship', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-link-other-rel-a'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-link-other-rel-b'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });
    const tableC = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('v1p-link-other-rel-c'),
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
          isOneWay: false,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Link field missing');

    const updatedTable = await ctx.updateField({
      tableId: tableA.id,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'manyOne',
          foreignTableId: tableC.id,
          lookupFieldId: primaryFieldId(tableC),
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    const options = updatedField?.options as {
      foreignTableId?: string;
      relationship?: string;
      symmetricFieldId?: string;
    };
    expect(options.foreignTableId).toBe(tableC.id);
    expect(options.relationship).toBe('manyOne');
    expect(options.symmetricFieldId).toBeDefined();
  });
});
