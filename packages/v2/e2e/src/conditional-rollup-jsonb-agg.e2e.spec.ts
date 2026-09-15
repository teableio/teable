/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Sanitized, structure-equivalent reproduction of T7099.
 *
 * Retained structural facts:
 * - leaf table stores scalar number, date, and checkbox values
 * - middle table manyMany-links to the leaf table and looks up those scalars
 *   (lookup storage is a JSON array)
 * - host table creates conditional rollups of those lookups after records exist
 *   so table.update computed backfill runs
 * - field-ref filter: middle.name is host.matchKey
 * - expressions: max/min on number, max on date, and/or on checkbox
 *
 * Customer identifiers and values are not copied.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 conditional rollup jsonb aggregation (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;
  const runId = Math.random().toString(36).slice(2, 8).padEnd(6, '0');

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(10, '0');
    fieldIdCounter += 1;
    return `fld${runId}${suffix}`;
  };

  const drainOutbox = async (rounds = 20) => {
    for (let i = 0; i < rounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it(
    'backfills max/min/and/or conditional rollups over multi-value lookups',
    { timeout: 120_000 },
    async () => {
      let leafTableId: string | undefined;
      let middleTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const leafNameFieldId = createFieldId();
        const amountFieldId = createFieldId();
        const dueFieldId = createFieldId();
        const flagFieldId = createFieldId();

        const leaf = await ctx.createTable({
          baseId: ctx.baseId,
          name: `JsonbAgg Leaf ${runId}`,
          fields: [
            { type: 'singleLineText', id: leafNameFieldId, name: 'Title', isPrimary: true },
            { type: 'number', id: amountFieldId, name: 'Amount' },
            {
              type: 'date',
              id: dueFieldId,
              name: 'Due',
              options: {
                formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'utc' },
              },
            },
            { type: 'checkbox', id: flagFieldId, name: 'Flag' },
          ],
          records: [
            {
              fields: {
                [leafNameFieldId]: 'A1',
                [amountFieldId]: 10,
                [dueFieldId]: '2024-01-01',
                [flagFieldId]: true,
              },
            },
            {
              fields: {
                [leafNameFieldId]: 'A2',
                [amountFieldId]: 30,
                [dueFieldId]: '2024-03-01',
                [flagFieldId]: true,
              },
            },
          ],
        });
        leafTableId = leaf.id;

        const leafRecords = await ctx.listRecords(leaf.id, { limit: 10, offset: 0 });
        const a1 = leafRecords.find((record) => record.fields[leafNameFieldId] === 'A1');
        const a2 = leafRecords.find((record) => record.fields[leafNameFieldId] === 'A2');
        if (!a1 || !a2) throw new Error('Missing leaf records');

        const middleNameFieldId = createFieldId();
        const middleLinkFieldId = createFieldId();
        const amountLookupFieldId = createFieldId();
        const dueLookupFieldId = createFieldId();
        const flagLookupFieldId = createFieldId();

        const middle = await ctx.createTable({
          baseId: ctx.baseId,
          name: `JsonbAgg Middle ${runId}`,
          fields: [
            { type: 'singleLineText', id: middleNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: middleLinkFieldId,
              name: 'Items',
              options: {
                relationship: 'manyMany',
                foreignTableId: leaf.id,
                lookupFieldId: leafNameFieldId,
              },
            },
            {
              type: 'lookup',
              id: amountLookupFieldId,
              name: 'Amount Lookup',
              options: {
                linkFieldId: middleLinkFieldId,
                foreignTableId: leaf.id,
                lookupFieldId: amountFieldId,
              },
            },
            {
              type: 'lookup',
              id: dueLookupFieldId,
              name: 'Due Lookup',
              options: {
                linkFieldId: middleLinkFieldId,
                foreignTableId: leaf.id,
                lookupFieldId: dueFieldId,
              },
            },
            {
              type: 'lookup',
              id: flagLookupFieldId,
              name: 'Flag Lookup',
              options: {
                linkFieldId: middleLinkFieldId,
                foreignTableId: leaf.id,
                lookupFieldId: flagFieldId,
              },
            },
          ],
        });
        middleTableId = middle.id;

        await ctx.createRecord(middle.id, {
          [middleNameFieldId]: 'BucketA',
          [middleLinkFieldId]: [{ id: a1.id }, { id: a2.id }],
        });
        await drainOutbox();

        const middleMeta = await ctx.getTableById(middle.id);
        const amountLookup = middleMeta.fields.find((field) => field.id === amountLookupFieldId);
        const dueLookup = middleMeta.fields.find((field) => field.id === dueLookupFieldId);
        const flagLookup = middleMeta.fields.find((field) => field.id === flagLookupFieldId);
        expect(amountLookup?.isMultipleCellValue).toBe(true);
        expect(amountLookup?.dbFieldType).toBe('JSON');
        expect(dueLookup?.isMultipleCellValue).toBe(true);
        expect(dueLookup?.dbFieldType).toBe('JSON');
        expect(flagLookup?.isMultipleCellValue).toBe(true);
        expect(flagLookup?.dbFieldType).toBe('JSON');

        const hostMatchFieldId = createFieldId();
        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: `JsonbAgg Host ${runId}`,
          fields: [
            { type: 'singleLineText', id: hostMatchFieldId, name: 'MatchKey', isPrimary: true },
          ],
          records: [{ fields: { [hostMatchFieldId]: 'BucketA' } }],
        });
        hostTableId = host.id;

        const matchFilter = {
          conjunction: 'and' as const,
          filterSet: [
            {
              fieldId: middleNameFieldId,
              operator: 'is',
              value: hostMatchFieldId,
              isSymbol: true,
            },
          ],
        };

        const maxAmountFieldId = createFieldId();
        const minAmountFieldId = createFieldId();
        const maxDueFieldId = createFieldId();
        const andFlagFieldId = createFieldId();
        const orFlagFieldId = createFieldId();

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'conditionalRollup',
            id: maxAmountFieldId,
            name: 'Max Amount',
            options: { expression: 'max({values})' },
            config: {
              foreignTableId: middle.id,
              lookupFieldId: amountLookupFieldId,
              condition: { filter: matchFilter },
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'conditionalRollup',
            id: minAmountFieldId,
            name: 'Min Amount',
            options: { expression: 'min({values})' },
            config: {
              foreignTableId: middle.id,
              lookupFieldId: amountLookupFieldId,
              condition: { filter: matchFilter },
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'conditionalRollup',
            id: maxDueFieldId,
            name: 'Max Due',
            options: { expression: 'max({values})', timeZone: 'utc' },
            config: {
              foreignTableId: middle.id,
              lookupFieldId: dueLookupFieldId,
              condition: { filter: matchFilter },
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'conditionalRollup',
            id: andFlagFieldId,
            name: 'All Flags',
            options: { expression: 'and({values})' },
            config: {
              foreignTableId: middle.id,
              lookupFieldId: flagLookupFieldId,
              condition: { filter: matchFilter },
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'conditionalRollup',
            id: orFlagFieldId,
            name: 'Any Flag',
            options: { expression: 'or({values})' },
            config: {
              foreignTableId: middle.id,
              lookupFieldId: flagLookupFieldId,
              condition: { filter: matchFilter },
            },
          },
        });

        await drainOutbox();

        const hostAfter = await ctx.getTableById(host.id);
        for (const fieldId of [
          maxAmountFieldId,
          minAmountFieldId,
          maxDueFieldId,
          andFlagFieldId,
          orFlagFieldId,
        ]) {
          const field = hostAfter.fields.find((item) => item.id === fieldId);
          expect(field?.hasError ?? false).toBe(false);
        }

        const hostRecords = await ctx.listRecords(host.id, { limit: 10, offset: 0 });
        const hostRecord = hostRecords[0];
        expect(hostRecord?.fields[maxAmountFieldId]).toBe(30);
        expect(hostRecord?.fields[minAmountFieldId]).toBe(10);
        expect(String(hostRecord?.fields[maxDueFieldId] ?? '')).toContain('2024-03-01');
        expect(hostRecord?.fields[andFlagFieldId]).toBe(true);
        expect(hostRecord?.fields[orFlagFieldId]).toBe(true);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (middleTableId) await ctx.deleteTable(middleTableId).catch(() => undefined);
        if (leafTableId) await ctx.deleteTable(leafTableId).catch(() => undefined);
      }
    }
  );
});
