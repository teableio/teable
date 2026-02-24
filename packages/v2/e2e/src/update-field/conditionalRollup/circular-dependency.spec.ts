/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let fieldIdCounter = 0;
const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const makeCondition = (fieldId: string, refFieldId: string) => ({
  filter: {
    conjunction: 'and' as const,
    filterSet: [
      {
        fieldId,
        operator: 'is',
        value: { type: 'field', fieldId: refFieldId },
      },
    ],
  },
});

describe('update-field: conditionalRollup circular dependency detection', () => {
  let ctx: SharedTestContext;
  let alphaTableId: string;
  let alphaKeyFieldId: string;
  let alphaValueFieldId: string;
  let betaTableId: string;
  let betaKeyFieldId: string;
  let betaQuantityFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create Alpha table
    const alphaTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'ConditionalRollup_Cycle_Alpha',
      fields: [
        { type: 'singleLineText', name: 'Alpha Key', isPrimary: true },
        { type: 'number', name: 'Alpha Value' },
      ],
    });
    alphaTableId = alphaTable.id;
    const alphaKey = alphaTable.fields.find((f) => f.name === 'Alpha Key');
    const alphaValue = alphaTable.fields.find((f) => f.name === 'Alpha Value');
    if (!alphaKey || !alphaValue) throw new Error('Alpha fields not found');
    alphaKeyFieldId = alphaKey.id;
    alphaValueFieldId = alphaValue.id;

    // Create Beta table
    const betaTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'ConditionalRollup_Cycle_Beta',
      fields: [
        { type: 'singleLineText', name: 'Beta Key', isPrimary: true },
        { type: 'number', name: 'Beta Quantity' },
      ],
    });
    betaTableId = betaTable.id;
    const betaKey = betaTable.fields.find((f) => f.name === 'Beta Key');
    const betaQuantity = betaTable.fields.find((f) => f.name === 'Beta Quantity');
    if (!betaKey || !betaQuantity) throw new Error('Beta fields not found');
    betaKeyFieldId = betaKey.id;
    betaQuantityFieldId = betaQuantity.id;
  });

  afterAll(async () => {
    try {
      if (alphaTableId) await ctx.deleteTable(alphaTableId);
    } catch {
      // ignore cleanup failure
    }
    try {
      if (betaTableId) await ctx.deleteTable(betaTableId);
    } catch {
      // ignore cleanup failure
    }
  });

  test('should reject converting conditional rollup into a cycle', async () => {
    // Step 1: Create betaRollup that looks up alphaValue in Alpha table
    const betaRollupId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: betaTableId,
      field: {
        type: 'conditionalRollup',
        id: betaRollupId,
        name: 'Alpha Value Count',
        options: {
          expression: 'count({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId: alphaTableId,
          lookupFieldId: alphaValueFieldId,
          condition: makeCondition(alphaKeyFieldId, betaKeyFieldId),
        },
      },
    });

    // Step 2: Create alphaRollup that looks up betaRollup in Beta table
    // This creates a dependency: Alpha.alphaRollup -> Beta.betaRollup -> Alpha.alphaValue
    const alphaRollupId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: alphaTableId,
      field: {
        type: 'conditionalRollup',
        id: alphaRollupId,
        name: 'Beta Rollup Count',
        options: {
          expression: 'count({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId: betaTableId,
          lookupFieldId: betaRollupId,
          condition: makeCondition(betaKeyFieldId, alphaKeyFieldId),
        },
      },
    });

    // Step 3: Try to update betaRollup to lookup alphaRollup
    // This would create a cycle: Beta.betaRollup -> Alpha.alphaRollup -> Beta.betaRollup
    // Should be rejected
    await expect(
      ctx.updateField({
        tableId: betaTableId,
        fieldId: betaRollupId,
        field: {
          config: {
            foreignTableId: alphaTableId,
            lookupFieldId: alphaRollupId,
            condition: makeCondition(alphaKeyFieldId, betaKeyFieldId),
          },
        },
      })
    ).rejects.toThrow();

    // Verify betaRollup still points to alphaValue (not updated)
    const betaTableAfter = await ctx.getTableById(betaTableId);
    const betaRollupField = betaTableAfter.fields.find((f) => f.id === betaRollupId) as
      | { config?: { lookupFieldId?: string } }
      | undefined;
    expect(betaRollupField?.config?.lookupFieldId).toBe(alphaValueFieldId);

    // Cleanup
    await ctx.deleteField({ tableId: alphaTableId, fieldId: alphaRollupId });
    await ctx.deleteField({ tableId: betaTableId, fieldId: betaRollupId });
  });

  test('should reject creating conditional rollup that forms a cycle', async () => {
    // Step 1: Create betaRollup that looks up alphaKey
    const betaRollupId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: betaTableId,
      field: {
        type: 'conditionalRollup',
        id: betaRollupId,
        name: 'Alpha Key Count 2',
        options: {
          expression: 'count({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId: alphaTableId,
          lookupFieldId: alphaKeyFieldId,
          condition: makeCondition(alphaKeyFieldId, betaKeyFieldId),
        },
      },
    });

    // Step 2: Create alphaRollup that looks up betaRollup
    const alphaRollupId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: alphaTableId,
      field: {
        type: 'conditionalRollup',
        id: alphaRollupId,
        name: 'Beta Rollup Count 2',
        options: {
          expression: 'count({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId: betaTableId,
          lookupFieldId: betaRollupId,
          condition: makeCondition(betaKeyFieldId, alphaKeyFieldId),
        },
      },
    });

    // Step 3: Try to update betaRollup to look up alphaRollup instead
    // This would form a cycle: alphaRollup -> betaRollup -> alphaRollup
    await expect(
      ctx.updateField({
        tableId: betaTableId,
        fieldId: betaRollupId,
        field: {
          config: {
            foreignTableId: alphaTableId,
            lookupFieldId: alphaRollupId,
            condition: makeCondition(alphaKeyFieldId, betaKeyFieldId),
          },
        },
      })
    ).rejects.toThrow(/circular dependency/i);

    // Cleanup
    await ctx.deleteField({ tableId: alphaTableId, fieldId: alphaRollupId });
    await ctx.deleteField({ tableId: betaTableId, fieldId: betaRollupId });
  });

  test('should reject creating conditional rollup that forms a cycle (database-level check)', async () => {
    // This test verifies that circular dependency detection works at the database level
    // using FieldDependencyGraph and topological sorting, which can detect cycles
    // even when the new field doesn't exist yet in memory.

    // Step 1: Create betaRollup that looks up alphaKey
    const betaRollupId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: betaTableId,
      field: {
        type: 'conditionalRollup',
        id: betaRollupId,
        name: 'Alpha Key Count 3',
        options: {
          expression: 'count({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId: alphaTableId,
          lookupFieldId: alphaKeyFieldId,
          condition: makeCondition(alphaKeyFieldId, betaKeyFieldId),
        },
      },
    });

    // Step 2: Create alphaRollup that looks up betaRollup
    const alphaRollupId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: alphaTableId,
      field: {
        type: 'conditionalRollup',
        id: alphaRollupId,
        name: 'Beta Rollup Count 3',
        options: {
          expression: 'count({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId: betaTableId,
          lookupFieldId: betaRollupId,
          condition: makeCondition(betaKeyFieldId, alphaKeyFieldId),
        },
      },
    });

    // Step 3: Try to update betaRollup to look up alphaRollup
    // This would form a cycle: alphaRollup -> betaRollup -> alphaRollup
    await expect(
      ctx.updateField({
        tableId: betaTableId,
        fieldId: betaRollupId,
        field: {
          config: {
            foreignTableId: alphaTableId,
            lookupFieldId: alphaRollupId,
            condition: makeCondition(alphaKeyFieldId, betaKeyFieldId),
          },
        },
      })
    ).rejects.toThrow(/circular dependency/i);

    // Verify betaRollup still looks up alphaKey (update was rejected)
    const betaTableAfter = await ctx.getTableById(betaTableId);
    const betaRollupField = betaTableAfter.fields.find((f) => f.id === betaRollupId) as
      | { config?: { lookupFieldId?: string } }
      | undefined;
    expect(betaRollupField?.config?.lookupFieldId).toBe(alphaKeyFieldId);

    // Cleanup
    await ctx.deleteField({ tableId: alphaTableId, fieldId: alphaRollupId });
    await ctx.deleteField({ tableId: betaTableId, fieldId: betaRollupId });
  });
});
