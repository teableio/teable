/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: longText → link conversion', () => {
  let ctx: SharedTestContext;
  let hostTableId: string;
  let foreignTableId: string;
  let hostPrimaryFieldId: string;
  let foreignPrimaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createLongTextField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'longText',
        id: fieldId,
        name,
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'LongText to Link Host',
      fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
    });
    hostTableId = hostTable.id;
    const hostPrimary = hostTable.fields.find((f) => f.isPrimary);
    if (!hostPrimary) throw new Error('No host primary field');
    hostPrimaryFieldId = hostPrimary.id;

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'LongText to Link Foreign',
      fields: [{ type: 'singleLineText', name: 'Foreign Name', isPrimary: true }],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;
  });

  afterAll(async () => {
    try {
      if (hostTableId) await ctx.deleteTable(hostTableId);
    } catch {}
    try {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    } catch {}
  });

  test('should convert to link and map matched text value', async () => {
    const fieldId = await createLongTextField('LongText Field');
    const linked = await ctx.createRecord(foreignTableId, { [foreignPrimaryFieldId]: 'Apple' });
    const r1 = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'host-1',
      [fieldId]: 'Apple',
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('link');

    const rows = await ctx.listRecords(hostTableId);
    expect(rows.find((r) => r.id === r1.id)?.fields[fieldId]).toEqual({
      id: linked.id,
      title: 'Apple',
    });

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [r1.id]);
  });

  test('should handle null values', async () => {
    const fieldId = await createLongTextField('Nullable LongText Field');
    const r1 = await ctx.createRecord(hostTableId, { [hostPrimaryFieldId]: 'host-null' });

    await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    await ctx.drainOutbox();

    const rows = await ctx.listRecords(hostTableId);
    expect(rows.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [r1.id]);
  });
});
