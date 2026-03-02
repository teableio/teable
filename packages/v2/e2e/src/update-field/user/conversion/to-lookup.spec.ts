/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: user → lookup conversion', () => {
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

  const createUserField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'user',
        id: fieldId,
        name,
        options: {
          isMultiple: false,
          shouldNotify: false,
        },
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'User to Lookup Host',
      fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
    });
    hostTableId = hostTable.id;
    const hostPrimary = hostTable.fields.find((f) => f.isPrimary);
    if (!hostPrimary) throw new Error('No host primary field');
    hostPrimaryFieldId = hostPrimary.id;

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'User to Lookup Foreign',
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
    const fieldId = await createUserField('User Field');
    const hostRecord = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host A',
      [linkFieldId]: [{ id: foreignRecord.id }],
      [fieldId]: { id: 'system', title: 'System' },
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

  test('should handle lookup with no linked records', async () => {
    const fieldId = await createUserField('Lookup Empty Link Field');
    const hostRecord = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'No links',
      [fieldId]: { id: 'system', title: 'System' },
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

  test('should handle lookup with multiple linked records', async () => {
    const foreignRecord1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Acme Inc',
    });
    const foreignRecord2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Globex',
    });
    const fieldId = await createUserField('Lookup Multiple Links Field');
    const hostRecord = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Has links',
      [linkFieldId]: [{ id: foreignRecord1.id }, { id: foreignRecord2.id }],
      [fieldId]: { id: 'system', title: 'System' },
    });
    await ctx.drainOutbox();

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
    expect(records.find((r) => r.id === hostRecord.id)?.fields[fieldId]).toEqual([
      'Acme Inc',
      'Globex',
    ]);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [hostRecord.id]);
    await ctx.deleteRecords(foreignTableId, [foreignRecord1.id, foreignRecord2.id]);
  });

  test('should handle null values', async () => {
    const fieldId = await createUserField('Null User Field');
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
