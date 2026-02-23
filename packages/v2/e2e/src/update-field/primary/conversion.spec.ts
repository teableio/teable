/**
 * E2E tests for primary field type conversion parity with v1.
 *
 * v1 behavior:
 * - Primary field type conversion is allowed.
 * - Target type must be in PRIMARY_SUPPORTED_TYPES.
 */
import { fieldTypeValues } from '@teable/v2-core';
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

const PRIMARY_SUPPORTED_TYPES = [
  'singleLineText',
  'longText',
  'user',
  'multipleSelect',
  'singleSelect',
  'date',
  'number',
  'rating',
  'formula',
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'autoNumber',
] as const;

const primarySupportedTypeSet = new Set<string>(PRIMARY_SUPPORTED_TYPES);
const supportedConversionTargets = PRIMARY_SUPPORTED_TYPES.filter(
  (type) => type !== 'singleLineText'
);
const unsupportedConversionTargets = fieldTypeValues.filter(
  (type) => !primarySupportedTypeSet.has(type)
);
const directWhitelistErrorTargets = new Set(['checkbox', 'attachment', 'button']);

const buildFieldUpdate = (targetType: string) => {
  if (targetType === 'formula') {
    return {
      type: targetType,
      options: {
        expression: '1',
        formatting: {
          type: 'decimal',
          precision: 2,
        },
      },
    };
  }
  return { type: targetType };
};

describe('update-field: primary field conversions [V1 PARITY]', () => {
  let ctx: SharedTestContext;
  let tableNameCounter = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const createPrimaryTextTable = async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Primary Conversion Matrix ${tableNameCounter++}`,
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id;
    if (!primaryFieldId) throw new Error('No primary field');
    return { tableId: table.id, primaryFieldId };
  };

  const deleteTableBestEffort = async (tableId: string) => {
    try {
      await ctx.deleteTable(tableId);
    } catch {
      // Keep tests stable for known formula cleanup issue:
      // deleting a table may fail if converted formula metadata becomes invalid.
    }
  };

  test.each(supportedConversionTargets)(
    '[V1 PARITY] should allow converting primary field to supported target type: %s',
    async (targetType) => {
      const { tableId, primaryFieldId } = await createPrimaryTextTable();
      const r1 = await ctx.createRecord(tableId, { [primaryFieldId]: 'Alpha' });
      const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'Beta' });

      try {
        const updatedTable = await ctx.updateField({
          tableId,
          fieldId: primaryFieldId,
          field: buildFieldUpdate(targetType),
        });

        const updatedPrimary = updatedTable.fields.find((f) => f.id === primaryFieldId);
        expect(updatedPrimary?.type).toBe(targetType);
        expect(updatedPrimary?.isPrimary).toBe(true);
        expect(updatedTable.fields.filter((f) => f.isPrimary)).toHaveLength(1);

        if (targetType !== 'formula') {
          const records = await ctx.listRecords(tableId);
          const rec1 = records.find((r) => r.id === r1.id);
          const rec2 = records.find((r) => r.id === r2.id);
          expect(rec1?.fields[primaryFieldId]).toBeDefined();
          expect(rec2?.fields[primaryFieldId]).toBeDefined();
        }
      } finally {
        if (targetType === 'formula') {
          await deleteTableBestEffort(tableId);
        } else {
          await ctx.deleteTable(tableId);
        }
      }
    }
  );

  test.each(unsupportedConversionTargets)(
    '[V1 PARITY] should reject converting primary field to unsupported target type: %s',
    async (targetType) => {
      const { tableId, primaryFieldId } = await createPrimaryTextTable();
      try {
        const updatePromise = ctx.updateField({
          tableId,
          fieldId: primaryFieldId,
          field: buildFieldUpdate(targetType),
        });
        if (directWhitelistErrorTargets.has(targetType)) {
          await expect(updatePromise).rejects.toThrow(
            `Field type ${targetType} is not supported as primary field`
          );
        } else {
          // Some target types require extra payload (e.g. config/options) and can fail in parsing first.
          await expect(updatePromise).rejects.toThrow();
        }
      } finally {
        await ctx.deleteTable(tableId);
      }
    }
  );

  test('[V1 PARITY] should allow updating primary field properties without type change (unique toggle)', async () => {
    const { tableId, primaryFieldId } = await createPrimaryTextTable();

    try {
      const uniqueOn = await ctx.updateField({
        tableId,
        fieldId: primaryFieldId,
        field: { unique: true },
      });
      const uniqueOnField = uniqueOn.fields.find((f) => f.id === primaryFieldId);
      expect(uniqueOnField?.unique).toBe(true);

      const uniqueOff = await ctx.updateField({
        tableId,
        fieldId: primaryFieldId,
        field: { unique: false },
      });
      const uniqueOffField = uniqueOff.fields.find((f) => f.id === primaryFieldId);
      // v2 API omits unique when false (v1 adapter normalizes to false separately)
      expect(uniqueOffField?.unique).not.toBe(true);
    } finally {
      await ctx.deleteTable(tableId);
    }
  });

  test('[V1 PARITY] should toggle unique on non-primary field', async () => {
    const { tableId, primaryFieldId } = await createPrimaryTextTable();
    // Create a non-primary singleLineText field
    const table = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', name: 'Extra Field' },
    });
    const extraField = table.fields.find((f) => f.name === 'Extra Field');
    if (!extraField) throw new Error('Extra field not found');

    try {
      // Set unique to true
      const uniqueOn = await ctx.updateField({
        tableId,
        fieldId: extraField.id,
        field: { unique: true },
      });
      const uniqueOnField = uniqueOn.fields.find((f) => f.id === extraField.id);
      expect(uniqueOnField?.unique).toBe(true);

      // Set unique to false
      const uniqueOff = await ctx.updateField({
        tableId,
        fieldId: extraField.id,
        field: { unique: false },
      });
      const uniqueOffField = uniqueOff.fields.find((f) => f.id === extraField.id);
      // v2 API omits unique when false (v1 adapter normalizes to false separately)
      expect(uniqueOffField?.unique).not.toBe(true);
    } finally {
      await ctx.deleteTable(tableId);
    }
  });

  test('[V1 PARITY] should reject no-op update on primary field', async () => {
    const { tableId, primaryFieldId } = await createPrimaryTextTable();
    try {
      await expect(
        ctx.updateField({
          tableId,
          fieldId: primaryFieldId,
          field: { type: 'singleLineText' },
        })
      ).rejects.toThrow('No changes to apply');
    } finally {
      await ctx.deleteTable(tableId);
    }
  });
});
