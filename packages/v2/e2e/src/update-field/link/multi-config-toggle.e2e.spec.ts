/**
 * Regression coverage for toggling multiple link-field settings in one update.
 *
 * This mirrors the real-world `.tea` case:
 * manyOne + twoWay -> manyMany + oneWay.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('update-field: link multi-config toggle regression', () => {
  let ctx: SharedTestContext;
  let sourceTableId: string;
  let foreignTableId: string;
  let sourcePrimaryFieldId: string;
  let foreignFormulaFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const sourceTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Survey Responses',
      fields: [{ type: 'singleLineText', name: 'Response Name', isPrimary: true }],
    });
    sourceTableId = sourceTable.id;
    const sourcePrimary = sourceTable.fields.find((field) => field.isPrimary);
    if (!sourcePrimary) {
      throw new Error('Missing source primary field');
    }
    sourcePrimaryFieldId = sourcePrimary.id;

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Campuses',
      fields: [
        { type: 'singleLineText', name: 'Branch', isPrimary: true },
        { type: 'singleLineText', name: 'District' },
        { type: 'singleLineText', name: 'Center' },
        { type: 'singleLineText', name: 'Room' },
      ],
    });
    foreignTableId = foreignTable.id;
    const branchFieldId = foreignTable.fields.find((field) => field.name === 'Branch')?.id;
    const districtFieldId = foreignTable.fields.find((field) => field.name === 'District')?.id;
    const centerFieldId = foreignTable.fields.find((field) => field.name === 'Center')?.id;
    const roomFieldId = foreignTable.fields.find((field) => field.name === 'Room')?.id;
    if (!branchFieldId || !districtFieldId || !centerFieldId || !roomFieldId) {
      throw new Error('Missing foreign table fields');
    }

    const foreignTableWithFormula = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: {
        type: 'formula',
        name: 'Campus Info',
        options: {
          expression: `{${branchFieldId}} & "/" & {${districtFieldId}} & "/" & {${centerFieldId}} & "/" & {${roomFieldId}}`,
        },
      },
    });
    const foreignFormulaField = foreignTableWithFormula.fields.find(
      (field) => field.name === 'Campus Info'
    );
    if (!foreignFormulaField) {
      throw new Error('Missing foreign formula field');
    }
    foreignFormulaFieldId = foreignFormulaField.id;
  });

  afterAll(async () => {
    try {
      if (sourceTableId) await ctx.deleteTable(sourceTableId);
    } catch {
      // ignore cleanup errors
    }
    try {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    } catch {
      // ignore cleanup errors
    }
  });

  test('preserves source links when converting manyOne twoWay to manyMany oneWay', async () => {
    const sourceTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Campus Info',
        options: {
          foreignTableId,
          relationship: 'manyOne',
          lookupFieldId: foreignFormulaFieldId,
          isOneWay: false,
        },
      },
    });
    const linkField = sourceTable.fields.find((field) => field.name === 'Campus Info');
    if (!linkField) {
      throw new Error('Link field not found');
    }
    const originalOptions = linkField.options as { symmetricFieldId?: string };
    const symmetricFieldId = originalOptions.symmetricFieldId;
    expect(symmetricFieldId).toBeDefined();

    const foreignRecord = await ctx.createRecord(foreignTableId, {
      Branch: 'Branch A',
      District: 'District A',
      Center: 'Center A',
      Room: 'Room A',
    });
    const sourceRecordA = await ctx.createRecord(sourceTableId, {
      [sourcePrimaryFieldId]: 'Response A',
      [linkField.id]: { id: foreignRecord.id },
    });
    const sourceRecordB = await ctx.createRecord(sourceTableId, {
      [sourcePrimaryFieldId]: 'Response B',
      [linkField.id]: { id: foreignRecord.id },
    });
    await ctx.drainOutbox();

    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: linkField.id,
      field: {
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignFormulaFieldId,
          isOneWay: true,
        },
      },
    });

    const updatedField = updatedTable.fields.find((field) => field.id === linkField.id);
    expect(updatedField?.type).toBe('link');
    const updatedOptions = updatedField?.options as {
      relationship?: string;
      isOneWay?: boolean;
      symmetricFieldId?: string;
    };
    expect(updatedOptions?.relationship).toBe('manyMany');
    expect(updatedOptions?.isOneWay).toBe(true);
    expect(updatedOptions?.symmetricFieldId).toBeUndefined();

    const sourceRecords = await ctx.listRecords(sourceTableId);
    const recordA = sourceRecords.find((record) => record.id === sourceRecordA.id);
    const recordB = sourceRecords.find((record) => record.id === sourceRecordB.id);

    expect(recordA?.fields[linkField.id]).toEqual([
      expect.objectContaining({
        id: foreignRecord.id,
        title: 'Branch A/District A/Center A/Room A',
      }),
    ]);
    expect(recordB?.fields[linkField.id]).toEqual([
      expect.objectContaining({
        id: foreignRecord.id,
        title: 'Branch A/District A/Center A/Room A',
      }),
    ]);

    const foreignTableAfter = await ctx.getTableById(foreignTableId);
    expect(foreignTableAfter.fields.find((field) => field.id === symmetricFieldId)).toBeUndefined();

    await ctx.deleteRecords(sourceTableId, [sourceRecordA.id, sourceRecordB.id]);
    await ctx.deleteRecords(foreignTableId, [foreignRecord.id]);
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });
});
