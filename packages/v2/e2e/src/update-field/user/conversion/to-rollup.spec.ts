/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: user → rollup conversion', () => {
  let ctx: SharedTestContext;
  let hostTableId: string;
  let foreignTableId: string;
  let hostPrimaryFieldId: string;
  let foreignPrimaryFieldId: string;
  let foreignNumberFieldId: string;
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
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    foreignPrimaryFieldId = createFieldId();
    foreignNumberFieldId = createFieldId();
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'User to Rollup Foreign',
      fields: [
        {
          type: 'singleLineText',
          id: foreignPrimaryFieldId,
          name: 'Foreign Name',
          isPrimary: true,
        },
        {
          type: 'number',
          id: foreignNumberFieldId,
          name: 'Amount',
        },
      ],
    });
    foreignTableId = foreignTable.id;

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'User to Rollup Host',
      fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
    });
    hostTableId = hostTable.id;
    const hostPrimary = hostTable.fields.find((f) => f.isPrimary);
    if (!hostPrimary) throw new Error('No host primary field');
    hostPrimaryFieldId = hostPrimary.id;

    const withLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        id: createFieldId(),
        name: 'Foreign Link',
        options: {
          relationship: 'manyMany',
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = withLink.fields.find((f) => f.name === 'Foreign Link');
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

  test('should convert to rollup and clear data', async () => {
    const fieldId = await createUserField('User Field');
    const foreign = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'F1',
      [foreignNumberFieldId]: 10,
    });
    const host = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host 1',
      [fieldId]: { id: 'system', title: 'System' },
      [linkFieldId]: [{ id: foreign.id }],
    });

    const result = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'rollup',
        options: {
          expression: 'countall({values})',
        },
        config: {
          linkFieldId,
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
        },
      },
    });

    const updatedField = result.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('rollup');

    const records = await ctx.listRecordsWithoutDrain(hostTableId);
    expect(records.find((r) => r.id === host.id)?.fields[fieldId]).toBe(1);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [host.id]);
    await ctx.deleteRecords(foreignTableId, [foreign.id]);
  });

  test('should handle COUNT rollup', async () => {
    const fieldId = await createUserField('Count Rollup');
    const f1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'CF1',
      [foreignNumberFieldId]: 2,
    });
    const f2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'CF2',
      [foreignNumberFieldId]: 4,
    });
    const host = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host Count',
      [fieldId]: { id: 'system', title: 'System' },
      [linkFieldId]: [{ id: f1.id }, { id: f2.id }],
    });

    await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'rollup',
        options: { expression: 'countall({values})' },
        config: { linkFieldId, foreignTableId, lookupFieldId: foreignNumberFieldId },
      },
    });

    const records = await ctx.listRecordsWithoutDrain(hostTableId);
    expect(records.find((r) => r.id === host.id)?.fields[fieldId]).toBe(2);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [host.id]);
    await ctx.deleteRecords(foreignTableId, [f1.id, f2.id]);
  });

  test('should handle SUM rollup', async () => {
    const fieldId = await createUserField('Sum Rollup');
    const f1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'SF1',
      [foreignNumberFieldId]: 3,
    });
    const f2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'SF2',
      [foreignNumberFieldId]: 7,
    });
    const host = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host Sum',
      [fieldId]: { id: 'system', title: 'System' },
      [linkFieldId]: [{ id: f1.id }, { id: f2.id }],
    });

    await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'rollup',
        options: { expression: 'sum({values})' },
        config: { linkFieldId, foreignTableId, lookupFieldId: foreignNumberFieldId },
      },
    });

    const records = await ctx.listRecordsWithoutDrain(hostTableId);
    expect(records.find((r) => r.id === host.id)?.fields[fieldId]).toBe(10);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [host.id]);
    await ctx.deleteRecords(foreignTableId, [f1.id, f2.id]);
  });

  test('should handle rollup with no linked records', async () => {
    const fieldId = await createUserField('No Links Rollup');
    const host = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host Empty',
      [fieldId]: { id: 'system', title: 'System' },
    });

    await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'rollup',
        options: { expression: 'countall({values})' },
        config: { linkFieldId, foreignTableId, lookupFieldId: foreignNumberFieldId },
      },
    });

    const records = await ctx.listRecordsWithoutDrain(hostTableId);
    expect(records.find((r) => r.id === host.id)?.fields[fieldId]).toBe(0);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [host.id]);
  });

  test('should handle null values', async () => {
    const fieldId = await createUserField('Null User Rollup');
    const foreign = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'NF1',
      [foreignNumberFieldId]: 1,
    });
    const host = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host Null User',
      [linkFieldId]: [{ id: foreign.id }],
    });

    await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'rollup',
        options: { expression: 'countall({values})' },
        config: { linkFieldId, foreignTableId, lookupFieldId: foreignNumberFieldId },
      },
    });

    const records = await ctx.listRecordsWithoutDrain(hostTableId);
    expect(records.find((r) => r.id === host.id)?.fields[fieldId]).toBe(1);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [host.id]);
    await ctx.deleteRecords(foreignTableId, [foreign.id]);
  });
});
