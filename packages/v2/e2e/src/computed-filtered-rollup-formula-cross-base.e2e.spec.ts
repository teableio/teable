/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Sanitized, structure-equivalent regression for T7075.
 *
 * Retained structure:
 * - source table with a number and a kind text used as a rollup filter
 * - host table with a oneMany link, filtered sum rollup, and a formula over that rollup
 * - mirror table in another base with a conditionalRollup of the host rollup
 *   and a conditionalRollup of the host formula
 * - host row created first, matching source row inserted/updated later
 *
 * Customer identifiers and values are not copied.
 */
import { createBaseOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 filtered rollup formula cross-base cascade (e2e)', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;
  let fieldIdCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;
  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createBase = async (name: string) => {
    const response = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, spaceId: 'space_test' }),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateBase failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createBaseOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`CreateBase parse failed: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.base.id;
  };

  const deleteTableWithBaseId = async (baseId: string, tableId: string) => {
    const response = await fetch(`${ctx.baseUrl}/tables/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId, tableId, mode: 'permanent' }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete table ${tableId} in base ${baseId}: ${errorText}`);
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('refreshes cross-base conditional rollups of a filtered rollup and its formula after a later source insert', async () => {
    let hostTableId: string | undefined;
    let sourceTableId: string | undefined;
    let mirrorBaseId: string | undefined;
    let mirrorTableId: string | undefined;

    try {
      const sourceNameFieldId = createFieldId();
      const sourceAmountFieldId = createFieldId();
      const sourceKindFieldId = createFieldId();
      const source = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-t7075-source'),
        fields: [
          { type: 'singleLineText', id: sourceNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: sourceAmountFieldId, name: 'Amount' },
          { type: 'singleLineText', id: sourceKindFieldId, name: 'Kind' },
        ],
      });
      sourceTableId = source.id;

      const hostKeyFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const hostRollupFieldId = createFieldId();
      const hostFormulaFieldId = createFieldId();
      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-t7075-host'),
        fields: [{ type: 'singleLineText', id: hostKeyFieldId, name: 'Key', isPrimary: true }],
      });
      hostTableId = host.id;

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'link',
          id: hostLinkFieldId,
          name: 'Lines',
          options: {
            relationship: 'oneMany',
            foreignTableId: source.id,
            lookupFieldId: sourceNameFieldId,
          },
        },
      });
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'rollup',
          id: hostRollupFieldId,
          name: 'Debit total',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId: hostLinkFieldId,
            foreignTableId: source.id,
            lookupFieldId: sourceAmountFieldId,
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: sourceKindFieldId, operator: 'is', value: 'debit' }],
            },
          },
        },
      });
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'formula',
          id: hostFormulaFieldId,
          name: 'Debit display',
          options: { expression: `{${hostRollupFieldId}}` },
        },
      });

      const hostRecord = await ctx.createRecord(host.id, { [hostKeyFieldId]: 'P1' });
      await ctx.drainOutbox();

      mirrorBaseId = await createBase(nextName('v2-t7075-mirror-base'));
      const mirrorKeyFieldId = createFieldId();
      const mirrorRollupCrFieldId = createFieldId();
      const mirrorFormulaCrFieldId = createFieldId();
      const mirror = await ctx.createTable({
        baseId: mirrorBaseId,
        name: nextName('v2-t7075-mirror'),
        fields: [{ type: 'singleLineText', id: mirrorKeyFieldId, name: 'Key', isPrimary: true }],
      });
      mirrorTableId = mirror.id;
      await ctx.createField({
        baseId: mirrorBaseId,
        tableId: mirror.id,
        field: {
          type: 'conditionalRollup',
          id: mirrorRollupCrFieldId,
          name: 'Host debit total',
          options: { expression: 'sum({values})', timeZone: 'utc' },
          config: {
            foreignTableId: host.id,
            lookupFieldId: hostRollupFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: hostKeyFieldId, operator: 'is', value: 'P1' }],
              },
            },
          },
        },
      });
      await ctx.createField({
        baseId: mirrorBaseId,
        tableId: mirror.id,
        field: {
          type: 'conditionalRollup',
          id: mirrorFormulaCrFieldId,
          name: 'Host debit display',
          options: { expression: 'sum({values})', timeZone: 'utc' },
          config: {
            foreignTableId: host.id,
            lookupFieldId: hostFormulaFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: hostKeyFieldId, operator: 'is', value: 'P1' }],
              },
            },
          },
        },
      });
      await ctx.createRecord(mirror.id, { [mirrorKeyFieldId]: 'P1' });
      await ctx.drainOutbox();

      const debit = await ctx.createRecord(source.id, {
        [sourceNameFieldId]: 'Debit line',
        [sourceAmountFieldId]: 10,
        [sourceKindFieldId]: 'debit',
      });
      await ctx.updateRecord(host.id, hostRecord.id, {
        [hostLinkFieldId]: [{ id: debit.id }],
      });
      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecords(host.id);
      const hostRow = hostRecords.find((record) => record.id === hostRecord.id);
      expect(hostRow?.fields[hostRollupFieldId]).toBe(10);
      expect(hostRow?.fields[hostFormulaFieldId]).toBe(10);

      const mirrorRecords = await ctx.listRecords(mirror.id, { baseId: mirrorBaseId });
      expect(mirrorRecords[0]?.fields[mirrorRollupCrFieldId]).toBe(10);
      expect(mirrorRecords[0]?.fields[mirrorFormulaCrFieldId]).toBe(10);

      await ctx.updateRecord(source.id, debit.id, { [sourceAmountFieldId]: 15 });
      await ctx.drainOutbox();

      const hostAfter = (await ctx.listRecords(host.id)).find(
        (record) => record.id === hostRecord.id
      );
      expect(hostAfter?.fields[hostRollupFieldId]).toBe(15);
      expect(hostAfter?.fields[hostFormulaFieldId]).toBe(15);

      const mirrorAfter = await ctx.listRecords(mirror.id, { baseId: mirrorBaseId });
      expect(mirrorAfter[0]?.fields[mirrorRollupCrFieldId]).toBe(15);
      expect(mirrorAfter[0]?.fields[mirrorFormulaCrFieldId]).toBe(15);
    } finally {
      await ctx.drainOutbox().catch(() => undefined);
      if (hostTableId) {
        await ctx.deleteTable(hostTableId).catch(() => undefined);
      }
      if (sourceTableId) {
        await ctx.deleteTable(sourceTableId).catch(() => undefined);
      }
      if (mirrorBaseId && mirrorTableId) {
        await deleteTableWithBaseId(mirrorBaseId, mirrorTableId).catch(() => undefined);
      }
    }
  });
});
