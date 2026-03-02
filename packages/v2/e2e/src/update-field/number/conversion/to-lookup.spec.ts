/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: number → lookup conversion', () => {
  let ctx: SharedTestContext;
  let hostTableId: string;
  let foreignTableId: string;
  let hostPrimaryFieldId: string;
  let foreignPrimaryFieldId: string;
  let linkFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createNumberField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'number',
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
      name: 'Number to Lookup Host',
      fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
    });
    hostTableId = hostTable.id;
    const hostPrimary = hostTable.fields.find((f) => f.isPrimary);
    if (!hostPrimary) throw new Error('No host primary field');
    hostPrimaryFieldId = hostPrimary.id;

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Number to Lookup Foreign',
      fields: [{ type: 'singleLineText', name: 'Company Name', isPrimary: true }],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;

    const withLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        id: createFieldId(),
        name: 'Company Link',
        options: {
          relationship: 'manyMany',
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = withLink.fields.find((f) => f.name === 'Company Link');
    if (!linkField) throw new Error('No link field');
    linkFieldId = linkField.id;
  });

  afterAll(async () => {
    try {
      if (hostTableId) await ctx.deleteTable(hostTableId);
    } catch {}
    try {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    } catch {}
  });

  test('should convert to lookup and clear data', async () => {
    const foreignRecord = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Acme Inc',
    });
    const fieldId = await createNumberField('Number Field');
    const hostRecord = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host A',
      [linkFieldId]: [{ id: foreignRecord.id }],
      [fieldId]: 123,
    });
    await ctx.drainOutbox();

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'lookup',
        options: {
          linkFieldId,
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
        },
      },
    });
    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          isLookup?: boolean;
          lookupOptions?: {
            linkFieldId: string;
            foreignTableId: string;
            lookupFieldId: string;
          };
        }
      | undefined;
    expect(updatedField?.isLookup).toBe(true);
    expect(updatedField?.lookupOptions).toMatchObject({
      linkFieldId,
      foreignTableId,
      lookupFieldId: foreignPrimaryFieldId,
    });

    const records = await ctx.listRecords(hostTableId);
    expect(records.find((r) => r.id === hostRecord.id)?.fields[fieldId]).toEqual(['Acme Inc']);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [hostRecord.id]);
    await ctx.deleteRecords(foreignTableId, [foreignRecord.id]);
  });

  test('should handle null values', async () => {
    const fieldId = await createNumberField('Null Number Field');
    const hostRecord = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'No value',
    });

    await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'lookup',
        options: {
          linkFieldId,
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
        },
      },
    });
    await ctx.drainOutbox();

    const records = await ctx.listRecords(hostTableId);
    const value = records.find((r) => r.id === hostRecord.id)?.fields[fieldId];
    expect(value == null || (Array.isArray(value) && value.length === 0)).toBe(true);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [hostRecord.id]);
  });
});
