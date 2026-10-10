/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * T7080 — sanitized structure-equivalent of the staging cond-rollup bug.
 *
 * Retained structure:
 * - Host/source tables joined by a text MatchKey field reference
 * - Nested AND + OR group: MatchKey = host.MatchKey AND (FlagA = no OR FlagB = yes)
 * - countall over the matched source rows
 * - Source flag fields are singleLineText or longText
 *
 * Host A has two matching MatchKey rows: one hits the OR group, one does not.
 */
describe('conditionalRollup nested OR groups (T7080)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;
  const tableIds: string[] = [];

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const deleteTableSafe = async (tableId: string | undefined) => {
    if (!tableId) return;
    try {
      await ctx.deleteTable(tableId);
    } catch {
      return undefined;
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  afterAll(async () => {
    for (const tableId of [...tableIds].reverse()) {
      await deleteTableSafe(tableId);
    }
  });

  it.each([{ flagType: 'singleLineText' as const }, { flagType: 'longText' as const }])(
    'countall keeps nested OR when MatchKey field-ref is AND-ed with $flagType flags',
    async ({ flagType }) => {
      const sourceNameFieldId = createFieldId();
      const sourceMatchKeyFieldId = createFieldId();
      const sourceFlagAFieldId = createFieldId();
      const sourceFlagBFieldId = createFieldId();
      const hostNameFieldId = createFieldId();
      const hostMatchKeyFieldId = createFieldId();
      const andCountFieldId = createFieldId();
      const orCountFieldId = createFieldId();

      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `T7080 Source ${flagType} ${Date.now()}`,
        fields: [
          { type: 'singleLineText', id: sourceNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: sourceMatchKeyFieldId, name: 'MatchKey' },
          { type: flagType, id: sourceFlagAFieldId, name: 'FlagA' },
          { type: flagType, id: sourceFlagBFieldId, name: 'FlagB' },
        ],
        views: [{ type: 'grid' }],
      });
      tableIds.push(sourceTable.id);

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `T7080 Host ${flagType} ${Date.now()}`,
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: hostMatchKeyFieldId, name: 'MatchKey' },
          {
            type: 'conditionalRollup',
            id: andCountFieldId,
            name: 'AndCount',
            options: { expression: 'countall({values})' },
            config: {
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceNameFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: sourceMatchKeyFieldId,
                      operator: 'is',
                      value: hostMatchKeyFieldId,
                      isSymbol: true,
                    },
                    {
                      fieldId: sourceFlagBFieldId,
                      operator: 'is',
                      value: 'yes',
                    },
                  ],
                },
              },
            },
          },
          {
            type: 'conditionalRollup',
            id: orCountFieldId,
            name: 'OrCount',
            options: { expression: 'countall({values})' },
            config: {
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceNameFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: sourceMatchKeyFieldId,
                      operator: 'is',
                      value: hostMatchKeyFieldId,
                      isSymbol: true,
                    },
                    {
                      conjunction: 'or',
                      filterSet: [
                        {
                          fieldId: sourceFlagAFieldId,
                          operator: 'is',
                          value: 'no',
                        },
                        {
                          fieldId: sourceFlagBFieldId,
                          operator: 'is',
                          value: 'yes',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableIds.push(hostTable.id);

      await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'A1',
        [sourceMatchKeyFieldId]: 'A',
        [sourceFlagAFieldId]: 'yes',
        [sourceFlagBFieldId]: 'yes',
      });
      await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'A2',
        [sourceMatchKeyFieldId]: 'A',
        [sourceFlagAFieldId]: 'yes',
        [sourceFlagBFieldId]: 'no',
      });
      await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'B1',
        [sourceMatchKeyFieldId]: 'B',
        [sourceFlagAFieldId]: 'yes',
        [sourceFlagBFieldId]: 'yes',
      });
      await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'B2',
        [sourceMatchKeyFieldId]: 'B',
        [sourceFlagAFieldId]: 'yes',
        [sourceFlagBFieldId]: 'no',
      });

      await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host A',
        [hostMatchKeyFieldId]: 'A',
      });
      await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host B',
        [hostMatchKeyFieldId]: 'B',
      });
      await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host U',
        [hostMatchKeyFieldId]: 'U',
      });

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecords(hostTable.id);
      const byName = new Map(
        hostRecords.map((record) => [String(record.fields[hostNameFieldId]), record])
      );

      expect(Number(byName.get('Host A')?.fields[andCountFieldId])).toBe(1);
      expect(Number(byName.get('Host A')?.fields[orCountFieldId])).toBe(1);
      expect(Number(byName.get('Host B')?.fields[andCountFieldId])).toBe(1);
      expect(Number(byName.get('Host B')?.fields[orCountFieldId])).toBe(1);
      expect(Number(byName.get('Host U')?.fields[andCountFieldId] ?? 0)).toBe(0);
      expect(Number(byName.get('Host U')?.fields[orCountFieldId] ?? 0)).toBe(0);
    }
  );
});
