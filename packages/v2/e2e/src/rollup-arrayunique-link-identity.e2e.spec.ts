/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Sanitized, structure-equivalent coverage for T7082.
 *
 * Retained structure:
 * - parent → child oneMany
 * - child → target links in oneOne / oneMany / manyOne / manyMany
 * - two target records share the same primary title and have different ids
 * - parent rollups array_compact / array_unique over those child link fields
 * - compact must return title strings (not `{id,title}` objects) and keep duplicate ids
 * - unique must keep both same-title records and still collapse same-id duplicates
 *
 * No customer identifiers or record values.
 */
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 rollup ARRAYUNIQUE link identity (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;
  const runId = Math.random().toString(36).slice(2, 8).padEnd(6, '0');

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(10, '0');
    fieldIdCounter += 1;
    return `fld${runId}${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  const titlesOf = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (item && typeof item === 'object' && 'title' in item && item.title != null) {
        return String(item.title);
      }
      return String(item);
    });
  };

  test('keeps same-title linked records distinct by record id', async () => {
    const targetNameFieldId = createFieldId();
    const childNameFieldId = createFieldId();
    const parentNameFieldId = createFieldId();
    const parentChildrenFieldId = createFieldId();
    const childOoFieldId = createFieldId();
    const childOmFieldId = createFieldId();
    const childMoFieldId = createFieldId();
    const childMmFieldId = createFieldId();
    const ooUniqueFieldId = createFieldId();
    const omUniqueFieldId = createFieldId();
    const moUniqueFieldId = createFieldId();
    const mmUniqueFieldId = createFieldId();
    const mmCompactFieldId = createFieldId();

    let targetTableId: string | undefined;
    let childTableId: string | undefined;
    let parentTableId: string | undefined;

    try {
      const targetTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Rollup Unique Link Target',
        fields: [{ type: 'singleLineText', id: targetNameFieldId, name: 'Name', isPrimary: true }],
      });
      targetTableId = targetTable.id;

      const childTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Rollup Unique Link Child',
        fields: [{ type: 'singleLineText', id: childNameFieldId, name: 'Name', isPrimary: true }],
      });
      childTableId = childTable.id;

      const parentTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Rollup Unique Link Parent',
        fields: [{ type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true }],
      });
      parentTableId = parentTable.id;

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: parentTable.id,
        field: {
          type: 'link',
          id: parentChildrenFieldId,
          name: 'Children',
          options: {
            relationship: 'oneMany',
            foreignTableId: childTable.id,
            lookupFieldId: childNameFieldId,
            isOneWay: true,
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: childTable.id,
        field: {
          type: 'link',
          id: childOoFieldId,
          name: 'OO',
          options: {
            relationship: 'oneOne',
            foreignTableId: targetTable.id,
            lookupFieldId: targetNameFieldId,
            isOneWay: true,
          },
        },
      });
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: childTable.id,
        field: {
          type: 'link',
          id: childOmFieldId,
          name: 'OM',
          options: {
            relationship: 'oneMany',
            foreignTableId: targetTable.id,
            lookupFieldId: targetNameFieldId,
            isOneWay: true,
          },
        },
      });
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: childTable.id,
        field: {
          type: 'link',
          id: childMoFieldId,
          name: 'MO',
          options: {
            relationship: 'manyOne',
            foreignTableId: targetTable.id,
            lookupFieldId: targetNameFieldId,
            isOneWay: true,
          },
        },
      });
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: childTable.id,
        field: {
          type: 'link',
          id: childMmFieldId,
          name: 'MM',
          options: {
            relationship: 'manyMany',
            foreignTableId: targetTable.id,
            lookupFieldId: targetNameFieldId,
            isOneWay: true,
          },
        },
      });

      for (const spec of [
        {
          id: ooUniqueFieldId,
          lookupFieldId: childOoFieldId,
          expression: 'array_unique({values})',
        },
        {
          id: omUniqueFieldId,
          lookupFieldId: childOmFieldId,
          expression: 'array_unique({values})',
        },
        {
          id: moUniqueFieldId,
          lookupFieldId: childMoFieldId,
          expression: 'array_unique({values})',
        },
        {
          id: mmUniqueFieldId,
          lookupFieldId: childMmFieldId,
          expression: 'array_unique({values})',
        },
        {
          id: mmCompactFieldId,
          lookupFieldId: childMmFieldId,
          expression: 'array_compact({values})',
        },
      ] as const) {
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: parentTable.id,
          field: {
            type: 'rollup',
            id: spec.id,
            name: spec.id,
            options: { expression: spec.expression },
            config: {
              linkFieldId: parentChildrenFieldId,
              foreignTableId: childTable.id,
              lookupFieldId: spec.lookupFieldId,
            },
          },
        });
      }

      const shared = await ctx.createRecord(targetTable.id, { [targetNameFieldId]: 'Shared' });
      const sameA = await ctx.createRecord(targetTable.id, { [targetNameFieldId]: 'Same' });
      const sameB = await ctx.createRecord(targetTable.id, { [targetNameFieldId]: 'Same' });
      const extra = await ctx.createRecord(targetTable.id, { [targetNameFieldId]: 'Extra' });

      const childA1 = await ctx.createRecord(childTable.id, {
        [childNameFieldId]: 'A1',
        [childOoFieldId]: { id: sameA.id },
        [childOmFieldId]: [{ id: shared.id }, { id: sameA.id }],
        [childMoFieldId]: { id: sameA.id },
        [childMmFieldId]: [{ id: shared.id }, { id: sameA.id }],
      });
      const childA2 = await ctx.createRecord(childTable.id, {
        [childNameFieldId]: 'A2',
        [childOoFieldId]: { id: sameB.id },
        [childOmFieldId]: [{ id: sameB.id }, { id: extra.id }],
        [childMoFieldId]: { id: sameB.id },
        [childMmFieldId]: [{ id: shared.id }, { id: sameB.id }, { id: extra.id }],
      });

      const parent = await ctx.createRecord(parentTable.id, {
        [parentNameFieldId]: 'P',
        [parentChildrenFieldId]: [{ id: childA1.id }, { id: childA2.id }],
      });

      await ctx.drainOutbox();

      const record = (await ctx.listRecords(parentTable.id)).find((row) => row.id === parent.id);
      expect(record).toBeDefined();

      expect(record?.fields[mmCompactFieldId]).toEqual([
        'Shared',
        'Same',
        'Shared',
        'Same',
        'Extra',
      ]);

      expect(titlesOf(record?.fields[ooUniqueFieldId])).toEqual(['Same', 'Same']);
      expect(titlesOf(record?.fields[moUniqueFieldId])).toEqual(['Same', 'Same']);
      expect(titlesOf(record?.fields[omUniqueFieldId])).toEqual([
        'Shared',
        'Same',
        'Same',
        'Extra',
      ]);
      expect(titlesOf(record?.fields[mmUniqueFieldId])).toEqual([
        'Shared',
        'Same',
        'Same',
        'Extra',
      ]);
    } finally {
      if (parentTableId) await ctx.deleteTable(parentTableId).catch(() => undefined);
      if (childTableId) await ctx.deleteTable(childTableId).catch(() => undefined);
      if (targetTableId) await ctx.deleteTable(targetTableId).catch(() => undefined);
    }
  });
});
