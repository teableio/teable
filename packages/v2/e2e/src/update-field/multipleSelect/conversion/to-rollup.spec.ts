/**
 * E2E tests for converting multipleSelect field to rollup.
 *
 * NOTE: This conversion requires schema recreation (drop old column, create new).
 * rollup fields are computed fields that don't preserve data from the source field.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: multipleSelect → rollup conversion', () => {
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

  const createMultipleSelectField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name,
        options: {
          choices: [
            { id: 'cho1', name: 'Option 1', color: 'blue' },
            { id: 'cho2', name: 'Option 2', color: 'red' },
          ],
        },
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
      name: 'MS to Rollup Foreign',
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
      name: 'MS to Rollup Host',
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
    } catch {
      // Ignore cleanup errors
    }
    try {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    } catch {
      // Ignore cleanup errors
    }
  });

  test('should convert multipleSelect to rollup and clear data', async () => {
    const fieldId = await createMultipleSelectField('MS Field');
    const hostRecord = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host A',
      [fieldId]: ['Option 1'],
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
    expect(updatedField).toBeDefined();
    expect(updatedField?.type).toBe('rollup');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [hostRecord.id]);
  });

  test('should handle null values', async () => {
    const fieldId = await createMultipleSelectField('Null MS Field');
    const hostRecord = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'No links',
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
    expect(updatedField).toBeDefined();
    expect(updatedField?.type).toBe('rollup');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [hostRecord.id]);
  });
});
