import { describe, expect, it } from 'vitest';

import { explainResultSchema } from './explainCommand';

describe('explainResultSchema', () => {
  it('preserves the additive schema complexity profile instead of stripping it', () => {
    const parsed = explainResultSchema.parse({
      command: {
        type: 'UpdateRecord',
        tableId: 'tbl0000000000000000',
        tableName: 'Amounts',
        recordIds: ['rec0000000000000000'],
        changedFieldIds: ['fld0000000000000001'],
        changeType: 'update',
      },
      computedImpact: null,
      sqlExplains: [],
      complexity: { score: 1, level: 'trivial', factors: [], recommendations: [] },
      schemaComplexityProfile: {
        version: 1,
        basis: 'schema-only',
        scope: { focusTableId: 'tbl0000000000000000' },
        structural: { fieldCount: 0, edgeCount: 0 },
        formulas: [],
        operation: null,
        dataEstimate: { status: 'not-estimated' },
        evidence: { completeness: 'partial', dataPresence: 'empty', beforeImage: null },
        warnings: ['schema-partial'],
      },
      timing: { totalMs: 1, dependencyGraphMs: 0, planningMs: 0, sqlExplainMs: 0 },
    });

    expect(parsed.schemaComplexityProfile).toMatchObject({
      basis: 'schema-only',
      structural: { fieldCount: 0, edgeCount: 0 },
      warnings: ['schema-partial'],
    });
    expect(parsed.schemaComplexityProfile).not.toHaveProperty('runtimeCost');
    expect(parsed.complexity.score).toBe(1);
  });

  it('accepts a profile without runtimeCost', () => {
    const parsed = explainResultSchema.parse({
      command: {
        type: 'UpdateRecord',
        tableId: 'tbl0000000000000000',
        tableName: 'Amounts',
        recordIds: ['rec0000000000000000'],
        changeType: 'update',
      },
      computedImpact: null,
      sqlExplains: [],
      complexity: { score: 1, level: 'trivial', factors: [], recommendations: [] },
      schemaComplexityProfile: {
        version: 1,
        basis: 'schema-only',
        structural: {},
        formulas: [],
        operation: null,
        evidence: {},
        warnings: [],
      },
      timing: { totalMs: 1, dependencyGraphMs: 0, planningMs: 0, sqlExplainMs: 0 },
    });

    expect(parsed.schemaComplexityProfile?.warnings).toEqual([]);
  });

  it('keeps legacy explain payloads valid without the new property', () => {
    const parsed = explainResultSchema.parse({
      command: {
        type: 'DeleteRecords',
        tableId: 'tbl0000000000000000',
        tableName: 'Amounts',
        recordIds: ['rec0000000000000000'],
        changeType: 'delete',
      },
      computedImpact: null,
      sqlExplains: [],
      complexity: { score: 0, level: 'trivial', factors: [], recommendations: [] },
      timing: { totalMs: 1, dependencyGraphMs: 0, planningMs: 0, sqlExplainMs: 0 },
    });

    expect(parsed.schemaComplexityProfile).toBeUndefined();
  });
});
